"""Private publisher bridge. Keep the collection cleanup lock until stdin closes.

The JSON-lines protocol is consumed only by publication.mjs. No credentials enter
this process. Errors are deliberately fixed strings, never source text or paths.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

from build_public_snapshot import REPO, build_candidate, read_json
from privacy_rules import canonical_id, load_rules, write_json

FILES = ('candidate.json', 'payload.json', 'lineage.json')
INPUTS = ('schools.json', 'sources.json', 'enrollment.csv', 'projections.csv', 'derivations.json')


def plain_path(value):
    path = Path(value)
    if not path.is_absolute() or path.resolve() != path or path.is_symlink():
        raise ValueError()
    return path


def read_candidate(path):
    path = plain_path(path)
    if set(p.name for p in path.iterdir()) != set(FILES):
        raise ValueError()
    result = {}
    for name in FILES:
        item = path / name
        if item.is_symlink() or not item.is_file():
            raise ValueError()
        result[name] = item.read_bytes()
    return result


def policy(root):
    path = root / 'reports/privacy-exclusions.json'
    before = path.read_bytes()
    rules = load_rules(path)  # Follows the existing versioned manifest symlink.
    if before != path.read_bytes():
        raise ValueError()
    return {'valid': True, 'digest': hashlib.sha256(before).hexdigest(), 'rules': {
        'source_ids': sorted({canonical_id(v) for v in rules['source_ids']}),
        'paths': sorted(set(rules['paths'])), 'sha256': sorted(set(rules['sha256']))}}


def registry_path(root):
    path = root / 'reports/schools-publication-artifacts.json'
    if path.is_symlink():
        raise ValueError()
    return path


def registry(root):
    path = registry_path(root)
    value = read_json(path) if path.exists() else {'schema_version': 1, 'artifacts': []}
    if set(value) != {'schema_version', 'artifacts'} or value['schema_version'] != 1 or not isinstance(value['artifacts'], list):
        raise ValueError()
    return value


def lineage_sources(lineage):
    sources = lineage['sources']
    if not isinstance(sources, list) or not sources:
        raise ValueError()
    result = []
    for source in sources:
        if not isinstance(source['source_id'], str) or not source['source_id'] or not source['files']:
            raise ValueError()
        for item in source['files']:
            path, digest = item['path'], item['sha256']
            # Actual file/path/hash validation is performed by the U3 rebuild.
            if not isinstance(path, str) or not isinstance(digest, str):
                raise ValueError()
        result.append({'source_id': canonical_id(source['source_id']),
                       'files': [{'path': f['path'], 'sha256': f['sha256']} for f in source['files']]})
    return result


def validate(root, request):
    candidate, inputs = plain_path(request['candidate']), plain_path(request['inputs'])
    if any(candidate.is_relative_to(p) or candidate in p.parents for p in (inputs, root, REPO)):
        raise ValueError()
    reviewed = read_candidate(candidate)
    lineage = read_json(candidate / 'lineage.json')
    artifacts = registry(root)
    sources = lineage_sources(lineage)
    entry = {'candidate': str(candidate), 'inputs': str(inputs), 'exports': [],
             'sources': sources, 'verified_inputs': False}
    previous = next((v for v in artifacts['artifacts'] if v['candidate'] == str(candidate) and v['inputs'] == str(inputs)), None)
    if previous:
        entry['exports'] = previous['exports']
        entry['verified_inputs'] = previous['verified_inputs']
        # A failed/tampered replacement must not erase a known alias dependency.
        entry['sources'] = previous['sources'] + [s for s in sources if s not in previous['sources']]
    artifacts['artifacts'] = [v for v in artifacts['artifacts'] if v is not previous] + [entry]
    # Register before rebuilding so a rejected stale candidate is still cleaned.
    write_json(registry_path(root), artifacts)
    for name in INPUTS:
        path = inputs / name
        if path.is_symlink() or (path.exists() and not path.is_file()):
            raise ValueError()
    scratch = os.environ.get('RUNNER_TEMP', '/tmp/opencode')
    with tempfile.TemporaryDirectory(prefix='schools-revalidate-', dir=scratch) as temporary:
        rebuilt = Path(temporary) / 'candidate'
        build_candidate(inputs, root, rebuilt)
        if read_candidate(rebuilt) != reviewed:
            raise ValueError()  # Never replace reviewed bytes with a new build.
    # Catch changes during the rebuild, including independently changed policy.
    if read_candidate(candidate) != reviewed:
        raise ValueError()
    # Retained exports can still contain an earlier candidate's sources.
    if not entry['exports']:
        entry['sources'] = sources
    entry['verified_inputs'] = True
    write_json(registry_path(root), artifacts)
    return {'manifest': json.loads(reviewed['candidate.json']),
            'payload': reviewed['payload.json'].decode(), 'lineage': reviewed['lineage.json'].decode()}


def affected(entry, rules):
    ids = {canonical_id(v) for v in rules['source_ids']}
    paths, hashes = set(rules['paths']), set(rules['sha256'])
    return any(canonical_id(s['source_id']) in ids or
               any(f['path'] in paths or f['sha256'] in hashes for f in s['files'])
               for s in entry['sources'])


def remove_file(path):
    # Never follow a replaced symlink into another tree. Removing the link itself
    # is safe; a changed parent is not, and leaves the resumable entry in place.
    if path.parent.resolve() != path.parent:
        raise ValueError()
    path.unlink(missing_ok=True)


def cleanup(root, rules):
    data = registry(root)
    removed = 0
    for entry in list(data['artifacts']):
        if not affected(entry, rules):
            continue
        candidate, inputs = plain_path(entry['candidate']), plain_path(entry['inputs'])
        if any(candidate.is_relative_to(p) or candidate in p.parents for p in (inputs, root, REPO)):
            raise ValueError()
        # A registered candidate is a dedicated, builder-owned directory. Remove
        # its whole derived output, including any later preview alongside it.
        if candidate.exists():
            shutil.rmtree(candidate)
        # Reviewed inputs are record containers; delete affected containers rather
        # than retaining excerpts or guessing how to redact derived contributions.
        if entry['verified_inputs']:
            for name in INPUTS:
                remove_file(inputs / name)
        for value in entry['exports']:
            remove_file(Path(value))
        if not entry['verified_inputs'] and any(
                (inputs / name).exists() or (inputs / name).is_symlink() for name in INPUTS):
            # Untrusted lineage cannot authorize deleting input containers. Keep
            # this metadata until an authorized operator removes the exact inputs.
            raise ValueError('Unverified publication inputs require authorized removal')
        data['artifacts'].remove(entry)
        write_json(registry_path(root), data)
        removed += 1
    return {'removed_artifacts': removed}


def register_export(root, candidate, export):
    """Register one exact payload copy, under the same cleanup lock as publish."""
    candidate, export = plain_path(candidate), plain_path(export)
    data = registry(root)
    entry = next(v for v in data['artifacts'] if v['candidate'] == str(candidate))
    if export.read_bytes() != (candidate / 'payload.json').read_bytes():
        raise ValueError()
    entry['exports'] = sorted(set(entry['exports'] + [str(export)]))
    write_json(registry_path(root), data)


def send(value):
    print(json.dumps(value, ensure_ascii=False, allow_nan=False), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--register-export', type=Path)
    parser.add_argument('--candidate', type=Path)
    args = parser.parse_args()
    try:
        root = args.root.resolve(strict=True)
        lock_path = root.parent / '.school-board-cleanup.lock'
        # This is the exact lock used by delete_records.apply, not a second lock.
        fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if args.register_export:
                register_export(root, args.candidate, args.register_export)
                send({'ok': True})
                return
            try:
                send(policy(root))
            except (ValueError, OSError, TypeError):
                send({'valid': False, 'digest': None, 'rules': None})
            for line in sys.stdin:
                try:
                    request = json.loads(line)
                    if request['action'] == 'validate':
                        result = validate(root, request)
                    elif request['action'] == 'cleanup':
                        result = cleanup(root, request['rules'])
                    elif request['action'] == 'policy':
                        result = policy(root)
                    else:
                        raise ValueError()
                    send({'ok': True, 'result': result})
                except (ValueError, OSError, TypeError, KeyError, StopIteration):
                    send({'ok': False})
    except (ValueError, OSError, TypeError, KeyError, StopIteration):
        send({'ok': False})
        sys.exit(1)


if __name__ == '__main__':
    main()

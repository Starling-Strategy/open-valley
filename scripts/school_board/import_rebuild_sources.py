"""Capture a small, explicitly reviewed public source set for the private rebuild.

Run only after reviewing the current originals. No private Google access, crawling,
transcript acquisition, or automatic publication eligibility is implied.
"""
import argparse
import fcntl
import hashlib
import json
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen
from privacy_rules import canonical_id, load_rules, write_json


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.skip = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in ('head', 'script', 'style', 'noscript'):
            self.skip += 1
        if tag in ('p', 'li', 'h1', 'h2', 'h3', 'tr') and not self.skip:
            self.parts.append('\n\n')

    def handle_endtag(self, tag):
        if tag in ('head', 'script', 'style', 'noscript'):
            self.skip = max(0, self.skip - 1)

    def handle_data(self, value):
        if not self.skip:
            self.parts.append(value)


SOURCES = [
    ('1aihYffQOrN4U9rYYUc1bDNsJewq__HSeBYGQ-C5YJDw', 'FAQ on Consolidation', 'https://docs.google.com/document/d/1aihYffQOrN4U9rYYUc1bDNsJewq__HSeBYGQ-C5YJDw/edit', 'district FAQ; claims attributed, not independently verified', 'Parts A–E', None),
    ('1TQmE7qIp1O0Nsze9toIsf8-Mq0wpNq8BkbHPhqzIoU4', '2026-27 Meeting Schedule', 'https://docs.google.com/document/d/1TQmE7qIp1O0Nsze9toIsf8-Mq0wpNq8BkbHPhqzIoU4/edit', 'official schedule, subject to change', '2026–27 schedule', None),
    ('huusd-rfp-announcement-20260917', 'RFP - Feasibility Study for Consolidation of four Elementary Schools', 'https://huusd.org/blog/rfp-feasibility-study', 'district announcement; study solicitation, not a closure decision', 'Purpose and RFP milestones', 'RFP - Feasibility Study for Consolidation of four Elementary Schools'),
    ('macon-community-20260930', 'The Community We Create', 'https://maconphillips.com/the-community-we-create/', 'Macon Phillips personal perspective, September 30, 2026', 'Education and student experience', 'The Community We Create'),
    ('macon-consolidation-20260809', 'We Need to Talk About School Consolidation', 'https://maconphillips.com/we-need-to-talk-about-school-consolidation/', 'Macon Phillips personal perspective, August 9, 2026; historical numbers are not reconciled measurements', 'My current thoughts and questions', 'We Need to Talk About School Consolidation'),
    ('macon-accessibility-20260609', 'A Prototype for a More Accessible School Board', 'https://maconphillips.com/huusd-board-redesign/', 'Macon Phillips personal perspective, June 9, 2026', 'Organizing around residents’ needs', 'A Prototype for a More Accessible School Board'),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--reviewed-on', required=True, help='ISO review date after reading the originals')
    args = parser.parse_args()
    datetime.strptime(args.reviewed_on, '%Y-%m-%d')
    root = args.root.resolve()
    destination = root / 'supplements/rebuild-reviewed'
    with (root.parent / '.school-board-cleanup.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        rules = load_rules(root / 'reports/privacy-exclusions.json')
        excluded = {canonical_id(x) for x in rules['source_ids']}
        if destination.exists():
            raise ValueError('Review already exists; use explicit versioned review rather than overwrite')
        captures = []
        for sid, title, url, kind, locator, heading in SOURCES:
            if canonical_id(sid) in excluded:
                continue
            fetch_url = url.replace('/edit', '/export?format=txt') if url.startswith('https://docs.google.com/') else url
            with urlopen(Request(fetch_url, headers={'User-Agent': 'OpenValleyResearch/1.0'}), timeout=30) as response:
                if 'accounts.google.com' in response.url:
                    raise ValueError('Authentication required; not a public source')
                raw = response.read(1_000_001)
                if len(raw) > 1_000_000:
                    raise ValueError('Source exceeds bounded capture size')
            if hashlib.sha256(raw).hexdigest() in rules['sha256']:
                raise ValueError('Excluded source bytes')
            text = raw.decode('utf-8-sig')
            if heading:
                parsed = PlainText()
                parsed.feed(text)
                text = ''.join(parsed.parts)
                start = text.find(heading)
                if start < 0:
                    raise ValueError('Expected reviewed heading missing')
                text = text[start:]
                for marker in ['\n\nContact info', '— · —']:
                    text = text.split(marker)[0]
            text = '\n\n'.join(' '.join(p.split()) for p in text.split('\n\n') if p.strip()) + '\n'
            content = text.encode()
            relative = f'supplements/rebuild-reviewed/{sid}.txt'
            sha = hashlib.sha256(content).hexdigest()
            if relative in rules['paths'] or sha in rules['sha256']:
                raise ValueError('Excluded capture')
            captures.append((content, {'id': sid, 'title': title, 'url': url, 'kind': kind, 'locator': locator, 'reviewedAt': args.reviewed_on, 'localPath': relative, 'sha256': sha}))
        destination.mkdir(mode=0o700)
        for content, record in captures:
            (root / record['localPath']).write_bytes(content)
        write_json(destination / 'reviewed.json', [record for _, record in captures])
        write_json(destination / 'catalog.json', [
            {'source_id': r['id'], 'title': r['title'], 'url': r['url'], 'local_path': r['localPath'], 'sha256': r['sha256'], 'bytes': len(content), 'status': 'reviewed_private_preview', 'access': 'public_original', 'reviewed_at': args.reviewed_on, 'captured_at': datetime.now(timezone.utc).isoformat()}
            for content, r in captures
        ])
        print(json.dumps({'sources': len(captures), 'bytes': sum(len(c) for c, _ in captures), 'reviewed_on': args.reviewed_on}))


if __name__ == '__main__':
    main()

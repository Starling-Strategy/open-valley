"""Summarize the saved catalog without interpreting source conflicts away."""
import csv
import json
from collections import Counter
from pathlib import Path
from privacy_filter import ROOT

sources = json.loads((ROOT / 'catalog/sources.json').read_text())
missing = [s for s in sources if not s['files']]
effective_reasons = Counter()


def reason(source):
    # Prefer this run's acquisition observations over older inventory states.
    for observation in reversed(source['observations']):
        if observation['origin'].startswith(('supplements/', 'notion/')):
            return str(observation.get('status') or observation.get('acquisition_status') or 'unclassified')
    if source['source_id'].startswith('youtube:'):
        return 'recording_metadata_without_local_caption_or_media'
    return 'inventory_only'


with (ROOT / 'reports/sources-without-local-content.csv').open('w', newline='') as stream:
    writer = csv.DictWriter(stream, fieldnames=['source_id', 'title', 'url', 'effective_reason', 'recorded_statuses', 'observations'])
    writer.writeheader()
    for s in missing:
        statuses = sorted({str(o[k]) for o in s['observations'] for k in ('status', 'acquisition_status') if o.get(k)})
        category = reason(s)
        effective_reasons[category] += 1
        writer.writerow({'source_id': s['source_id'], 'title': s['title'], 'url': s['url'], 'effective_reason': category, 'recorded_statuses': ' | '.join(statuses), 'observations': json.dumps(s['observations'], ensure_ascii=False)})
origins = {}
for s in sources:
    for origin in {o['origin'] for o in s['observations']}:
        origins.setdefault(origin, Counter())[s['local_status']] += 1
summary = {'source_records': len(sources), 'source_records_with_files': len(sources)-len(missing), 'source_records_without_files': len(missing), 'effective_missing_reasons': dict(effective_reasons), 'overlapping_origin_counts': {k: dict(v) for k, v in origins.items()}, 'meaning': 'Missing-file list includes intentionally deferred media and metadata-only sources as well as actual acquisition gaps; read observations and worker coverage reports. Origin counts overlap and are not additive.'}
(ROOT / 'reports/catalog-coverage.json').write_text(json.dumps(summary, indent=2))
print(json.dumps(summary, indent=2))

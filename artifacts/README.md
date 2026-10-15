# Historical enrollment research prototype

**Authority: historical — October 14, 2026.** Preserved for research and design
reference; this is not the current production application or a validated
publication dataset. It combines six-town population statistics, reconstructed
AOE school enrollment, district attending counts, consultant history/projections
and preliminary June/September 2026 workbook aggregates. These series have
different definitions and dates and must not be treated as one comparable
enrollment series or a resident participation rate.

AOE 2017–18 remains unresolved and is not plotted. The 2024–25 AOE/district
difference and September workbook/presentation difference remain unresolved.
Original supplied-workbook cell/formula checks and its public-source provenance
remain outstanding; email-derived commentary is context, not public evidence.
Consult [reviewed enrollment coverage](../docs/school-board/enrollment-coverage.md)
and [publication inputs](../data/school-board/public/) before reusing figures.

## Preserved files

| File | Role |
|---|---|
| `enrollment-explorer.html` | Frozen interactive prototype with embedded aggregate series; direct-open historical warning added October 15. |
| `population-view.html` | Population-section template, depends on explorer styling and `__DATA__` substitution. |
| `build-population-view.py` | Partial generator: rebuilds population/AOE data and replaces the population section of an existing explorer. |
| `population-enrollment-data.json` | Derived frozen aggregates, official source URLs/hashes and workbook row locators. |
| `enrollment-explorer-*.png` | Earlier enrollment-only screenshots, before the population section. |
| `population-overview-*.png` | Earlier population screenshots, before later reconciliation warnings; the mobile image includes a clipped chart. |

Screenshots are historical visual records, not acceptance evidence for the
current HTML or deployed app. All eight authored/derived files are retained.
The two original public aggregate workbooks remain **local, Git-ignored inputs**
beside the builder: `aoe-enrollment-20251125.xlsx` and
`vermont-town-population-1930-2025.xls`. They are not in an application image or
the reviewed production library. Source URLs and SHA-256 values are in the JSON.
The October 15 review verified AOE download byte identity; VDH remote byte
identity could not be reverified because its binary download returned 403.

## Reproduction limits

From the repository root, with the two matching workbooks available locally:

```bash
uv run --no-project --with xlrd --with openpyxl python artifacts/build-population-view.py
```

This rewrites the JSON and the population section of the existing HTML. It does
not reconstruct the hard-coded consultant/forecast/June/September series. It
also reads `data/school-board/public/enrollment.csv`. Dependencies and the input
CSV revision are not pinned; the script records workbook hashes rather than
enforcing expected ones, and its retrieval date is the historical October 14
date. Do not call a fresh run a reviewed new edition without updating provenance
and validating the source definitions.

The October 15 read-only review reproduced the original JSON and HTML generation
in memory and reconciled the aggregate sums. It did not validate the unresolved
supplied-workbook claims or certify public-source provenance for them.

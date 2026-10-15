# Warren, VT

Authority: current directory map for **derived outputs**, with historical May
2026 acquisition evidence. Counts below have not been recomputed for this
October 15 documentation review. Regeneration is blocked by path drift described
below; this is not a current property census or production database.

The retained property/CAMA assessment export came from the town's public NEMRC
portal and was joined to VCGI statewide parcel GIS. `warren_properties.json`
supports the public `/explore` assessment view without connecting the legacy
housing database. See [current deployment](../docs/DEPLOYMENT.md).

- **Properties:** 3,105 (every parcel in the NEMRC database)
- **Parcel polygons:** 3,245 (VCGI), 96% joined to the assessment data
- **NEMRC source updated:** 2026-05-15 · **Built:** 2026-05-31

## Outputs (`warren/outputs/`)

| File | Rows | What it is |
|------|------|------------|
| `warren_joined.csv` | 3,105 | **Start here.** Assessment data + GIS extras and an approximate lon/lat map point (vertex mean, not area-weighted centroid). One row per parcel. |
| `warren_properties.csv` | 3,105 | Assessment-only main table: owner, location, mailing block, SPAN, acres, status, last sale, all assessed values. |
| `warren_buildings.csv` | 3,153 | One row per building/improvement (year built, style, beds/baths, SF…). Join on `parcel_id` + `building_no`. |
| `warren_land.csv` | 2,430 | One row per land segment. Join on `parcel_id` + `land_no`. |
| `warren_parcels.geojson` | 3,245 | **Parcel boundary polygons** (WGS84) + all 56 VCGI fields. Open in QGIS / geojson.io / Leaflet. |
| `warren_parcels_gis.csv` | 3,245 | VCGI attribute table (no geometry). Keyed by SPAN/PARCID. |
| `warren_properties.json` | 3,105 | Full nested record per parcel — every field from the property card. |
| `parcels.txt` | 3,105 | List of all parcel IDs. |

## Keys & how the tables relate

- **`parcel_id`** links the NEMRC tables (`properties`, `buildings`, `land`, `joined`).
- **GIS join:** `warren_joined.csv` matches NEMRC `parcel_id` to the VCGI parcel's
  cleaned `PARCID`, falling back to `SPAN`. The earlier “97% direct” claim lacks
  a specified denominator and is not repeated as verified coverage. Reported result: **3,003 of 3,105
  parcels (96%) carry a `gis_lon`/`gis_lat`** and the GIS columns (`gis_*`).
  The 102 unmatched are mostly retired/exempt parcels or ones VCGI hasn't mapped;
  `gis_match=none` flags them.
- **SPAN** (Vermont's statewide parcel ID) is present in both datasets but is *not*
  unique in VCGI — condos share one building SPAN across many units — so PARCID is
  the better join key.

## Historical pipeline (`warren/scripts/`)

Stdlib-only Python. **The commands below are historical, not a working rerun
procedure.** `parse_all.py`, `fetch_vcgi.py` and `join_nemrc_vcgi.py` still resolve
some input/output paths relative to `warren/scripts/`, while the retained data
is in `raw_html/` and `outputs/`. Repair and test those paths before regeneration;
do not overwrite the reviewed export just to test the old commands.

```bash
cd warren/scripts

# 1. parcel list + summary (empty NEMRC search = all records):
curl -s "https://nemrc.info/web_data/vtwarr/resultsT.php" \
  --data "parcelID=&ownerName=&parcelStreetNum=&parcelLocation=&siteName=Warren&siteCode=vtwarr&tableName=VTWARRCAMA&module=ca&searchFldCount=4" \
  -o ../outputs/_all_records_summary.html
grep -oE "camadetailT\.php\?prop=[0-9A-Za-z]+" ../outputs/_all_records_summary.html \
  | sed 's/.*prop=//' | sort -u > ../outputs/parcels.txt

# 2. NEMRC assessment data
bash fetch_all.sh          # download detail pages -> warren/raw_html/ (git-ignored)
python3 parse_all.py       # -> properties / buildings / land CSV + JSON

# 3. VCGI parcel GIS + join
python3 fetch_vcgi.py      # -> warren_parcels.geojson + warren_parcels_gis.csv
python3 join_nemrc_vcgi.py # -> warren_joined.csv
```

| Script | Role |
|--------|------|
| `fetch_all.sh` | Download all NEMRC camadetail pages (idempotent, 6 workers) |
| `parse_detail.py` | Parse one camadetail HTML page → flat dict (importable) |
| `parse_all.py` | Parse the whole cache → properties / buildings / land / JSON |
| `fetch_vcgi.py` | Pull Warren parcels (geometry + attributes) from VCGI |
| `join_nemrc_vcgi.py` | Join NEMRC ↔ VCGI on PARCID/SPAN, add approximate lon/lat map point |

## Retained housing invariants

- Infer dwellings from positive evidence, not missing records.
- Prefer `DESCPROP` to unreliable Grand List `CAT` dwelling classifications.
- Keep the homestead/entity validation in `src/schemas.py`; check current law
  separately before presenting it as policy advice.
- Check inference changes against the [calibration evidence](../docs/data-documentation/CALIBRATION_PROPERTIES.md).
- Keep schema validation in Pydantic field definitions; do not confuse those
  names with the separate ORM fields in `src/models.py`.

## Sources

- **NEMRC property card:** `https://nemrc.info/web_data/vtwarr/camadetailT.php?prop=<PARCEL_ID>` (column `nemrc_url`).
- **VCGI statewide standardized parcels** (public ArcGIS, no auth):
  `https://services1.arcgis.com/BkFxaEFNwHqX3tAw/arcgis/rest/services/FS_VCGI_OPENDATA_Cadastral_VTPARCELS_poly_standardized_parcels_SP_v1/FeatureServer/0`
- **AxisGIS viewer:** <https://www.axisgis.com/WarrenVT> (interactive only; same NEMRC CAMA database).

## Not included

**May 2026 acquisition limit — CAI Property Card PDFs.** The "CAI Property Card" link was generated inside the
AxisGIS app, and tested URL patterns were blocked or returned 404 at that time.
Current access has not been retested. The export contains the reviewed NEMRC
fields, not a verified copy of every field or attachment in those PDFs.

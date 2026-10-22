# Open Valley Data Sources

Reference for all data sources, APIs, and import pipelines.

For entity relationships and data models, see `docs/DATA_ARCHITECTURE.md`.

---

## Data Architecture Overview

### Medallion Architecture (Bronze → Silver → Gold)

| Layer | Purpose | Tables |
|-------|---------|--------|
| **Bronze** | Raw API data, no transformation | `bronze_pttr_transfers`, `bronze_str_listings` |
| **Silver** | Validated, linked to entities | `parcels`, `dwellings`, `str_listings`, `property_transfers`, `people`, `organizations` |
| **Gold** | Aggregated analytics | Views, materialized tables |

### Core Entity Hierarchy

```
Parcel (1,823) → Dwelling (2,175) → STR Listing (605)
       ↓
PropertyOwnership → Person (central entity)
       ↓                    ↓
Organization        FPF Posts (58k)
```

See `src/schemas.py` for Pydantic validation models with Act 73 rules.

---

## Table of Contents

1. [Integrated Sources](#integrated-sources)
   - [Vermont Geodata - Parcels](#1-vermont-geodata---parcels)
   - [Front Porch Forum](#2-front-porch-forum-fpf)
   - [Vermont Property Transfers (PTTR)](#3-vermont-property-transfers-pttr)
   - [AirROI - STR Listings](#4-airroi---str-listings)
2. [Available for Integration](#available-for-integration)
   - [Apify Scrapers](#5-apify-scrapers)
3. [Potential Future Sources](#potential-future-sources)
4. [Data Reconciliation](#data-reconciliation)

---

## Integrated Sources

### 1. Vermont Geodata - Parcels

**Status**: ✅ Integrated | **Records**: 1,823 parcels | **Update**: Annual

#### Source Information

| Property | Value |
|----------|-------|
| Provider | Vermont Center for Geographic Information (VCGI) |
| Portal | [geodata.vermont.gov](https://geodata.vermont.gov/pages/parcels) |
| Data Type | ArcGIS REST API / GeoJSON |
| Coverage | Statewide, filtered to Warren |

#### API Endpoint

```
https://services1.arcgis.com/BkFxaEFNwHqX3tAw/arcgis/rest/services/
FS_VCGI_OPENDATA_Cadastral_VTPARCELS_poly_standardized_parcels_SP_v1/FeatureServer/0/query
```

#### Query Example

```python
params = {
    "where": "TOWN = 'WARREN'",
    "outFields": "*",
    "f": "geojson"
}
```

#### Fields Used

| API Field | Our Field | Description |
|-----------|-----------|-------------|
| `GLIST_SPAN` | `span` | Vermont parcel ID (unique) |
| `E911ADDR` | `address` | Property street address |
| `OWNER1`, `OWNER2` | `owners.name` | Owner name(s) |
| `ADDRGL1`, `ADDRGL2`, `CITYGL`, `STGL`, `ZIPGL` | `owners.mailing_address` | Owner mailing address |
| `ACRESGL` | `acres` | Parcel acreage |
| `LAND_LV` | `assessed_land` | Land assessed value |
| `IMPRV_LV` | `assessed_building` | Building assessed value |
| `REAL_FLV` | `assessed_total` | Total assessed value |
| `CAT` | `property_type` | Property category code |
| `HSDECL` | `tax_status.homestead_filed` | Homestead declaration (Y/N) |
| `HSITEVAL` | `tax_status.housesite_value` | Housesite value for exemption |
| `geometry` | `geometry` | MultiPolygon boundaries |

#### Import Script

```bash
cd api
uv run python scripts/import_parcels.py --import
```

#### Notes

- Geometry is in EPSG:4326 (WGS84)
- Centroids calculated for lat/lng point locations
- Property type derived from CAT code and DESCPROP field

---

### 2. Front Porch Forum (FPF)

**Status**: ✅ Integrated
**Records**: 58,174 posts from 6,438 people
**Update Frequency**: Manual (Gmail export)

#### Source Information

| Property | Value |
|----------|-------|
| Provider | Front Porch Forum daily email digests |
| Access Method | Gmail API export → JSON → PostgreSQL |
| Coverage | Mad River Valley (Warren, Waitsfield, Fayston, Moretown, etc.) |
| Date Range | ~2015 - present |

#### Data Pipeline

```
Gmail API → fetch_fpf_emails.py → data/fpf_emails/*.json
                                          ↓
                                  parse_fpf_emails.py
                                          ↓
                                  PostgreSQL (fpf_posts, fpf_people, fpf_issues)
                                          ↓
                                  embed_fpf_posts.py
                                          ↓
                                  pgvector embeddings (semantic search)
```

#### Tables

**fpf_issues** - Daily digest emails
| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `issue_number` | Integer | FPF issue number |
| `published_at` | DateTime | Publication date |
| `gmail_id` | String | Gmail message ID |
| `subject` | Text | Email subject line |

**fpf_people** - Community members
| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `name` | Text | Person's name |
| `email` | String | Email (unique) |
| `road` | Text | Road/street mentioned |
| `town` | String | Town (Warren, Waitsfield, etc.) |

**fpf_posts** - Individual posts
| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `title` | Text | Post title |
| `content` | Text | Full post content |
| `category` | String | Category (Announcements, For sale, etc.) |
| `embedding` | Vector(3072) | OpenAI embedding for semantic search |

#### Import Scripts

```bash
cd api

# Full pipeline
uv run python scripts/run_fpf_pipeline.py

# Individual steps
uv run python scripts/fetch_fpf_emails.py    # Requires Gmail credentials
uv run python scripts/parse_fpf_emails.py    # Parse JSON to DB
uv run python scripts/embed_fpf_posts.py     # Generate embeddings
```

#### Requirements

- Gmail API credentials (`credentials.json`)
- OpenAI API key for embeddings
- ~$1.50 for full embedding generation (58k posts)

---

### 3. Vermont Property Transfers (PTTR)

**Status**: ✅ Integrated | **Records**: 1,870 bronze / 1,217 silver | **Update**: Weekly

#### Source Information

| Property | Value |
|----------|-------|
| Provider | Vermont Department of Taxes via VCGI |
| Portal | [VT Property Transfers](https://geodata.vermont.gov/datasets/VCGI::vt-property-transfers/explore) |
| Legal Basis | 32 V.S.A. § 9606 |
| Data Type | ArcGIS REST API |

#### API Endpoint

```
https://services1.arcgis.com/BkFxaEFNwHqX3tAw/arcgis/rest/services/
FS_VCGI_OPENDATA_Cadastral_PTTR_point_WM_v1_view/FeatureServer/0/query
```

#### Query Example

```python
import urllib.request
import urllib.parse
import json

url = "https://services1.arcgis.com/BkFxaEFNwHqX3tAw/arcgis/rest/services/FS_VCGI_OPENDATA_Cadastral_PTTR_point_WM_v1_view/FeatureServer/0/query"

params = {
    "where": "TOWNNAME = 'Warren'",
    "outFields": "*",
    "resultRecordCount": "2000",
    "orderByFields": "closeDate DESC",
    "f": "json"
}

full_url = url + "?" + urllib.parse.urlencode(params)

with urllib.request.urlopen(full_url) as response:
    data = json.loads(response.read().decode())
    features = data.get('features', [])
```

#### Available Fields

**Transaction Details**
| Field | Alias | Description |
|-------|-------|-------------|
| `closeDate` | Closing Date | Date of sale |
| `RlPrVlPdTr` | Real Property Value | Sale price |
| `ValPdOrTrn` | Total Value | Total value paid/transferred |
| `TotlTaxDue` | Total Tax Due | Transfer tax amount |

**Parcel Identification**
| Field | Alias | Description |
|-------|-------|-------------|
| `span` | SPAN | Vermont parcel ID (**links to our data**) |
| `TownSpan` | Town SPAN | Town-specific SPAN |
| `propLocStr` | Property Location | Street address |
| `TOWNNAME` | Town Name | Town name |
| `Latitude` / `Longitude` | Coordinates | Point location |

**Seller Information**
| Field | Alias | Description |
|-------|-------|-------------|
| `sellEntNam` | Seller Entity | Business/trust name |
| `sellLstNam` / `sellFstNam` | Seller Name | Individual name |
| `sellerSt` | Seller State | State of residence |
| `sUsePrDesc` | Seller Use | Prior use of property |
| `SellerAcq` | Date Acquired | When seller acquired |

**Buyer Information**
| Field | Alias | Description |
|-------|-------|-------------|
| `buyEntNam` | Buyer Entity | Business/trust name |
| `buyLstNam` / `buyFstNam` | Buyer Name | Individual name |
| `buyerState` | Buyer State | State of residence |
| `bUsePrDesc` | Buyer Use | Intended use of property |

**Property Details**
| Field | Alias | Description |
|-------|-------|-------------|
| `landSize` | Land Size | Acreage |
| `blCn1Desc` | Building Type | Construction type (Condominium, etc.) |
| `intUDPdesc` | Interest Type | Fee Simple, Undivided, etc. |
| `TownGlValu` | Grand List Value | Assessed value at time of sale |

**Use Categories** (for `sUsePrDesc` / `bUsePrDesc`)
| Code | Description |
|------|-------------|
| Domicile/Primary Residence | Owner's primary home |
| Principal Residence | Same as above (legacy) |
| Secondary Residence | Vacation/second home |
| Non-PR-YearRound | Non-primary, year-round habitable |
| Non-PR-LongRental | Long-term rental property |
| Open Land | Undeveloped land |
| Commercial | Business use |
| Operating Farm | Agricultural |

#### Warren Statistics (2019-present)

**Buyer State Distribution**
| State | Count | % |
|-------|-------|---|
| Vermont | 710 | 38% |
| Massachusetts | 566 | 30% |
| Connecticut | 113 | 6% |
| New York | 102 | 5.5% |
| New Jersey | 69 | 3.7% |
| Florida | 53 | 2.8% |

**Buyer Intended Use**
| Use | Count | % |
|-----|-------|---|
| Secondary Residence | 909 | 49% |
| Open Land | 267 | 14% |
| Primary Residence | 308 | 16% |
| Non-PR-YearRound | 148 | 8% |

**Price Statistics**
| Metric | Value |
|--------|-------|
| Total Valid Sales | 1,217 |
| Total Volume | $426,679,956 |
| Median Price | $235,000 |
| Average Price | $350,600 |

#### Import Pipeline (Bronze → Silver)

```bash
cd api

# Full import: fetch from API + transform to silver
uv run python scripts/import_pttr.py --all

# Or step by step:
uv run python scripts/import_pttr.py --fetch      # API → bronze
uv run python scripts/import_pttr.py --transform  # bronze → silver
uv run python scripts/import_pttr.py --stats      # Show statistics
```

#### Latest Statistics (Jan 2026)

| Year | Transfers | Total Volume | Avg Price | Out-of-State | Secondary |
|------|-----------|--------------|-----------|--------------|-----------|
| 2020 | 239 | $98.7M | $413k | 71% | 67% |
| 2021 | 208 | $63.5M | $305k | 65% | 61% |
| 2022 | 161 | $63.7M | $396k | 69% | 65% |
| 2023 | 105 | $37.8M | $360k | 69% | 57% |
| 2024 | 161 | $60.8M | $378k | 58% | 32% |
| 2025 | 119 | $53.6M | $450k | 61% | 0%* |

*2025 "Secondary Residence" designation not yet captured in most filings.

**Key Insight**: ~64% of buyers are out-of-state, ~52% designate as secondary residence.

#### Database Tables

**bronze_pttr_transfers** (Raw API data)
- `objectid`: API record ID
- `span`: Vermont parcel ID
- `sale_price`, `transfer_date`: Transaction details
- `buyer_state`, `intended_use`: Residency signals
- `raw_json`: Full API response

**property_transfers** (Silver - validated, linked)
- `parcel_id`: Foreign key to parcels table
- `is_out_of_state_buyer`: Normalized flag
- `is_primary_residence`, `is_secondary_residence`: Derived from intended use

---

### 4. AirROI - STR Listings

**Status**: ✅ Integrated | **Records**: 605 Warren listings | **Update**: Monthly

#### Source Information

| Property | Value |
|----------|-------|
| Provider | [AirROI](https://airroi.com) |
| Endpoint | `POST https://api.airroi.com/listings/search/market` |
| Auth | `X-API-KEY` header |
| Coverage | Mad River Valley (Warren, Waitsfield, Fayston, etc.) |

#### Mad River Valley STR Counts

| Town | Listings |
|------|----------|
| Warren | 605 |
| Fayston | 214 |
| Waitsfield | 145 |
| Duxbury | 53 |
| Moretown | 37 |

#### Import Script

```bash
uv run python scripts/import_airroi.py --all --city Warren
```

#### Database Tables

**bronze_str_listings** (Raw API data)
- `listing_id`, `platform`: Airbnb/VRBO identifier
- `lat`, `lng`: Coordinates (used for parcel matching)
- `bedrooms`, `price_per_night`, `total_reviews`
- `raw_json`: Full API response

**str_listings** (Silver - matched to parcels)
- `parcel_id`: Foreign key via spatial centroid match (96% match rate)
- `match_method`: "spatial_centroid", "address", "manual"

#### Key Insight

605 STR listings → 580 matched to parcels. Each STR now has actual street address from parcel layer.

---

## Available for Integration

### 5. Apify Scrapers

**Status**: 🔵 Available (alternative to AirROI)

| Platform | Actor | Notes |
|----------|-------|-------|
| Airbnb | [tri_angle/airbnb-scraper](https://apify.com/tri_angle/airbnb-scraper) | ~$2 per 1,000 results |
| VRBO | [jupri/vrbo-property](https://apify.com/jupri/vrbo-property) | Varies |

Useful for spot-checking AirROI data or accessing additional fields (reviews, amenities, host details).

**Limitations**: Max ~240 results per search query, rate limits apply.

---

## Potential Future Sources

### Vermont Department of Taxes - Grand List

Historical assessment data by year. Would enable tracking value changes over time.

**Access**: Public records request or town clerk offices
**Format**: Varies by town (PDF, Excel, database)

### Vermont Secretary of State - Business Registry

For identifying LLCs/trusts that own property.

**Portal**: [sos.vermont.gov](https://sos.vermont.gov/corporations/business-search/)
**Access**: Web search, no bulk API

### Town of Warren - Land Records

Deed records, mortgage information.

**Access**: Town Clerk's Office
**Format**: Physical records, some digitized

### AirDNA

Commercial vacation rental analytics.

**Website**: [airdna.co](https://www.airdna.co/)
**Access**: Paid subscription
**Data**: STR performance metrics, occupancy rates, revenue estimates

### Zillow/Realtor APIs

Historical sale prices, Zestimates, market data.

**Access**: Commercial API agreements
**Limitations**: Terms of service restrictions

---

## Data Reconciliation

### Matching STR Listings to Parcels

STR listings (Airbnb/VRBO) need to be matched to our parcel layer for analysis.

#### Method 1: Spatial Join (Primary)

```sql
-- Match STR point to parcel polygon
SELECT
    str.listing_id,
    str.name,
    p.span,
    p.address
FROM str_listings str
JOIN parcels p ON ST_Contains(p.geometry, ST_SetSRID(ST_Point(str.lng, str.lat), 4326));
```

#### Method 2: Address Fuzzy Matching (Fallback)

```python
from fuzzywuzzy import fuzz

def match_address(str_address: str, parcel_addresses: list[str]) -> str | None:
    """Find best matching parcel address."""
    best_match = None
    best_score = 0

    for parcel_addr in parcel_addresses:
        score = fuzz.token_sort_ratio(
            normalize_address(str_address),
            normalize_address(parcel_addr)
        )
        if score > best_score and score > 80:
            best_score = score
            best_match = parcel_addr

    return best_match
```

#### Matching Challenges

| Challenge | Solution |
|-----------|----------|
| Condos with same address | Use unit numbers, bedroom count |
| Approximate STR coordinates | Buffer search (50m radius) |
| Address format variations | Normalize (ST→STREET, RD→ROAD) |
| Missing unit numbers | Manual review queue |

### Matching Property Transfers to Parcels

Property transfers include SPAN which directly links to our parcel data.

```sql
-- Link transfer to parcel
SELECT
    t.*,
    p.address,
    p.assessed_total,
    ts.homestead_filed
FROM property_transfers t
JOIN parcels p ON t.span = p.span
LEFT JOIN tax_status ts ON p.id = ts.parcel_id;
```

---

## Environment Variables

```bash
# api/.env

# Database
DATABASE_URL=postgresql://openvalley:openvalley@localhost:5432/openvalley

# AI/Embeddings
PYDANTIC_AI_GATEWAY_API_KEY=<gateway-key>
OPENAI_API_KEY=<openai-key>

# Apify (for STR scraping)
APIFY_API_TOKEN=<apify-token>

# Gmail (for FPF import)
# Requires credentials.json in api/ directory

# Observability (optional)
LOGFIRE_TOKEN=<logfire-token>
```

---

## References

### Vermont Government
- [Vermont Open Geodata Portal](https://geodata.vermont.gov/)
- [VCGI Documentation](https://vcgi.vermont.gov/data-and-programs)
- [Vermont Department of Taxes](https://tax.vermont.gov/)
- [Property Transfer Tax Info](https://tax.vermont.gov/property/property-transfer-tax)

### APIs & Tools
- [ArcGIS REST API Reference](https://developers.arcgis.com/rest/)
- [Apify Documentation](https://docs.apify.com/)
- [PostGIS Reference](https://postgis.net/documentation/)
- [pgvector](https://github.com/pgvector/pgvector)

### Related Projects
- [VT Real Estate Values](https://www.vtrealestatevalues.com/) - Third-party PTTR search
- [Vermont Parcel Viewer](https://experience.arcgis.com/experience/b5a5cc7663c84761a305f70b913e1a60)

---

*Last updated: January 2026*

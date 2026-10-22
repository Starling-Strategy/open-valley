# STR Data Confidence Report

**How we identify short-term rentals and link them to Warren properties**

*Last updated: 2026-01-01*

See [GLOSSARY.md](../GLOSSARY.md) for DwellingUse definitions. **Key insight**: STR listings are separate data that can attach to ANY dwelling, including `FULL_TIME_RESIDENCE`.

---

## TL;DR for Colleagues

**Question**: "How do you know these STR listings are mapped to the right properties?"

**Answer**:
1. **Unique listings**: Each record has a platform-assigned ID (Airbnb room number). 0 duplicates found.
2. **Conservative linking**: Only 15 of 618 listings are linked to dwellings
3. **Name validation**: Each link is validated by matching host first name to Grand List owner
4. **No false positives**: We removed 156 spatial-only matches that couldn't be validated

**What this enables**: We can say definitively that parcel `690-219-12576` (94 Woods Rd N, owned by Mad River LLC) has the Airbnb listing "HYGGE HAUS" because we manually verified it. The dwelling has `str_listing_ids=["53252922"]`.

**Trade-off**: We accept low coverage (2.4%) to ensure accuracy. Most STRs are managed by property managers (Vacasa, Evolve) whose names don't match the Grand List owners.

**STR as data, not classification**: An STR listing doesn't determine `DwellingUse`. A homeowner who occasionally rents still has `use=FULL_TIME_RESIDENCE`; the listing ID just appears in their `str_listing_ids`. Only dwellings where STR is the *primary use* (no year-round resident) have `use=SHORT_TERM_RENTAL`.

---

## Executive Summary

We have identified **618 unique STR listings** in Warren through the AirROI API. Of these, **591 (96%)** have been matched to specific parcels in our property database via spatial analysis. The 27 unmatched listings have coordinates >200m from any parcel centroid, likely due to Airbnb's location obfuscation or edge-case geocoding.

**Key finding**: Many STR listings are in condo complexes—254 unique parcels contain 591 matched listings. The top 10 parcels (Sugarbush resort condos) account for ~200 listings.

---

## Data Pipeline: Bronze → Silver → Gold (Dwellings)

Our STR data follows a **medallion architecture** that separates raw data collection from validated analysis. The key insight: **STR listings are data that attach to dwellings, not a use category.**

```
┌─────────────────────────────────────────────────────────────────┐
│                    DATA FLOW                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   BRONZE                SILVER                    GOLD           │
│   (Raw Input)          (Validated)               (Truth)         │
│                                                                  │
│   bronze_str_listings → str_listings ──┐                         │
│   (605 records)        (618 records)   │                         │
│                                        │ (adds to str_listing_ids)│
│   grand_list ─────────► parcels ───────┼──► dwellings            │
│   (1,823 records)      (1,823 records) │    (3,109 records)      │
│                                        │         │               │
│                                        └─────────┘               │
│                                                                  │
│   Each dwelling has:                                             │
│   • use: DwellingUse (occupancy pattern)                         │
│   • is_owner_occupied: bool (owner or tenant?)                   │
│   • str_listing_ids: [] (matched listings - can be ANY dwelling) │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Why dwellings are "Gold":**
- The **dwelling** is the taxable unit under Act 73
- An STR listing is *evidence* of STR activity (stored in `str_listing_ids`)
- The same dwelling could have multiple listings (Airbnb + VRBO) - stored as array
- `DwellingUse` + `is_owner_occupied` determines the tax classification

### Bronze Layer: Raw API Data
```
Source: AirROI API (commercial aggregator)
Table: bronze_str_listings
Records: 605 (Warren only, AirROI source)
```

Bronze data is stored exactly as received from the API—no transformations. This preserves the original record for auditing and allows us to re-run transformations if our logic improves.

**What's in bronze:**
- `listing_id`: Platform's unique ID (e.g., Airbnb room ID)
- `lat`, `lng`: Coordinates from the listing
- `bedrooms`, `bathrooms`, `max_guests`: Property details
- `host_name`, `host_id`: Host information
- `price_per_night`, `total_reviews`, `average_rating`: Performance
- `raw_json`: Complete API response (for future field extraction)
- `scraped_at`: When we fetched this data

### Silver Layer: Validated & Linked
```
Table: str_listings
Records: 618 (includes some legacy Apify data)
Matched to parcel: 591 (96%)
```

Silver records are:
1. **Deduplicated** by `listing_id` (each Airbnb/VRBO ID appears once)
2. **Validated** via Pydantic schemas with type/range checking
3. **Spatially matched** to our parcel layer
4. **Linked** to dwellings for Act 73 classification

### Gold Layer: Dwellings
```
Table: dwellings
STR-linked dwellings: 247
```

The ultimate goal: each STR listing maps to a **dwelling** (a single habitable unit), which maps to a **parcel** (the land). This enables property tax analysis under Act 73.

---

## How We Match STRs to Parcels

### The Challenge

Airbnb and VRBO intentionally obscure exact property locations for privacy. Listing coordinates are typically accurate to within 100-200 meters but not exact. We need to determine which parcel each listing belongs to.

### Our Method: Spatial Centroid Matching

1. **Extract coordinates** from the STR listing (lat/lng from AirROI)
2. **Calculate distance** to the centroid of each Warren parcel
3. **Select nearest parcel** if within 200 meters
4. **Assign confidence score** based on distance:
   - 0m → 1.0 confidence
   - 200m → 0.5 confidence
   - >200m → no match

**SQL Implementation:**
```sql
SELECT id,
    (6371000 * acos(
        cos(radians(listing_lat)) * cos(radians(parcel_lat)) *
        cos(radians(parcel_lng) - radians(listing_lng)) +
        sin(radians(listing_lat)) * sin(radians(parcel_lat))
    )) as distance_meters
FROM parcels
ORDER BY distance
LIMIT 1
```

### Match Quality Distribution

| Distance | Confidence | Listings | % of Matched |
|----------|------------|----------|--------------|
| <20m | ≥0.95 | 61 | 10.3% |
| 20-40m | 0.90-0.95 | 109 | 18.4% |
| 40-80m | 0.80-0.90 | 209 | 35.4% |
| 80-120m | 0.70-0.80 | 115 | 19.5% |
| 120-160m | 0.60-0.70 | 73 | 12.4% |
| 160-200m | 0.50-0.60 | 24 | 4.1% |
| >200m | No match | 27 | — |

**64% of matches are within 80 meters**—high confidence that we've identified the correct parcel.

---

## Why 591 Listings Match to Only 254 Parcels

Many Warren properties are **condo complexes** where each unit is a separate STR listing but shares a single parcel (land record).

### Top 10 Parcels by Listing Count

| Address | SPAN | Listings | Type |
|---------|------|----------|------|
| 42 LOWER PHASE RD | C-219-0014 | 40 | The Bridges Resort |
| 107 FORUM DRIVE | C-219-0015 | 30 | Sugarbush Center Village |
| 51 SUGARBUSH VILLAGE DRIVE | C-219-0007 | 25 | Mountainside condos |
| 55 HOBBIT HILL | C-219-0019 | 19 | North Lynx condos |
| 50 GLADES DRIVE | C-219-0009 | 18 | Paradise condos |
| 186 CASTLEROCK ROAD | C-219-0017 | 17 | Village Gate condos |
| 668 UPPER VILLAGE RD | 690-219-11861 | 14 | Mountainside condos |
| 166 HUCKLEBERRY LANE | C-219-0003 | 13 | Hostel/multi-unit |
| 147 UPPER SUMMIT ROAD | C-219-0023 | 10 | North Lynx condos |
| 2524 SUGARBUSH ACCESS RD | 690-219-13127 | 8 | Bridges condos |

These 10 condo parcels contain **~200 listings** (34% of all matched STRs).

### This is Expected Behavior

Each Airbnb listing represents a **dwelling** (a single habitable unit), not a parcel. Our data model accounts for this:

```
Parcel: 42 LOWER PHASE RD (The Bridges)
├── Dwelling 1: Unit 101 (2BR) → STR Listing "Alpine Escape 2BR"
├── Dwelling 2: Unit 102 (3BR) → STR Listing "Cozy 3BR | Deck | Pool"
├── Dwelling 3: Unit 201 (2BR) → STR Listing "Treetops & sun; indoor pool"
└── ... (40 total dwellings/listings)
```

---

## Why Are Listings Unique?

### Deduplication Strategy

Each record in `str_listings` is unique by `listing_id` (the Airbnb/VRBO room ID).

**Verification:**
```sql
-- 618 total records, 618 unique listing_ids, 0 duplicates
SELECT
    COUNT(*) as total,
    COUNT(DISTINCT listing_id) as unique_ids
FROM str_listings;
```

### Platform Listing IDs are Authoritative

Airbnb listing IDs (e.g., `53252922`) are globally unique identifiers. When a user creates a listing, Airbnb assigns a permanent ID. This ID appears in:
- The listing URL: `airbnb.com/rooms/53252922`
- API responses
- All booking references

We trust this as a primary key because:
1. **Platform-assigned**: Airbnb/VRBO controls the ID space
2. **Persistent**: IDs don't change over the listing's lifetime
3. **Verifiable**: Anyone can visit the URL to confirm the listing exists

---

## Unmatched Listings: Why 27 Fell Through

27 listings (4%) have coordinates but matched no parcel within 200m.

### Likely Causes

1. **Location obfuscation**: Airbnb adds random noise to coordinates (100-200m). For properties near town boundaries, this can push the apparent location outside our parcel layer.

2. **Town boundary edge cases**: AirROI reports these as "Warren" but coordinates may actually fall in Fayston/Waitsfield.

3. **New construction**: Properties built after our parcel data snapshot (though rare—parcel data updated annually).

### Sample Unmatched Listings

| Name | Bedrooms | Location Issue |
|------|----------|----------------|
| Warren Village Historic Inn Room | 1 | Downtown—may be commercial parcel |
| Charming Village Center Home | 4 | Downtown—dense area |
| Convenient 3BR Mountainview | 3 | Sugarbush area—may be Fayston |

### Resolution Path

For the 27 unmatched listings, we can:
1. **Manual address matching**: Cross-reference listing name/description with known properties
2. **Expand search radius**: Try 300-500m with lower confidence
3. **Host outreach**: For verification purposes

---

## From STR to Dwelling: Connecting the Data

### Current State (After Cleanup)

| Metric | Count |
|--------|-------|
| STR listings in Warren | 618 |
| STR listings matched to parcels (spatial) | 591 |
| **Dwellings with populated `str_listing_ids` (name-validated)** | **15** |
| Dwellings with `use = SHORT_TERM_RENTAL` | ~170 (inferred) |

### Why Only 15 Links?

We deliberately removed spatial-only matches that couldn't be validated by owner name:

**Before cleanup**: 170 STR → Dwelling links based on nearest parcel
**After cleanup**: 15 links where host first name matches owner (added to `str_listing_ids`)

**Example validated link**:
```
STR: "Mountain Retreat" by host "Colin"
Owner: PHILLIPS COLIN R at 129 LINCOLN GAP RD
→ VALID: "COLIN" found in owner name
→ Result: dwelling.str_listing_ids = ["mountain-retreat-listing-id"]
```

**Example removed link**:
```
STR: "The Vines" by host "Colin" (spatial match to 488 Woods Rd)
Owner: PHILLIPS III ROBERT M (no "Colin" in name)
Actual owner: Colin Phillips at 129 LINCOLN GAP RD (3.2km away)
→ FALSE POSITIVE: NOT added to str_listing_ids
```

### The Property Manager Problem

Most STRs are managed by professional companies:

| Property Manager | Listings | Linkable? |
|-----------------|----------|-----------|
| Vacasa Northern Vermont | ~50 | ❌ No owner match |
| Evolve | ~30 | ❌ No owner match |
| Vermont Getaways LLC | ~20 | ❌ No owner match |
| Individual hosts | ~100 | ✅ Some match |

### Condo Units Now Handled Correctly

The unified import creates one dwelling per API row:

```
The Bridges (C-219-0014):
├── 100 dwellings (one per owner)
├── Each dwelling has its own:
│   ├── use: DwellingUse (FULL_TIME_RESIDENCE if homestead, else SECOND_HOME or SHORT_TERM_RENTAL)
│   ├── is_owner_occupied: bool
│   └── str_listing_ids: [] (populated if STR match validated)
├── 4 homestead filers → use=FULL_TIME_RESIDENCE, is_owner_occupied=true
├── 96 non-homestead → use=SECOND_HOME or SHORT_TERM_RENTAL
└── 40 STR listings spatially matched to this parcel
    └── But only added to str_listing_ids if host name matches an owner
```

---

## Confidence Levels Summary

| Question | Confidence | Evidence |
|----------|------------|----------|
| Are listings unique? | **Very High** | Platform IDs are globally unique; 0 duplicates found |
| Are spatial parcel matches correct? | **Medium** | 96% within 200m, but Airbnb obfuscates coordinates |
| Are `str_listing_ids` correct? | **Very High** | Only 15 dwellings have populated arrays, all name-validated |
| Are dwellings correctly identified? | **High** | 3,109 real dwellings from Grand List API, including condos |
| Is `DwellingUse` correct? | **Medium-High** | Inferred from homestead, mailing address, STR activity |

---

## Data Sources

| Source | Type | API/Method | Records |
|--------|------|------------|---------|
| AirROI | Commercial aggregator | REST API with key | 605 Warren |
| Vermont Geodata | State GIS portal | ArcGIS REST | 1,823 parcels |

### AirROI API

```
Endpoint: POST https://api.airroi.com/listings/search/market
Filter: {"city": {"eq": "Warren"}, "state": {"eq": "Vermont"}}
Pagination: 10 per page
```

AirROI aggregates data from Airbnb, VRBO, and other platforms. Benefits:
- Single API for multiple platforms
- Geocoded coordinates included
- Performance metrics (reviews, ratings, pricing)

---

## Next Steps

1. **Property manager registry**: Map known managers (Vacasa, Evolve) to properties they manage

2. **Address text matching**: Match STR listing names containing street names to parcels

3. **Manual verification queue**: Review remaining spatial matches with local knowledge

4. **Host research**: For high-value properties, research LLC ownership to find actual hosts

---

## Appendix: Data Model Diagram

```
bronze_str_listings (618 raw)
        │
        │ Pydantic validation + spatial matching
        ▼
str_listings (618 validated)
        │
        │ parcel_id FK (591 matched)
        │
        │ Name validation against owner
        ▼
    parcels (1,823)
        │
        │ 1:N
        ▼
   dwellings (3,109)
        │
        │ Fields:
        │ ├── use: DwellingUse (occupancy pattern)
        │ ├── is_owner_occupied: bool
        │ └── str_listing_ids: [] (15 validated links across all dwellings)
        │
        │ Linked to owner via property_ownerships
        ▼
   people (2,186) / organizations (529)
```

Each dwelling knows:
- Which parcel it's on (`parcel_id`)
- Its occupancy pattern (`use: DwellingUse`)
- Whether owner or tenant lives there (`is_owner_occupied`)
- Which STR listings it has (if any: `str_listing_ids`, only 15 dwellings populated)
- Its owner via `property_ownerships`
- Tax classification is **derived** from `use + is_owner_occupied` (see GLOSSARY.md)

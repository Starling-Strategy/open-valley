# Transition Map Methodology

**Last Updated**: 2026-01-02

This document explains exactly how the animated homestead transitions map works, including why a specific transfer might or might not appear.

---

## Overview

The animation at `/story` visualizes property transfers from 2019-2025 to show Warren's "de-homesteading" trend—the net loss of primary residences as homes are sold to second-home buyers.

**Summary**: Of 1,217 total property transfers, 1,107 (91%) appear on the map.

---

## Data Pipeline

```
PTTR API (VT Property Transfer Tax Returns)
        │
        ▼
bronze_pttr_transfers (1,870 raw records)
        │
        ▼
property_transfers (1,217 silver records, linked to Warren parcels)
        │
        ▼
/api/transfers/transitions (1,107 geocoded, 2019+)
        │
        ▼
Animation: GAIN (166) | LOSS (184) | OTHER (757)
```

---

## Why A Transfer Might NOT Appear On The Map

### 1. Missing Coordinates (86 transfers, 7.1%)

The PTTR database doesn't have geocoded coordinates for some property types:

| Property Type | Count | Notes |
|--------------|-------|-------|
| Timeshares (Clay Brook) | 60 | Interval ownership, no distinct location |
| Other Timeshares | 14 | Sugarbush Village intervals |
| Open Land/Subdivision | 4 | Undeveloped lots |
| Condo Units | 3 | Address matching failed |
| Other | 5 | Various data quality issues |

**Example**: A timeshare interval at Clay Brook has Latitude=0, Longitude=0 in the PTTR data.

### 2. Before 2019 (24 transfers, 2.0%)

The animation only shows transfers from 2019-01-01 onwards to focus on recent trends.

### 3. Not In Warren (Filtered Earlier)

Only transfers matched to Warren parcels appear. The `property_transfers` silver table already filters to Warren-only.

---

## How Transfers Are Classified

Each transfer on the map is classified into 5 categories based on PTTR seller state and buyer intent:

### TRUE_GAIN (Green Pulse) - 75 transfers

**Criteria**: Out-of-state seller (was 2nd home) → Primary residence buyer

```sql
sellerSt != 'VT' AND sellerSt IS NOT NULL
AND bUsePrDesc IN ('Domicile/Primary Residence', 'Principal Residence')
```

**What it means**: A second home was re-homesteaded — converted to a primary residence.

### TRUE_LOSS (Red Pulse) - 184 transfers

**Criteria**: Vermont seller (was homestead) → Non-primary buyer

```sql
sellerSt = 'VT'
AND (intended_use = 'secondary' OR bUsePrDesc LIKE 'Non-PR%')
```

**What it means**: A homestead was de-homesteaded — converted to a second home.

### STAYED_HOMESTEAD (Blue, smaller) - 87 transfers

**Criteria**: Vermont seller → Primary residence buyer

```sql
sellerSt = 'VT'
AND bUsePrDesc IN ('Domicile/Primary Residence', 'Principal Residence')
```

**What it means**: A homestead stayed a homestead. No net change.

### STAYED_NON_HOMESTEAD (Gray, smaller) - 462 transfers

**Criteria**: Out-of-state seller → Non-primary buyer

```sql
sellerSt != 'VT' AND sellerSt IS NOT NULL
AND (intended_use = 'secondary' OR bUsePrDesc LIKE 'Non-PR%')
```

**What it means**: A second home stayed a second home. No net change.

### OTHER (Dark gray, not shown) - 299 transfers

**Criteria**: Unknown seller state, commercial, open land, etc.

These are typically:
- Transfers with NULL seller state
- Commercial/open land sales
- Ambiguous use declarations

---

## Classification Logic Assumptions

The new 4-category logic makes these assumptions:

### 1. VT Seller = Was Likely Homesteading

We assume Vermont sellers were homesteading their Warren property. This is reasonable because:
- Vermont residents with Warren mailing addresses are likely local
- The 4-category logic now correctly handles VT→VT primary transfers (STAYED_HOMESTEAD)

**Exception case**: Some VT sellers may own Warren property as a second home (Montpelier resident with Warren vacation home). These would be incorrectly counted as TRUE_LOSS.

### 2. Out-of-State Seller = Was 2nd Home

We assume out-of-state sellers were NOT homesteading. This is highly reliable — you can't declare Vermont homestead while living in another state.

### 3. Buyer Intent = Future Status

We trust the buyer's declared intent (primary vs secondary) on the PTTR form. This is legally binding and affects tax rates, so it's generally accurate.

### 4. Open Land = Excluded from Net

Open land sales aren't classified as TRUE_LOSS/TRUE_GAIN because no dwelling exists yet. They appear as OTHER.

---

## Fields Used For Classification

From `bronze_pttr_transfers.raw_json->'attributes'`:

| Field | Description | Example Values |
|-------|-------------|----------------|
| `sellerSt` | Seller's state | VT, MA, NY, CT |
| `bUsePrDesc` | Buyer's intended use | "Secondary Residence", "Domicile/Primary Residence" |
| `Latitude` | Property latitude | 44.1234 or 0 (missing) |
| `Longitude` | Property longitude | -72.8567 or 0 (missing) |
| `span` | Property identifier | 69021911993 (no dashes) |

From `property_transfers`:

| Field | Description |
|-------|-------------|
| `intended_use` | Derived: 'secondary', 'commercial', 'other' |
| `buyer_state` | Buyer's state |
| `transfer_date` | Date of sale |
| `sale_price` | Transaction amount |

---

## Data Quality Notes

### Coordinate Coverage: 93%

PTTR has its own Latitude/Longitude fields from assessor geocoding. We use these directly rather than requiring SPAN matching to our parcel database.

**Before**: 43% coverage (required parcel SPAN match)
**After**: 93% coverage (use PTTR's native coordinates)

### Why Not 100%?

The remaining 7% are mostly:
1. Timeshare intervals (shared ownership, no distinct parcel)
2. Data entry errors in source PTTR records
3. Very recent subdivisions not yet geocoded

---

## Validating A Specific Transfer

To check if a specific transfer appears on the map:

```sql
-- Find a transfer by SPAN
SELECT
    pt.transfer_date,
    b.raw_json::json->'attributes'->>'span' as span,
    (b.raw_json::json->'attributes'->>'Latitude')::float as lat,
    (b.raw_json::json->'attributes'->>'Longitude')::float as lng,
    b.raw_json::json->'attributes'->>'sellerSt' as seller_state,
    b.raw_json::json->'attributes'->>'bUsePrDesc' as use_desc,
    CASE
        WHEN b.raw_json::json->'attributes'->>'sellerSt' = 'VT'
             AND (pt.intended_use = 'secondary'
                  OR b.raw_json::json->'attributes'->>'bUsePrDesc' LIKE 'Non-PR%')
        THEN 'LOSS'
        WHEN b.raw_json::json->'attributes'->>'bUsePrDesc'
             IN ('Domicile/Primary Residence', 'Principal Residence')
        THEN 'GAIN'
        ELSE 'OTHER'
    END as transition_type
FROM property_transfers pt
JOIN bronze_pttr_transfers b ON pt.bronze_id = b.id
WHERE b.raw_json::json->'attributes'->>'span' LIKE '%11993%'  -- Woods Rd example
ORDER BY pt.transfer_date;
```

**If not appearing, check**:
1. `lat = 0` or `lng = 0` → Missing coordinates
2. `transfer_date < '2019-01-01'` → Before animation range
3. No bronze record linked → Import issue

---

## Animation Statistics

As of 2026-01-02 (with corrected 4-category logic):

| Metric | Count |
|--------|-------|
| Total property_transfers | 1,217 |
| With coordinates | 1,131 (93%) |
| After 2019-01-01 | 1,107 (91%) |
| TRUE_GAIN (re-homesteaded) | 75 (6.8%) |
| TRUE_LOSS (de-homesteaded) | 184 (16.6%) |
| STAYED_HOMESTEAD | 87 (7.9%) |
| STAYED_NON_HOMESTEAD | 462 (41.7%) |
| OTHER | 299 (27.0%) |
| **Net Change** | **-109** |

The animation shows Warren lost **109 net primary residences** from 2019-2025.

---

## Corrected Yearly Data

| Year | De-homesteaded | Re-homesteaded | Net | Trend |
|------|----------------|----------------|-----|-------|
| 2019 | -30 | +11 | -19 | De-homesteading |
| 2020 | -40 | +20 | -20 | De-homesteading |
| 2021 | -34 | +10 | -24 | De-homesteading |
| 2022 | -19 | +6 | -13 | De-homesteading |
| 2023 | -21 | +3 | -18 | De-homesteading |
| 2024 | -25 | +13 | -12 | De-homesteading |
| 2025 | -15 | +12 | -3 | De-homesteading |
| **Total** | **-184** | **+75** | **-109** | **All years negative** |

**Key insight**: The previous logic showed 2019 and 2025 as "positive" years, but that was because it counted VT→VT primary transfers as "gains" when they were actually homestead→homestead (no net change). With corrected logic, **every single year shows de-homesteading**.

---

## Source Code

- API endpoint: `src/main.py` → `get_homestead_transitions()`
- Frontend component: `web/src/components/maps/AnimatedTransitionsMap.tsx`
- Story page: `web/src/app/story/page.tsx`

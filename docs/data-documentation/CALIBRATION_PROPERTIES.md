# Calibration Properties: Woods Road

These four properties serve as ground truth for testing and calibrating our dwelling inference model.

See [GLOSSARY.md](../GLOSSARY.md) for DwellingUse definitions and data model.

---

## Summary Table

| # | Address | Owner | Lives | Dwellings | DwellingUse | is_owner_occupied | Derived Tax Class | Status |
|---|---------|-------|-------|-----------|-------------|-------------------|-------------------|--------|
| 1 | 488 Woods Rd S | Phillips | Warren, VT | 1 | `FULL_TIME_RESIDENCE` | `true` | HOMESTEAD | ✅ CORRECT |
| 2 | 448 Woods Rd S | Tremblay/Culmone | Harvard, MA | 1 | `SECOND_HOME` | - | NHS_RESIDENTIAL | ✅ CORRECT |
| 3 | 200 Woods Rd S | Schulthess Fabio | Switzerland | 2* | Main: `SECOND_HOME` + ADU: `FULL_TIME_RESIDENCE` | ADU: `false` | Main: NHS_R, ADU: NHS_NR | ⚠️ MISSING ADU |
| 4 | 94 Woods Rd N | Mad River LLC | Brooklyn, NY | 1 | `SHORT_TERM_RENTAL` | - | NHS_RESIDENTIAL | ✅ CORRECT |

*ADU not in Grand List - requires manual addition (tenant lives there year-round)

### Validation Status (2026-01-02)

| Issue | Original Status | Current Status |
|-------|-----------------|----------------|
| Phillips had 2 dwellings (CAT=R2 bug) | ❌ Wrong | ✅ Fixed - 1 dwelling |
| Tremblay had 2 dwellings (CAT=R2 bug) | ❌ Wrong | ✅ Fixed - 1 dwelling |
| "The Vines" STR incorrectly matched to Phillips | ❌ Wrong | ✅ Fixed - matches 129 Lincoln Gap Rd |
| HYGGE HAUS linked to Mad River LLC | ⏳ Pending | ✅ Fixed - match_confidence 0.85 |
| Schulthess ADU missing | ⏳ Pending | ⏳ Still missing - needs manual add |
| Tremblay not in property_ownerships | ⏳ Unknown | ⚠️ Only Culmone has ownership record |

---

## Property 1: Phillips Family — 488 Woods Rd South

**Ground Truth**: Year-round residents with one single-family home

### Vermont Grand List Data
| Field | Value | Notes |
|-------|-------|-------|
| SPAN | 690-219-11993 | |
| Owner | PHILLIPS III ROBERT M & EMILY | |
| Mailing State | CA | *Stale - family moved from Irvine to Warren* |
| CAT | R2 | **WRONG** - implies multi-family |
| DESCPROP | "7.37 ACRES & DWL" | **CORRECT** - "DWL" = singular |
| HSDECL | Y | Homestead declared |
| HSTED_FLV | $505,800 (100%) | Full value is homestead |

### What's Wrong in Our Data
- **Created 2 dwellings** because CAT=R2 triggered multi-family logic
- **Matched "The Vines" STR** to this parcel (wrong - different property)

### Correct State
```
Parcel: 690-219-11993
└── Dwelling 1: Main house (3br/2.5ba)
    ├── use: FULL_TIME_RESIDENCE
    ├── is_owner_occupied: true
    ├── str_listing_ids: []  (no STR activity)
    └── get_tax_classification() → HOMESTEAD
```

---

## Property 2: Tremblay/Culmone — 448 Woods Rd South

**Ground Truth**: Massachusetts second-home owners

### Vermont Grand List Data
| Field | Value | Notes |
|-------|-------|-------|
| SPAN | 690-219-13192 | |
| Owner | CULMONE FRANK D / TREMBLAY ERICA | |
| Mailing State | MA | Harvard, MA - confirms out-of-state |
| CAT | R2 | **WRONG** - implies multi-family |
| DESCPROP | "8.15 ACRES & DWL." | **CORRECT** - singular dwelling |
| HSDECL | N | No homestead (correct) |
| HSTED_FLV | $0 (0%) | No homestead value |

### What's Wrong in Our Data
- **Created 2 dwellings** because CAT=R2

### Correct State
```
Parcel: 690-219-13192
└── Dwelling 1: Single-family home
    ├── use: SECOND_HOME
    ├── is_owner_occupied: null  (owner visits occasionally)
    ├── str_listing_ids: []  (no STR activity)
    └── get_tax_classification() → NHS_RESIDENTIAL
```

---

## Property 3: Fabio Schulthess — 200 Woods Rd South

**Ground Truth**: Swiss owner with long-term renter in ADU above garage

### Vermont Grand List Data
| Field | Value | Notes |
|-------|-------|-------|
| SPAN | 690-219-12656 | |
| Owner | SCHULTHESS FABIO | |
| Mailing State | (blank) | Actually: Ascona, Switzerland |
| CAT | R1 | Single-family (technically correct for main house) |
| DESCPROP | "3.1 ACRES: & DWL" | Only knows about main dwelling |
| HSDECL | N | No homestead |
| HSTED_FLV | $0 (0%) | |

### What's Wrong in Our Data
- **Missing ADU** - apartment above garage has long-term renter
- **Main house classification** - should reflect owner's actual use

### Correct State
```
Parcel: 690-219-12656
├── Dwelling 1: Main house
│   ├── use: SECOND_HOME  (owner visits from Switzerland)
│   ├── is_owner_occupied: null
│   ├── str_listing_ids: []
│   └── get_tax_classification() → NHS_RESIDENTIAL
│
└── Dwelling 2: ADU above garage **[MANUAL ADD]**
    ├── use: FULL_TIME_RESIDENCE  (tenant lives here year-round)
    ├── is_owner_occupied: false  (tenant, not owner)
    ├── str_listing_ids: []
    ├── get_tax_classification() → NHS_NONRESIDENTIAL  (long-term rental)
    └── notes: "Tenant lives above garage per local knowledge"
```

---

## Property 4: Mad River LLC — 94 Woods Rd North

**Ground Truth**: Brooklyn LLC operating a short-term rental

### Vermont Grand List Data
| Field | Value | Notes |
|-------|-------|-------|
| SPAN | 690-219-12576 | |
| Owner | MAD RIVER LLC | |
| Mailing State | NY | 255 Clinton Street, Brooklyn NY 11201 |
| CAT | R1 | Correct |
| DESCPROP | "2.6 ACRES & DWL:" | Correct |
| HSDECL | N | No homestead (correct for LLC) |

### STR Match
| Field | Value |
|-------|-------|
| Airbnb Listing | [53252922](https://www.airbnb.com/rooms/53252922) |
| STR Name | HYGGE HAUS - Mountain Views Minutes from Sugarbush |
| Bedrooms | 4 |
| Match Confidence | High (listing_id matches Airbnb URL) |

### Current Data Status
- **Correct!** Single dwelling properly matched to STR listing

### Correct State
```
Parcel: 690-219-12576
└── Dwelling 1: Single-family home
    ├── use: SHORT_TERM_RENTAL  (no year-round resident, primarily STR)
    ├── is_owner_occupied: null  (LLC can't live here)
    ├── str_listing_ids: ["53252922"]  (HYGGE HAUS)
    └── get_tax_classification() → NHS_RESIDENTIAL
```

---

## Key Learnings

### 1. CAT Code is Unreliable
The Grand List `CAT` field (R1, R2, etc.) often contradicts `DESCPROP`:

| SPAN | CAT | DESCPROP | Reality |
|------|-----|----------|---------|
| 690-219-11993 | R2 (multi) | "& DWL" (singular) | 1 dwelling |
| 690-219-13192 | R2 (multi) | "& DWL" (singular) | 1 dwelling |

**Fix**: Parse DESCPROP for dwelling count, ignore CAT for unit counting.

### 2. DESCPROP Patterns
| Pattern | Meaning | Dwellings |
|---------|---------|-----------|
| `& DWL` | Single dwelling | 1 |
| `& DWL.` | Single dwelling | 1 |
| `& DWL:` | Single dwelling | 1 |
| `& 2 DWLS` | Two dwellings | 2 |
| `& MF` | Multi-family | Parse further |
| `& CONDO` | Condo unit | 1 |

### 3. ADUs Are Invisible
The Grand List doesn't capture accessory dwelling units (ADUs) like:
- Apartments above garages
- In-law suites
- Converted barns

**These require manual addition based on local knowledge.**

### 4. Mailing Address Can Be Stale
Phillips family shows CA mailing address but actually lives in Warren. The `HSDECL=Y` and `HSTED_FLV=100%` are more reliable indicators of residency than mailing address.

### 5. LLC Ownership = Almost Never Primary
If owner is an LLC (like "MAD RIVER LLC"), it's almost certainly:
- An investment property
- An STR
- A vacation home

LLCs cannot file homestead declarations in Vermont.

---

## Validation Queries

```sql
-- Check our calibration properties
SELECT
    p.address,
    COUNT(d.id) as dwelling_count,
    STRING_AGG(d.use, ', ') as dwelling_uses,
    STRING_AGG(CASE WHEN d.is_owner_occupied THEN 'owner' ELSE 'not-owner' END, ', ') as occupancy,
    STRING_AGG(
        CASE WHEN array_length(d.str_listing_ids, 1) > 0 THEN 'has-str' ELSE 'no-str' END,
        ', '
    ) as str_status
FROM parcels p
LEFT JOIN dwellings d ON d.parcel_id = p.id
WHERE p.span IN ('690-219-11993', '690-219-13192', '690-219-12656', '690-219-12576')
GROUP BY p.span, p.address
ORDER BY p.address;

-- Expected results after fixes:
-- 488 Woods Rd S: 1 dwelling, use=full_time_residence, is_owner_occupied=true, no-str
-- 448 Woods Rd S: 1 dwelling, use=second_home, no-str
-- 200 Woods Rd S: 2 dwellings (main: second_home, adu: full_time_residence with is_owner_occupied=false)
-- 94 Woods Rd N:  1 dwelling, use=short_term_rental, has-str
```

---

## Action Items

1. [x] **Fix import script** - Parse DESCPROP instead of using CAT for dwelling count ✅ DONE
2. [x] **Delete incorrect dwellings** - Remove phantom 2nd dwellings from 488 and 448 ✅ DONE
3. [ ] **Add Fabio's ADU** - Manually create dwelling for apartment above garage ⏳ PENDING
4. [x] **Fix The Vines STR match** - Find correct parcel for this listing ✅ DONE (129 Lincoln Gap Rd)
5. [x] **Update Phillips mailing address** - Or note that HSDECL is authoritative ✅ NOTED (HSDECL=Y is authoritative)
6. [ ] **Add Tremblay to property_ownerships** - Create record for Erica Tremblay ⏳ NEW

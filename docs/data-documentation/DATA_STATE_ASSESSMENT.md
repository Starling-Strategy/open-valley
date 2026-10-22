# Open Valley: Data State Assessment

**Current state after unified import and STR cleanup**

*Updated: 2026-01-01*

See [GLOSSARY.md](../GLOSSARY.md) for DwellingUse definitions and data model.

---

## Summary

The unified import is **complete**. We now have real dwellings from the Vermont Grand List API with proper condo unit handling, owner parsing, and conservative STR matching.

---

## Current Table State

### Core Tables

| Table | Records | Source | Notes |
|-------|---------|--------|-------|
| `parcels` | 1,823 | Vermont Grand List | Unique SPANs |
| `dwellings` | 3,109 | Vermont Grand List | One per API row (handles condos) |
| `people` | 2,186 | Parsed from owner names | Individual property owners |
| `organizations` | 529 | Parsed from owner names | LLCs, trusts |
| `property_ownerships` | 3,079 | Links owners to dwellings | Many-to-many with shares |

### STR Data

| Table | Records | Notes |
|-------|---------|-------|
| `bronze_str_listings` | 618 | Raw AirROI API data |
| `str_listings` | 618 | Validated, spatially matched to parcels |
| STR-linked dwellings | 15 | **Name-validated only** (conservative) |

### Community Data

| Table | Records | Notes |
|-------|---------|-------|
| `fpf_posts` | 58,174 | With OpenAI embeddings for semantic search |
| `fpf_people` | 6,438 | Names, emails, roads from FPF |

### Transfer Data

| Table | Records | Notes |
|-------|---------|-------|
| `bronze_pttr_transfers` | 1,870 | Raw PTTR API data |
| `property_transfers` | 1,217 | Validated, linked by SPAN |

---

## What's Working

### 1. Condo Units Properly Handled

Vermont's API returns one row per owner/unit. We now create one dwelling per row:

```
The Bridges (C-219-0014):
├── 100 dwellings (was 1)
├── 100 unique owners
├── 4 homestead filers (was unknown)
└── 96 non-homestead
```

### 2. Owner Names Parsed

Grand List names are parsed into People or Organizations:

| Owner Type | Count | Examples |
|------------|-------|----------|
| People | 2,186 | "PHILLIPS III ROBERT M" → Person |
| Organizations | 529 | "MAD RIVER LLC" → Organization (type=llc) |

### 3. Homestead Per-Unit

Each dwelling now has its own `homestead_filed` status from the API's HSDECL field.

### 4. STR Links Name-Validated

Only 15 STR links remain after cleanup, all validated by host name matching owner:

| Host | Owner | Address |
|------|-------|---------|
| Colin | PHILLIPS COLIN R | 129 LINCOLN GAP RD |
| Marci | SPECTOR JONATHAN & MARCI | 105 SUGARBUSH ACCESS RD |
| Stephanie | MOORE MICHAEL R & STEPHANIE A | 3215 AIRPORT RD |
| ... | ... | ... |

---

## DwellingUse & Classification

Tax classification is **derived** from `use + is_owner_occupied`. See GLOSSARY.md for derivation rules.

| DwellingUse | Meaning | Notes |
|-------------|---------|-------|
| `FULL_TIME_RESIDENCE` | Someone lives here year-round | → HOMESTEAD if owner, NHS_NONRESIDENTIAL if tenant |
| `SHORT_TERM_RENTAL` | Primarily STR, no year-round resident | → NHS_RESIDENTIAL |
| `SECOND_HOME` | Owner visits occasionally | → NHS_RESIDENTIAL |
| `VACANT` | Year-round habitable but empty | → NHS_RESIDENTIAL |

### Key Insight

STR listings are **separate data**, not a use category. A homeowner who occasionally rents (2 weeks over holidays) still has `use=FULL_TIME_RESIDENCE` with `str_listing_ids=["airbnb-12345"]`.

---

## Calibration Properties (Ground Truth)

Four properties on Woods Road validate our data:

| Property | DwellingUse | is_owner_occupied | Derived Tax Class | Status |
|----------|-------------|-------------------|-------------------|--------|
| Phillips (488 Woods S) | `FULL_TIME_RESIDENCE` | `true` | HOMESTEAD | ✅ Correct |
| Tremblay (448 Woods S) | `SECOND_HOME` | - | NHS_RESIDENTIAL | ✅ Correct |
| Schulthess (200 Woods S) | `SECOND_HOME` | - | NHS_RESIDENTIAL | ✅ Correct (ADU not in Grand List) |
| Mad River LLC (94 Woods N) | `SHORT_TERM_RENTAL` | - | NHS_RESIDENTIAL | ✅ Correct (`str_listing_ids=["53252922"]`) |

---

## Known Limitations

### 1. STR Links Are Conservative

Only 15 of 618 STR listings are linked to dwellings. Why:

- **Property managers**: Many STRs hosted by Vacasa, Evolve, etc.
- **Pseudonyms**: Hosts use first names or fake names ("John Smith")
- **No address in listing**: Can't validate spatial match without owner name match

### 2. ADUs Are Invisible

Accessory Dwelling Units (apartments above garages, etc.) are not in the Grand List. Schulthess at 200 Woods Rd S has an ADU with a long-term renter, but we only show 1 dwelling.

### 3. FPF→Owner Linkage Not Done

We have 6,438 FPF people and 2,186 property owners, but no automated matching between them yet.

---

## Data Flow

```
Vermont Grand List API (3,245 rows)
     │
     ├─[Group by SPAN]──→ Parcels (1,823)
     │
     └─[Each row]──→ Dwellings (3,109)
                       │
                       ├─ use: DwellingUse (inferred from homestead/mailing address/STR activity)
                       ├─ is_owner_occupied: bool (from homestead declaration)
                       ├─ str_listing_ids: [] (populated from STR matching)
                       │
                       ├─[Parse owner name]──→ People (2,186)
                       │                       Organizations (529)
                       │
                       └─[Create link]──→ PropertyOwnerships (3,079)

STR Matching (separate process):
     │
     └─[Name-validate against owner]──→ 15 validated links added to str_listing_ids
```

---

## Scripts

| Script | Purpose | Status |
|--------|---------|--------|
| `import_vermont_unified.py` | Main import: parcels → dwellings → owners | ✅ Complete |
| `import_airroi.py` | STR listings from AirROI | ✅ Complete |
| `import_pttr.py` | Property transfers from PTTR | ✅ Complete |
| `embed_fpf_posts.py` | FPF semantic embeddings | ✅ Complete |

---

## Next Steps

1. **Improve STR matching** - Build property manager registry, address text matching
2. **Link FPF to owners** - Match FPF people to property owners by name+road
3. **Manual ADU additions** - Add known ADUs from local knowledge
4. **Residency investigation tools** - Flag suspicious homestead filings

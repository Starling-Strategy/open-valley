# Open Valley Glossary

Terms and definitions for Warren property data.

## Data Model

### Core Question: Does someone live here full-time?

Our model is built around **occupancy** - does someone live in this dwelling year-round?

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           THREE SEPARATE CONCERNS                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. DWELLING USE (occupancy pattern)                                        │
│     → Does someone live here full-time?                                     │
│     → FULL_TIME_RESIDENCE, SHORT_TERM_RENTAL, SECOND_HOME, VACANT, etc.    │
│                                                                             │
│  2. STR LISTINGS (separate data)                                            │
│     → Is there Airbnb/VRBO activity?                                        │
│     → Can attach to ANY dwelling, regardless of use                         │
│     → A homeowner who rents 2 weeks/year still has use=FULL_TIME_RESIDENCE │
│                                                                             │
│  3. OWNER INFO (via PropertyOwnership)                                      │
│     → Who owns it? Local resident? Out-of-state? LLC?                       │
│     → Separate from how the dwelling is used                                │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  TAX CLASSIFICATION (derived, not primary)                                  │
│     → Vermont Act 73 categories: HOMESTEAD, NHS_RESIDENTIAL, NHS_NONRES    │
│     → Computed from: DwellingUse + is_owner_occupied                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### DwellingUse (occupancy pattern)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DWELLING USE                                   │
│                    "Does someone live here full-time?"                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  IN HOUSING SUPPLY (someone lives here year-round):                         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ FULL_TIME_RESIDENCE │ Someone lives here (owner OR tenant)            │  │
│  │                     │ → is_owner_occupied=True: owner lives here      │  │
│  │                     │ → is_owner_occupied=False: tenant lives here    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  NOT IN HOUSING SUPPLY (no year-round resident):                            │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ SHORT_TERM_RENTAL │ Primarily used for visitors (<30 day stays)       │  │
│  │ SECOND_HOME       │ Owner visits occasionally, sits empty otherwise   │  │
│  │ VACANT            │ Year-round habitable but empty                    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  OTHER:                                                                     │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ SEASONAL   │ Not year-round habitable (camp, cabin)                   │  │
│  │ COMMERCIAL │ Business use, 5+ units                                   │  │
│  │ UNKNOWN    │ Cannot determine                                         │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### STR Listings are Separate Data

**Key insight**: Any dwelling can have an STR listing. The listing is data, not a use category.

| DwellingUse | Has STR Listing? | What it means |
|-------------|------------------|---------------|
| FULL_TIME_RESIDENCE | Yes | Homeowner occasionally rents (holidays, ski week) |
| FULL_TIME_RESIDENCE | No | Just lives there |
| SHORT_TERM_RENTAL | Yes | Dedicated STR - this is the primary use |
| SECOND_HOME | Yes | Rented when owner not visiting |
| SECOND_HOME | No | Just sits empty |

**Example**: A family lists their home on Airbnb for 2 weeks over holidays:
- `use = FULL_TIME_RESIDENCE` (they live here)
- `is_owner_occupied = True` (owner lives here)
- `str_listing_ids = ["airbnb-12345"]` (they have a listing)
- Tax classification → HOMESTEAD (owner lives here 6+ months)

### Entity Relationships

```
              ┌───────────────────┐
              │      PERSON       │
              │  is_warren_       │
              │  resident: bool   │
              │        ↕          │
              │ PropertyOwnership │
              │        ↕          │
              │   Organization    │
              │  (LLCs, trusts)   │
              └───────────────────┘
                       │
                       ▼
              ┌───────────────────┐
              │      PARCEL       │
              │  (land unit)      │
              └───────────────────┘
                       │
           ┌───────────┴───────────┐
           ▼                       ▼
    ┌──────────────┐        ┌──────────────┐
    │   DWELLING   │        │   DWELLING   │
    │              │        │              │
    │ use=FULL_    │        │ use=SHORT_   │
    │ TIME_        │        │ TERM_RENTAL  │
    │ RESIDENCE    │        │              │
    │              │        │              │
    │ is_owner_    │        │ str_listing_ │
    │ occupied=T   │        │ ids=[...]    │
    │              │        │              │
    │ str_listing_ │        └──────────────┘
    │ ids=[...]    │ ← optional (occasional hosting)
    └──────────────┘
```

---

## Core Terms

### Parcel

**Definition**: A discrete piece of land identified by a unique SPAN (School Property Account Number).

**Source**: Vermont Grand List

**How We Count**: `COUNT(DISTINCT span)` from Grand List import. Each SPAN is a unique parcel.

**Key Fields**:
- `span`: Unique 13-character identifier (e.g., "617-208-10293")
- `descprop`: Description of property (e.g., "7.37 ACRES & DWL")
- `cat`: Grand List category code (R1, R2, etc.) - **less reliable than DESCPROP**

**Notes**:
- One parcel can contain multiple dwellings
- Classification is based on "highest and best use" - what the property COULD be used for, not what it IS used for

---

### Dwelling

**Statutory Definition** (Act 73, Appendix 3):
> A building or the part of a building, including a single-family home, a unit within a multi-family building, apartment, condominium, mobile home, or other similar property or structure containing a separate means of ingress and egress that:
>
> (i) is designed or intended to be used for occupancy by one or more persons in a household, including providing living facilities for sleeping, cooking, and sanitary needs; and
>
> (ii) is fit for year-round habitation as determined by the Commissioner.

**How We Count**:

1. Parse Grand List `DESCPROP` field for dwelling indicators:
   - "& DWL" = 1 dwelling
   - "& 2 DWLS" = 2 dwellings
   - etc.
2. Cross-reference with STR listings (a matched STR implies at least one dwelling)
3. Validate against Grand List category codes (R1, R2) as secondary signal

**Note**: One parcel can contain multiple dwellings, so dwelling count > parcel count.

**Dwelling Requirements** (ALL must be met):

| Requirement | Description |
|-------------|-------------|
| Separate entrance | Has its own means of ingress/egress |
| Sleeping facilities | Has space/facilities for sleeping |
| Cooking facilities | Has kitchen or cooking area |
| Sanitary facilities | Has bathroom facilities |
| Year-round habitable | Insulated, heated, winterized |

**What IS a dwelling**:
- Single-family home
- Condo unit
- Apartment (in buildings with 1-4 units for NHS-R tracking)
- ADU (accessory dwelling unit)
- Mobile home (year-round)
- Townhouse

**What is NOT a dwelling**:
- Seasonal camp without winterization
- Hotel/motel room
- Building with 5+ units (whole building → NHS_NONRESIDENTIAL)
- Commercial structure

---

### Highest and Best Use

**Definition** (RP-1354, p.9):
> A term of art in real estate appraisal that captures what is physically possible on a property, regardless of how the property may in fact be used at any given point in time.

**Significance**: Vermont classifies property by what it COULD be used for, not how it's actually used. This is why:
- A vacant house that could be lived in year-round → is still a dwelling
- A winterized cabin used only in summer → is still a dwelling
- A camp without insulation → is NOT a dwelling (even if someone lives there)

---

## Tax Classifications (Act 73) - Derived

Vermont Act 73 creates three tax classifications. In our model, these are **derived** from `DwellingUse` + `is_owner_occupied`:

| Our Model | → Tax Classification |
|-----------|---------------------|
| `FULL_TIME_RESIDENCE` + `is_owner_occupied=True` | **HOMESTEAD** |
| `FULL_TIME_RESIDENCE` + `is_owner_occupied=False` | **NHS_NONRESIDENTIAL** |
| `SHORT_TERM_RENTAL` | **NHS_RESIDENTIAL** |
| `SECOND_HOME` | **NHS_RESIDENTIAL** |
| `VACANT` | **NHS_RESIDENTIAL** |
| `COMMERCIAL` | **NHS_NONRESIDENTIAL** |
| `SEASONAL` | Not a dwelling |

### HOMESTEAD

**In Our Model**: `use=FULL_TIME_RESIDENCE` + `is_owner_occupied=True`

**Statutory Definition** (32 V.S.A. § 5401(7)):
> The principal dwelling and parcel of land surrounding the dwelling, owned and occupied by a resident individual as the individual's domicile.

**Requirements**:
- Owner's principal dwelling (they live here)
- Owner must reside 6+ months per year (183+ days)
- Must file annual Homestead Declaration by October 15
- Only ONE homestead per person

**Detection Signals**:
- `HS_DEC = 'Y'` in Grand List
- `HS_VALUE > 0` (housesite value)
- Owner mailing address = property address

**Cannot Claim Homestead**: LLCs, Corporations, most trusts, out-of-state residents

---

### NHS_RESIDENTIAL (Non-Homestead Residential)

**In Our Model**: `use=SHORT_TERM_RENTAL` OR `use=SECOND_HOME` OR `use=VACANT`

**Statutory Definition** (RP-1354, Appendix 3):
> A parcel, or portion of a parcel, with a dwelling that is not:
> (i) a homestead; or
> (ii) rented for periods of 30 days or more for at least six months in the current year

**Applies To**:
- `SHORT_TERM_RENTAL` - Airbnb/VRBO properties (primary use is STR)
- `SECOND_HOME` - Owner visits occasionally but doesn't live here
- `VACANT` - Year-round habitable but empty

**Building Size**: 1-4 dwelling units

**Abbreviation**: NHS-R

---

### NHS_NONRESIDENTIAL (Non-Homestead Non-Residential)

**In Our Model**: `use=FULL_TIME_RESIDENCE` + `is_owner_occupied=False` (LTR) OR `use=COMMERCIAL`

**Statutory Definition** (RP-1354, Appendix 3):
> A parcel, or portion of a parcel, that does not qualify as "homestead" or "nonhomestead residential" under this section, including a multi-family building with five or more units.

**Applies To**:
- `FULL_TIME_RESIDENCE` with tenant (long-term rental) - landlord certificate filed
- `COMMERCIAL` - business use, 5+ unit buildings
- `SEASONAL` - not a dwelling, but parcel taxed as NHS_NR

**Abbreviation**: NHS-NR

---

## DwellingUse Values

| DwellingUse | Someone Lives Here? | Adds to Housing Supply? |
|-------------|---------------------|------------------------|
| `FULL_TIME_RESIDENCE` | Yes (owner or tenant) | **Yes** |
| `SHORT_TERM_RENTAL` | No (visitors only) | No |
| `SECOND_HOME` | No (owner visits occasionally) | No |
| `VACANT` | No (empty) | No |
| `SEASONAL` | N/A (not year-round habitable) | N/A |
| `COMMERCIAL` | N/A (business use) | N/A |
| `UNKNOWN` | ? | ? |

### What Does "Full-Time" Mean?

Different policies use different thresholds:

| Policy | Threshold | What It Means |
|--------|-----------|---------------|
| **Vermont Homestead** | 6+ months/year (183+ days) | Owner must live here as domicile to claim homestead tax rate |
| **Long-term rental (Act 73)** | Rented 30+ days/stay, 6+ months/year | Tenant lives here → NHS_NONRESIDENTIAL (not NHS_R) |
| **Short-term rental** | Stays <30 days | Visitors, not residents |
| **IRS Primary Residence** | 2 of last 5 years | For capital gains exclusion (not relevant to VT property tax) |

**In our model**, `FULL_TIME_RESIDENCE` means:
> Someone (owner or tenant) lives here as their primary home, year-round.

We use the **6+ months threshold** (183 days) to align with Vermont's homestead definition. This is the key policy threshold for Act 73 tax classification.

**Signals that indicate full-time residence**:
- Homestead declaration filed → owner lives here 6+ months
- Landlord certificate filed → tenant lives here (long-term rental)
- Owner mailing address = property address → likely lives here
- Voter registration at this address
- Utility usage patterns (year-round vs seasonal spikes)

### How We Determine DwellingUse

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ INPUT: Parcel data + Dwelling data + STR listings + Owner info              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Step 1: Is this a dwelling? (year-round habitable)                         │
│    • No → SEASONAL                                                          │
│    • Yes → continue                                                         │
│                                                                             │
│  Step 2: Does someone live here full-time?                                  │
│    • Homestead declaration filed? → Yes, owner lives here                   │
│    • Landlord certificate filed? → Yes, tenant lives here                   │
│    • Owner mailing = property address? → Likely owner lives here            │
│    • None of the above → No one lives here full-time                        │
│                                                                             │
│  Step 3: If no one lives here, what's the primary use?                      │
│    • Has STR listing AND high activity? → SHORT_TERM_RENTAL                 │
│    • Owner visits (based on PTTR intent)? → SECOND_HOME                     │
│    • No activity at all? → VACANT                                           │
│                                                                             │
│  Step 4: If someone lives here, is it owner or tenant?                      │
│    • Homestead declaration → is_owner_occupied = True                       │
│    • Landlord certificate → is_owner_occupied = False                       │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ OUTPUT:                                                                     │
│   dwelling.use = DwellingUse.XXX                                            │
│   dwelling.is_owner_occupied = True/False/None                              │
│   dwelling.str_listing_ids = [...] (if any matched)                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Signals

| Signal | Source | What It Tells Us |
|--------|--------|------------------|
| `HS_DEC='Y'` | Grand List | Owner filed homestead → FULL_TIME_RESIDENCE + is_owner_occupied=True |
| Landlord certificate | Tax Dept | Tenant lives here → FULL_TIME_RESIDENCE + is_owner_occupied=False |
| Owner mailing = property | Grand List | Owner probably lives here |
| Owner state ≠ VT | Grand List | Owner lives out of state |
| STR listing match | AirROI import | Dwelling has STR activity (but may not be primary use) |
| PTTR `intended_use` | Property transfer | Buyer's stated intent at purchase |

### DwellingUse → Act 73 Tax Classification

Tax classification is **derived** from DwellingUse + is_owner_occupied:

| DwellingUse | is_owner_occupied | → Tax Classification |
|-------------|-------------------|---------------------|
| `FULL_TIME_RESIDENCE` | True | HOMESTEAD |
| `FULL_TIME_RESIDENCE` | False | NHS_NONRESIDENTIAL (LTR) |
| `SHORT_TERM_RENTAL` | - | NHS_RESIDENTIAL |
| `SECOND_HOME` | - | NHS_RESIDENTIAL |
| `VACANT` | - | NHS_RESIDENTIAL |
| `COMMERCIAL` | - | NHS_NONRESIDENTIAL |
| `SEASONAL` | - | Not a dwelling |

---

## Long-Term Rental

**Definition** (RP-1354, p.36):
> Residential property that:
> - is rented for 30 days or more at a time
> - for at least 6 months of the year (need not be consecutive)
> - as part of a bona fide landlord-tenant relationship

**Significance**: Long-term rentals are EXCLUDED from NHS_RESIDENTIAL. They are classified as NHS_NONRESIDENTIAL, which may have a different (higher) tax rate.

**Why Excluded**: The legislative intent is to target second homes and STRs, not housing providers. Landlords filing landlord certificates are tracked separately.

---

## Seasonal Property

**Definition**: Property not suitable for year-round habitation.

**Characteristics** (may include):
- No insulation/weatherization
- No permanent heating system
- No plumbing/running water
- Seasonal access only (class IV road)

**Classification**: NOT a "dwelling" under Act 73, therefore NOT subject to NHS_RESIDENTIAL tax rate. Falls under NHS_NONRESIDENTIAL.

**Challenge** (from RP-1354 VALA survey):
> 62.5% of Vermont listers said they CAN distinguish seasonal from year-round; 37.5% said they cannot. It's inherently subjective.

---

## Mixed Use

**Definition** (RP-1354, p.8):
> Properties where a single parcel has a portion used for one purpose (such as residential) and a portion used for another (such as commercial).

**Classification Rule** (Act 73):
> A parcel with two or more portions qualifying for different tax classifications shall be classified proportionally based on the percentage of floor space used.

**Examples**:
- House with home office → proportional split
- Pottery studio with upstairs STR apartment → split by square footage
- Farm with farmhouse → land may be separate from dwelling

---

## Key Data Sources

### Grand List
Vermont's official property record, updated annually by April 1.

**Key Fields**:
- `SPAN`: Unique parcel identifier
- `DESCPROP`: Property description (parse for dwelling count)
- `OWNER1`: Primary owner name
- `REAL_FLV`: Full listed value
- `HS_VALUE`: Housesite value (dwelling + 2 acres)
- `CAT`: Category code (less reliable than DESCPROP)

### Homestead Declaration
Annual filing by property owners claiming homestead status.

**Filing Deadline**: October 15

**What It Tells Us**: Owner claims this is their principal residence for 6+ months/year.

### Landlord Certificate
Annual filing by landlords with rental properties.

**Requirement**: Must file for any unit rented 30+ days in prior year.

**What It Tells Us**: Property is a rental; tenant info for renter credit.

### PTTR (Property Transfer Tax Return)
Filed at each property sale.

**Key Fields**:
- `buyer_state`: Out-of-state = likely not primary residence
- `intended_use`: Buyer's declared intent (primary, secondary, investment)
- `sale_price`: Transaction value

---

## Metrics & How We Calculate Them

### By DwellingUse (our primary model)

| Metric | Query |
|--------|-------|
| Full-time residences | `WHERE use = 'full_time_residence'` |
| → Owner-occupied | `WHERE use = 'full_time_residence' AND is_owner_occupied = true` |
| → Tenant-occupied (LTR) | `WHERE use = 'full_time_residence' AND is_owner_occupied = false` |
| Short-term rentals | `WHERE use = 'short_term_rental'` |
| Second homes | `WHERE use = 'second_home'` |
| Vacant | `WHERE use = 'vacant'` |
| In housing supply | `WHERE use = 'full_time_residence'` |
| NOT in housing supply | `WHERE use IN ('short_term_rental', 'second_home', 'vacant')` |

### By Tax Classification (derived)

| Metric | How Derived |
|--------|-------------|
| HOMESTEAD | `use = 'full_time_residence' AND is_owner_occupied = true` |
| NHS_RESIDENTIAL | `use IN ('short_term_rental', 'second_home', 'vacant')` |
| NHS_NONRESIDENTIAL | `use = 'full_time_residence' AND is_owner_occupied = false` OR `use = 'commercial'` |

### STR Activity

| Metric | Query |
|--------|-------|
| Dwellings with STR listings | `WHERE str_listing_ids IS NOT NULL AND array_length(str_listing_ids) > 0` |
| STR as primary use | `WHERE use = 'short_term_rental'` |
| Occasional STR (homeowner rents sometimes) | `WHERE use = 'full_time_residence' AND has_str_listing = true` |

### Source Data

| Metric | Source |
|--------|--------|
| Total Parcels | `COUNT(DISTINCT span)` from Grand List |
| Total Dwellings | Parse DESCPROP ("& DWL"=1, "& 2 DWLS"=2) |
| STR Listings | `scripts/import_airroi.py --all --city Warren` |
| Out-of-State Buyers | `WHERE buyer_state != 'VT'` from PTTR |

---

## Implementation Timeline (Act 73)

| Date | Milestone |
|------|-----------|
| Jan-May 2026 | Legislature defines "dwelling unit" |
| Jan 1, 2027 | First contingency: school district boundaries enacted |
| June 2026-2027 | Towns identify all dwelling units |
| Jan-May 2027 | Legislature passes attestation requirement |
| Oct 1, 2027 | Tax Dept provides classification data to JFO |
| Jan-Apr 2028 | New Dwelling Use Attestation form |
| July 1, 2028 | Second contingency + NEW RATES TAKE EFFECT |

---

## Pydantic Data Model (`src/schemas.py`)

### Enums

| Enum | Purpose | Values |
|------|---------|--------|
| `DwellingUse` | Occupancy pattern | `FULL_TIME_RESIDENCE`, `SHORT_TERM_RENTAL`, `SECOND_HOME`, `VACANT`, `SEASONAL`, `COMMERCIAL` |
| `TaxClassification` | Act 73 tax categories (derived) | `HOMESTEAD`, `NHS_RESIDENTIAL`, `NHS_NONRESIDENTIAL` |
| `OrganizationType` | Entity types | `llc`, `trust`, `corporation`, etc. |

### Key Model: `DwellingBase`

```python
class DwellingBase(BaseModel):
    # Physical characteristics
    dwelling_type: str | None      # "single_family", "adu", "condo", etc.
    bedrooms: int | None
    is_year_round_habitable: bool  # Must be True to be a "dwelling"

    # PRIMARY CLASSIFICATION - occupancy pattern
    use: DwellingUse | None        # Does someone live here full-time?

    # For FULL_TIME_RESIDENCE - owner or tenant?
    is_owner_occupied: bool | None # True=owner lives here, False=tenant

    # STR LISTINGS - separate data, can attach to any dwelling
    str_listing_ids: list[str]     # Matched Airbnb/VRBO listings

    # Derived properties
    @property
    def has_str_listing(self) -> bool
    @property
    def adds_to_housing_supply(self) -> bool
    def get_tax_classification(self) -> TaxClassification
```

### Three Concerns, Separated

| Concern | Field(s) | Question Answered |
|---------|----------|-------------------|
| Occupancy | `use` | Does someone live here full-time? |
| Who occupies | `is_owner_occupied` | Owner or tenant? |
| STR activity | `str_listing_ids` | Is there Airbnb/VRBO activity? |
| Owner info | Via PropertyOwnership → Person | Local resident? Out-of-state? LLC? |
| Tax treatment | `get_tax_classification()` | Derived from use + is_owner_occupied |

### Helper Functions

| Function | Purpose |
|----------|---------|
| `parse_owner_name(raw_name)` | Parse Grand List owner into Person(s) and/or Organization |
| `parse_descprop_dwelling_count(descprop)` | Parse "& DWL", "& 2 DWLS" → dwelling count |
| `DwellingBase.is_habitable_dwelling` | Check if meets Act 73 dwelling definition |
| `DwellingBase.get_tax_classification()` | Derive Act 73 tax category |
| `DwellingBase.has_str_listing` | True if any STR listings matched |
| `DwellingBase.adds_to_housing_supply` | True if someone lives here year-round |

---

## References

- **RP-1354**: Vermont Dept of Taxes, "Report from Act 73 of 2025: Property Tax Classifications Implementation Report" (Dec 15, 2025)
- **Act 73 of 2025**: Vermont education transformation bill
- **32 V.S.A. § 5401**: Statutory definitions (homestead, etc.)
- **32 V.S.A. § 5410**: Homestead declaration requirements

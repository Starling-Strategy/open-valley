# Warren, Vermont: Housing Intelligence Report

*A data-driven analysis of property composition using Vermont Act 73 (2025) classifications*

**Last Updated**: 2026-01-01

---

## Executive Summary

Warren is a small Vermont town of approximately 1,800 residents that serves as a case study for one of Vermont's most pressing policy debates: **how to address the impact of second homes on housing affordability and community sustainability.**

### Why Act 73 Classifications Matter

Vermont's Act 73 (2025) creates a new property tax framework with three dwelling classifications:

| Classification | Warren Count | % | Real-World Example |
|---------------|--------------|---|-------------------|
| **HOMESTEAD** | 431 | 19.8% | Phillips family at 488 Woods Rd S |
| **NHS_RESIDENTIAL** | 1,744 | 80.2% | Tremblays at 448 Woods Rd S (MA) |
| **NHS_NONRESIDENTIAL** | ~0 | ~0% | Long-term rentals (undetected) |

This framework enables tracking **who lives in Warren full-time** vs. who owns property for vacation use, investment, or rental. Starting in 2028, mandatory Dwelling Use Attestations will provide annual snapshots, allowing us to:

1. **Track trends** — Are more dwellings becoming primary residences or vacation homes?
2. **Evaluate policy** — Does Act 73 affect housing availability for workers?
3. **Identify gaps** — Which classifications are undercounted (e.g., long-term rentals)?

### The Core Finding (Parcel Analysis)

| Category | Count | % | Total Value | Avg Value |
|----------|-------|---|-------------|-----------|
| **Primary Residences** | 433 | 24% | $153M | $354k |
| **Second Homes / Vacation** | 1,170 | 64% | $196M | $167k |
| **Rental Properties** | 172 | 9% | $124M | $724k |
| **Commercial / Land** | 48 | 3% | $23M | $474k |
| **Total** | **1,823** | **100%** | **$496M** | |

**Only 1 in 4 Warren properties is someone's primary residence.** The remaining 76% are second homes, vacation properties, rentals, or commercial uses.

### Drilling Down: Parcels → Dwellings

**Dwellings are a subset of parcels.** Each parcel contains zero or more dwelling units:

```
PARCELS (1,823 total)
├── Parcels WITH dwellings (1,775) ─────────────────────┐
│   ├── Single-dwelling parcels (~1,400)                │
│   │   └── 1 dwelling each                             │
│   └── Multi-dwelling parcels (~375)                   │
│       └── 2+ dwellings each (duplexes, condos, etc.)  │
│                                                       ▼
│                                            DWELLINGS (2,175 total)
│                                            ├── HOMESTEAD: 431 (19.8%)
│                                            └── NHS_RESIDENTIAL: 1,744 (80.2%)
│
└── Parcels WITHOUT dwellings (48)
    └── Vacant land, commercial lots, etc.
```

Vermont Act 73 (2025) classifies at the **dwelling** level, not parcel level:

| Act 73 Classification | Dwellings | % | Description |
|----------------------|-----------|---|-------------|
| **HOMESTEAD** | 431 | 19.8% | Owner's primary residence |
| **NHS_RESIDENTIAL** | 1,744 | 80.2% | Second homes + STRs |
| **Total Dwellings** | **2,175** | **100%** | |

**Why the difference in percentages?** The homestead count is nearly identical (433 parcels → 431 dwellings), but multi-family parcels add ~400 non-homestead dwelling units to the denominator. So the percentage drops from 24% to 20%.

This ratio is among the most extreme in Vermont, where the statewide average for second homes is 17%.

---

## Calibration Properties: Ground Truth

We use four properties on Woods Road as calibration points for data quality. These represent different ownership patterns:

| Address | Owner | Classification | Key Pattern |
|---------|-------|----------------|-------------|
| 488 Woods Rd S | Phillips | HOMESTEAD | Year-round resident family |
| 448 Woods Rd S | Tremblay/Culmone | NHS_RESIDENTIAL | Massachusetts second-home owners |
| 200 Woods Rd S | Schulthess | NHS_RESIDENTIAL (+ ADU) | Swiss owner, long-term renter in ADU |
| 94 Woods Rd N | Mad River LLC | NHS_RESIDENTIAL | Brooklyn LLC operating STR |

**See**: [`/docs/CALIBRATION_PROPERTIES.md`](docs/CALIBRATION_PROPERTIES.md) for detailed analysis.

### Data Quality Lessons Learned

1. **Grand List CAT codes are unreliable** — The `CAT` field (R1, R2) often contradicts `DESCPROP`. Parse DESCPROP for dwelling count.

2. **ADUs are invisible** — Accessory dwelling units (apartments above garages, in-law suites) aren't in the Grand List. Require manual addition.

3. **STR spatial matching has errors** — Proximity-based matching can link STRs to wrong parcels. Requires validation.

4. **Mailing addresses can be stale** — Homestead declaration (`HSDECL`) is more reliable than mailing address for residency.

### What 2028 Attestations Will Enable

Starting in 2028, Vermont will require annual **Dwelling Use Attestations** from all owners of 1-4 unit parcels. This will:

1. **Create verified baseline** — No more guessing if a property is second home vs. long-term rental
2. **Enable trend tracking** — Year-over-year changes in homestead vs. non-homestead ratios
3. **Identify misclassifications** — How many NHS_RESIDENTIAL are actually NHS_NONRESIDENTIAL?

Our data model is designed to store these attestations when available.

---

## Data Architecture

### The Parcel → Dwelling Hierarchy

**Parcels are land; dwellings are housing units within that land.**

```
┌─────────────────────────────────────────────────────────────────┐
│  PARCELS (1,823)                                                │
│  └─ The authoritative base layer from Vermont Grand List        │
│     └─ Each parcel = one piece of land with one owner           │
│                                                                 │
│     ┌───────────────────────────────────────────────────────┐   │
│     │  DWELLINGS (2,175)                                    │   │
│     │  └─ Housing units WITHIN parcels                      │   │
│     │     └─ A parcel can have 0, 1, or many dwellings      │   │
│     │     └─ Each dwelling belongs to exactly ONE parcel    │   │
│     │                                                       │   │
│     │     ┌─────────────────────────────────────────────┐   │   │
│     │     │  STR LISTINGS (605)                         │   │   │
│     │     │  └─ Enrichment data linked to dwellings     │   │   │
│     │     │     └─ 202 dwellings have STR listings      │   │   │
│     │     └─────────────────────────────────────────────┘   │   │
│     └───────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

| Level | Count | Relationship | Source |
|-------|-------|--------------|--------|
| **Parcels** | 1,823 | Base layer | Grand List |
| **Dwellings** | 2,175 | Contained in parcels | Inferred |
| **STR Listings** | 605 | Linked to dwellings | AirROI |

### Data Layering Principle

**Ground in public data first, then enrich with private data.**

```
PARCEL (authoritative base)
   │
   ├── assessed_value, homestead_filed, property_type, lat/lng
   │
   └── DWELLING (inferred from parcel)
          │
          ├── tax_classification (HOMESTEAD | NHS_RESIDENTIAL | NHS_NONRESIDENTIAL)
          ├── use_type (owner_occupied_primary | owner_occupied_secondary | short_term_rental)
          │
          └── STR_LISTING (enrichment from AirROI)
                 │
                 └── price_per_night, bedrooms, host_name, ratings
```

Each level contains the one below it. We never "create" dwellings from STR data—STRs are linked to dwellings that were already inferred from parcels.

### Medallion Architecture

| Layer | Purpose | Records |
|-------|---------|---------|
| **Bronze** | Raw data as received | 1,870 PTTR, 605 STR |
| **Silver** | Validated, linked to parcels | 1,217 PTTR, 605 STR |
| **Gold** | Analytical aggregates | Dwellings, summaries |

---

## Part 1: What We Know About Warren

### Data Sources

This analysis draws from:
- **Vermont Geodata Portal**: 1,823 parcel records with assessed values, boundaries, and ownership
- **Vermont Grand List**: Homestead exemption filings (indicates primary residence)
- **Owner Mailing Addresses**: Parsed for residency indicators
- **Front Porch Forum**: 58,174 community posts from 6,438 members (2015-2025)
- **AirROI STR Data**: 605 Warren short-term rental listings with lat/lng, matched to parcels (96% match rate)
- **Property Transfer Tax Returns (PTTR)**: 1,217 validated property sales with buyer state, intended use
- **Dwelling Inference Model**: 2,175 dwelling units inferred from Grand List + STR data

### Property Composition

Warren's property landscape is dominated by Sugarbush Resort and its associated vacation properties:

**By Property Type (Raw Parcels):**
- Residential: 731 parcels
- Multi-family: 300 parcels
- Other (condos/resort units): 744 parcels
- Commercial: 42 parcels
- Land: 6 parcels

**By Residency Status (Parcel-Based):**
The "other" category is largely Sugarbush condos (addresses like "SPRING FLING ROAD", "HOBBIT HILL", "CLUB SUGARBUSH SOUTH ROAD"). Combined with residential properties lacking homestead filings, this creates a picture where:

- **64%** of properties are vacation/second homes
- **24%** are primary residences (homestead filed)
- **9%** are rental properties (multi-family without homestead)
- **3%** are commercial or undeveloped land

**By Dwelling Use Type (Act 73 Aligned):**

When we count dwelling units instead of parcels (as Act 73 requires), the 300 multi-family parcels expand into multiple units:

| Use Type | Dwellings | % |
|----------|-----------|---|
| Owner-occupied secondary (second home) | 1,542 | 70.9% |
| Owner-occupied primary (HOMESTEAD) | 431 | 19.8% |
| Short-term rental | 202 | 9.3% |
| **Total** | **2,175** | **100%** |

### Value Distribution Insights

| Category | Avg Value | Insight |
|----------|-----------|---------|
| Rental Properties | $724k | Highest value - multi-family buildings |
| Commercial | $474k | Businesses and mixed-use |
| Primary Residences | $354k | Year-round residents |
| Second Homes | $167k | Lower avg due to small condos |

**Counterintuitive finding**: Second homes have the *lowest* average value ($167k) because the category includes hundreds of small Sugarbush condos valued at $50k-$150k. But there are so many of them (1,170) that they still represent 40% of the total tax base.

### Mailing Address Analysis

We parse owner mailing addresses to detect out-of-state residency:

```
Owner: SMITH JOHN & JANE
Property: 123 SUGARBUSH ACCESS RD (Homestead: No)
Mailing: 456 PALM BEACH BLVD, BOCA RATON, FL 33431
         ↳ State: FL, Out-of-State: True
```

This enables identification of properties where:
- Owner lives out-of-state (definite second home)
- Owner claims homestead but mails from Florida (suspicious)

---

## Part 2: Vermont's Housing Crisis Context

### The Affordability Gap

From the [National Low Income Housing Coalition](https://nlihc.org/oor/state/vt):

| Metric | Vermont (2025) |
|--------|----------------|
| Fair Market Rent (2-BR) | $1,546/month |
| Housing Wage Needed | $29.73/hour |
| Vermont Minimum Wage | $14.01/hour |
| Hours/Week at Min Wage for 2-BR | **85 hours** |

A minimum wage worker can only afford $729/month in rent—half of what a 2-bedroom apartment costs.

### Housing Production Gap

Vermont needs **24,000-36,000 new homes by 2029** according to the [Vermont Housing Needs Assessment](https://accd.vermont.gov/housing/plans-data-rules/needs-assessment). Current production is far below this target.

### The Second Home Factor

From [Vermont Housing Finance Agency](https://vhfa.org/news/blog/data-and-statistics):
- **20%** of Vermont homes are classified as vacant
- **75%** of those vacancies are seasonal/vacation homes
- Vermont has **13.2% seasonal housing** (second-highest in the nation after Maine)

**Resort Town Impact:**
| Town | Second Home % | Notes |
|------|---------------|-------|
| Ludlow (Okemo) | 84% | Parcel-based estimate |
| **Warren** | **76%** | **Parcel-based (64% second home + 9% rental + 3% comm)** |
| Warren (dwelling view) | 80% | Act 73 dwelling-based (NHS_RESIDENTIAL) |
| Stowe | 67% | Parcel-based estimate |
| Mad River Valley overall | 45% | Parcel-based estimate |
| Vermont statewide | 17% | Census seasonal housing |

---

## Part 3: The Policy Landscape

### Vermont Act 73 of 2025

Governor Scott signed H.454 on July 1, 2025, creating Vermont's most significant property tax reform in decades.

**New Property Classifications (Effective 2027):**

| Classification | Description | Tax Rate | Examples |
|---------------|-------------|----------|----------|
| **HOMESTEAD** | Owner's domicile for 6+ months/year | Education rate (baseline) | Phillips main house |
| **NHS_RESIDENTIAL** | Second homes, STRs, vacant (1-4 units) | Higher rate | Tremblays, Phillips STR |
| **NHS_NONRESIDENTIAL** | Commercial, LTR, 5+ units, seasonal | Highest rate | Fabio (if LTR confirmed) |

**Critical Definitions from RP-1354 Report:**

A **dwelling** is a building (or part of building) with:
- Separate means of ingress and egress
- Living facilities for sleeping, cooking, and sanitary needs
- Fit for year-round habitation

A **long-term rental** is:
- Rented 30+ days at a time
- For 6+ months of the year
- Classified as NHS_NONRESIDENTIAL (NOT NHS_RESIDENTIAL)

**Key Detail**: The law creates the classification but does NOT set differential tax rates. That decision is left to future Legislatures.

**Implementation Timeline:**

| Date | Milestone |
|------|-----------|
| July 2025 | Act 73 signed |
| April 2026 | First Dwelling Use Attestation forms available |
| **April 2028** | **First mandatory attestation filing deadline** |
| 2029+ | Longitudinal trend data becomes available |

### Public Support

A [Vermont-NEA poll](https://www.vermontpublic.org/local-news/2025-04-30/tax-second-homes-define-them-property-classifications-education-reform-bill) found **79% of Vermonters support higher taxes on vacation homes** to lower residential property taxes.

### Implementation Challenges

The Vermont Department of Taxes [December 2025 report](https://legislature.vermont.gov/assets/Legislative-Reports/RP-1354.pdf) identified significant obstacles:

1. **No existing system** for categorizing second homes
2. **Definition ambiguity**: What makes a property "habitable year-round"?
   - Insulation?
   - Heating?
   - Plowed road access?
3. **Implementation burden** falls on small towns with part-time listers

### Key Advocacy Positions

**Vermont Public Assets Institute** ([source](https://publicassets.org/research-publications/the-property-tax-is-the-problem)):
- Property values are not a good indicator of ability to pay
- Second-home buyers drive up values faster than local incomes
- Recommends income-based rather than property-based education taxes

**Housing and Homelessness Alliance of Vermont**:
- 3,400+ Vermonters unhoused nightly
- 655 household shelter capacity (all full)
- Calling for $27M in housing investment

**Mad River Valley Housing Coalition** ([source](https://mrvpd.org/housing/)):
- Pursuing Affordable Land Initiative
- Promoting accessory dwelling units
- Working with Sugarbush on workforce housing

---

## Part 4: What We Can Explore

### Current Capabilities

With our existing data, we can answer:

1. **Property Composition**: What % of Warren is second homes vs. primary residences?
2. **Geographic Distribution**: Where are second homes concentrated? (Sugarbush access roads vs. village)
3. **Value Analysis**: How do second homes compare in value to primary residences?
4. **Owner Residency**: Which out-of-state zip codes own Warren property?
5. **Community Sentiment**: What do FPF posts reveal about housing concerns?

### Research Questions

**Baseline Questions (Answered):**

| Question | Status | Data Source |
|----------|--------|-------------|
| What % of Warren is primary residence vs. second home? | ✅ ANSWERED | 20% HOMESTEAD, 80% NHS_RESIDENTIAL |
| How many dwellings exist in Warren? | ✅ ANSWERED | 2,175 dwellings across 1,775 parcels |
| How many STRs operate in Warren? | ✅ ANSWERED | 202 dwellings with STR listings |
| Who is buying Warren property? | ✅ ANSWERABLE | PTTR: Buyer state, intended use available |

**Trend Tracking Questions (Require Longitudinal Data):**

| Question | Status | When Answerable |
|----------|--------|-----------------|
| Are more properties converting to second homes? | 🔲 PENDING | After 2028 attestations |
| Is the HOMESTEAD count growing or shrinking? | 🔲 PENDING | 2028+ (annual attestations) |
| What % of NHS_RESIDENTIAL are actually LTR (misclassified)? | 🔲 PENDING | 2028 attestations will reveal |
| How do tax rate changes affect classification choices? | 🔲 PENDING | 2029+ (after rates set) |
| Are STRs increasing or decreasing? | 🔲 PENDING | Compare 2025 AirROI to future pulls |

**Why 2028 Matters:** The first mandatory Dwelling Use Attestations will create a verified baseline. Comparing annual attestations will reveal:
- Net migration: +HOMESTEAD or +NHS_RESIDENTIAL?
- STR trends: Growing, stable, or declining?
- Classification corrections: How many NHS_RESIDENTIAL are actually NHS_NONRESIDENTIAL?

### Data We Have Added ✅

1. **Property Sales Data** ✅ COMPLETE
   - Source: Vermont Property Transfer Tax Returns (PTTR) via VT Geodata
   - Records: 1,870 bronze → 1,217 silver (validated)
   - Enables: Buyer state analysis, intended use, sale prices

2. **Short-Term Rental Listings** ✅ COMPLETE
   - Source: AirROI API (commercial STR market data)
   - Records: 605 Warren listings, 1,054 Mad River Valley total
   - Match rate: 96% matched to parcels via spatial centroid
   - Enables: STR impact analysis, parcel-level linkage, host analysis

3. **Dwelling Classification Model** ✅ COMPLETE
   - Source: Inference from Grand List + STR + Tax Status
   - Records: 2,175 dwellings from 1,775 parcels
   - Enables: Act 73-aligned classification, dwelling-level analysis

### Data Still Needed

1. **Historical Tax Records** (Medium Priority)
   - Source: Town Grand Lists (3-5 years)
   - Enables: Homestead filing trends, value changes over time

2. **Employment/Wage Data** (Medium Priority)
   - Source: Vermont Dept. of Labor, Census ACS
   - Enables: Housing affordability ratios by industry

3. **Additional MRV Town Parcels** (Medium Priority)
   - Source: Vermont Geodata for Waitsfield, Fayston, Moretown, Duxbury
   - STR data already available: 449 additional listings

---

## Part 5: Early Insights

### Insight 1: The Condo Effect

Warren's second home count is inflated by Sugarbush condos. The 744 "other" parcels averaging $65k are mostly fractional ownership ski condos. This means:
- Warren has many *units* that are second homes
- But the *value* concentration is more balanced
- Policy targeting "second homes" hits small condo owners differently than mansion owners

### Insight 2: The Rental Anomaly

Multi-family properties have the *highest* average value ($724k) but are only 9% of parcels. These are likely:
- Workforce housing near Sugarbush
- Village apartment buildings
- Converted farmhouses

This is where housing advocates should focus: **protecting and expanding rental stock**.

### Insight 3: The Primary Residence Premium

Primary residences average $354k vs. $167k for second homes. This suggests:
- Year-round residents own larger, more valuable properties
- OR second-home classification includes many low-value condos
- Need to segment by property type to understand better

### Insight 4: Community Discussion Trends

From FPF analysis (58k posts):
- Housing affordability is "universally acknowledged" as a crisis
- Short-term rentals blamed for reducing housing stock
- Act 250 viewed as barrier to development
- Wastewater system expansion seen as key to enabling housing density

---

## Part 6: How We Surface This Information

### Current Visualizations ✅

**1. Property Breakdown (Parcel Level)**
Shows the 1,823 parcels by residency category with value breakdown.
```
┌─────────────────────────────────────────────────────────┐
│ Warren: 64% Second Homes, Only 24% Primary Residences   │
│ 1,823 parcels | $496M total assessed value              │
├─────────────────────────────────────────────────────────┤
│ ████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ [24% Primary] [64% Second Homes] [9% Rental] [3% Comm]  │
├─────────────────────────────────────────────────────────┤
│ ○ Primary Residences    433   $153M   $354k avg         │
│ ○ Second Homes        1,170   $196M   $167k avg         │
│ ○ Rental Properties     172   $124M   $724k avg         │
│ ○ Commercial/Land        48    $23M   $474k avg         │
└─────────────────────────────────────────────────────────┘
```

**2. Dwelling Breakdown (Dwelling Level, Act 73 Aligned)**
Drills into the 2,175 dwellings contained within those parcels.
```
┌─────────────────────────────────────────────────────────┐
│ Warren: 2,175 dwellings — 20% primary, 80% second homes │
│ Based on Vermont Act 73 (2025) classifications          │
├─────────────────────────────────────────────────────────┤
│ Tax Classification Cards:                               │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐         │
│ │🟢 HOMESTEAD │ │🟠 NHS_RES   │ │🔴 NHS_NONRES│         │
│ │    431      │ │   1,744     │ │      0      │         │
│ │   19.8%     │ │   80.2%     │ │     0%      │         │
│ │Primary Res. │ │Second+STR   │ │Commercial   │         │
│ └─────────────┘ └─────────────┘ └─────────────┘         │
├─────────────────────────────────────────────────────────┤
│ 🏠 Short-Term Rentals: 202 dwellings (9.3%)             │
├─────────────────────────────────────────────────────────┤
│ Use Type Breakdown (progress bars):                     │
│ owner_occupied_secondary  1,542  ██████████████░░ 71%   │
│ owner_occupied_primary      431  ████░░░░░░░░░░░░ 20%   │
│ short_term_rental           202  ██░░░░░░░░░░░░░░  9%   │
└─────────────────────────────────────────────────────────┘
```

**3. Maps (Hierarchical Views)**
Both map types show the same geographic data at different granularity:

| Map Type | Markers | Colors | STR Overlay |
|----------|---------|--------|-------------|
| **Property Map** | 1,823 parcels | 🟢 homestead / 🟠 non-homestead | No |
| **Dwelling Map** | 2,175 dwellings | 🟢 HOMESTEAD / 🟠 NHS_RES / 🔴 NHS_NONRES | 🏠 badge on STRs |

- Click any marker for popup (address, classification, value, STR details)
- Auto zoom-to-fit when multiple results

**4. Search & Tables**
- Address search returns parcels with their contained dwellings
- Filter by: tax classification, use type, STR status
- Table columns: Address, Unit, Classification, Use Type, STR, Bedrooms

### Proposed Future Visualizations

1. **Trend Line Chart**: Homestead filing % over time (if we get historical data)
2. **Price Scatter Plot**: Sale price vs. assessed value by property type
3. **Buyer Origin Map**: Where are Warren property buyers coming from? (PTTR data)
4. **Affordability Calculator**: "Can a [job] afford to live here?"

### Narrative Framing

For different audiences:

**For Local Residents:**
> "Only 1 in 4 properties in Warren is occupied by a year-round resident. This affects everything from school enrollment to volunteer fire departments to the character of our village."

**For Policymakers:**
> "Warren demonstrates the extreme case of Vermont's second-home phenomenon. With 64% of parcels (or 80% of dwelling units under Act 73) classified as non-primary residences, the town is a laboratory for understanding how the new tax classifications will work in practice."

**For Housing Advocates:**
> "The 172 rental properties in Warren—just 9% of parcels—are the most valuable on average and represent the thin thread of workforce housing that keeps the ski economy functioning. Additionally, 605 active STR listings have been mapped to specific parcels, representing potential long-term housing diverted to tourism."

---

## Appendix: Data Dictionary

### Parcel Table (1,823 records)
| Field | Description | Coverage |
|-------|-------------|----------|
| span | Vermont parcel ID | 100% |
| address | Street address | 95% |
| assessed_total | Current assessed value | 100% |
| property_type | Categorized type (residential, multi-family, other, commercial, land) | 100% |
| lat/lng | Coordinates | 100% |
| geometry | Parcel boundaries | 100% |

### Dwelling Table (2,175 records) ← NEW
| Field | Description | Coverage |
|-------|-------------|----------|
| parcel_id | Link to parcel | 100% |
| unit_number | Unit ID for multi-family | ~15% |
| tax_classification | HOMESTEAD, NHS_RESIDENTIAL, NHS_NONRESIDENTIAL | 100% |
| use_type | owner_occupied_primary, owner_occupied_secondary, short_term_rental | 100% |
| str_listing_id | Link to STR listing if applicable | 9.3% |
| bedrooms | Number of bedrooms | ~9% (from STR) |

### STR Listing Table (605 records) ← NEW
| Field | Description | Coverage |
|-------|-------------|----------|
| platform | airbnb (source: AirROI) | 100% |
| listing_id | Platform listing ID | 100% |
| parcel_id | Matched parcel | 96% |
| lat/lng | Listing coordinates | 100% |
| bedrooms | Number of bedrooms | 95% |
| price_per_night_usd | Nightly rate (cents) | 95% |
| match_confidence | Parcel match confidence (0-1) | 96% |

### Property Transfer Table (1,217 silver records) ← NEW
| Field | Description | Coverage |
|-------|-------------|----------|
| span | Vermont parcel ID | 100% |
| sale_price | Transaction price | 100% |
| transfer_date | Date of sale | 100% |
| buyer_state | Buyer's state (normalized) | ~90% |
| is_out_of_state_buyer | True if not VT | Derived |
| intended_use | primary, secondary, investment, etc. | ~70% |

### Tax Status Table (1,823 records)
| Field | Description | Coverage |
|-------|-------------|----------|
| homestead_filed | Primary residence claim | 100% |
| tax_year | Currently only 2024 | Single year |
| housesite_value | Homestead exemption value | ~24% |

### Owner Table (~2,000 records)
| Field | Description | Coverage |
|-------|-------------|----------|
| name | Owner name(s) | 100% |
| mailing_address | Full mailing address | ~95% |
| mailing_state | Parsed state code | ~90% |
| is_out_of_state | Residency flag | Derived |

---

## Sources

### Vermont Government
- [Vermont Department of Taxes - Homestead Declaration](https://tax.vermont.gov/property-owners/homestead-declaration)
- [Act 73 Implementation Report (RP-1354)](https://legislature.vermont.gov/assets/Legislative-Reports/RP-1354.pdf)
- [Vermont Housing Needs Assessment 2025-2029](https://accd.vermont.gov/housing/plans-data-rules/needs-assessment)

### Advocacy & Research
- [Public Assets Institute - The Property Tax is the Problem](https://publicassets.org/research-publications/the-property-tax-is-the-problem)
- [Vermont Housing Finance Agency](https://vhfa.org/news/blog/data-and-statistics)
- [NLIHC Out of Reach - Vermont](https://nlihc.org/oor/state/vt)
- [Mad River Valley Planning District - Housing](https://mrvpd.org/housing/)

### News Coverage
- [Vermont Public - Tax Second Homes](https://www.vermontpublic.org/local-news/2025-04-30/tax-second-homes-define-them-property-classifications-education-reform-bill)
- [WCAX - Second Home Taxes](https://www.wcax.com/2025/12/22/vermont-considers-higher-taxes-vacation-homes-fund-schools-address-housing-shortage/)

---

*Report generated by Open Valley | Warren Community Intelligence*
*Data current as of 2024 Grand List + 2025 AirROI STR data*
*Dwelling model aligned with Vermont Act 73 (2025) classifications*

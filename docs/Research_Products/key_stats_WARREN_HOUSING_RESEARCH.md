# Warren, Vermont: Housing Research

**What we know about Warren's housing from public data**

*Generated from Vermont Grand List, PTTR, and Front Porch Forum - January 2026*

---

## The Big Picture

Warren is a small Vermont town dominated by the Sugarbush ski resort. The data tells a nuanced story:

| Metric | Value | What It Means |
|--------|-------|---------------|
| **Primary Residences** | 16.4% | Only 1 in 6 homes is someone's primary home |
| **Second Homes** | 83.6% | 5 in 6 dwellings are vacation/second homes |
| **Net De-Homesteading** | -24 (7 years) | ~3-4 homesteads lost per year |
| **Primary Res. Buyers** | 92% Vermonters | Out-of-state buyers rarely move here full-time |

---

## Key Statistics

### Dwellings

| Category | Count | Percentage |
|----------|-------|------------|
| **Total Dwellings** | 3,109 | 100% |
| Homestead (Primary Residence) | 509 | 16.4% |
| Non-Homestead Residential | 2,600 | 83.6% |

### By Residency Status

| Status | Count | Percentage |
|--------|-------|------------|
| Non-Homestead (second homes, vacant, rental) | 2,600 | 83.6% |
| Homestead (primary residence) | 509 | 16.4% |

### Property Values

| Metric | Value |
|--------|-------|
| Total Assessed Value | $496 million |
| Average Parcel Value | $276,476 |
| 2024 Median Sale Price | $325,000 |
| 2025 Median Sale Price | $390,000 |

---

## How We Know This

### Data Sources

All data comes from public sources:

| Source | What It Provides | Records |
|--------|------------------|---------|
| **Vermont Grand List** | Parcels, owners, assessed values, homestead status | 3,109 dwelling records |
| **Vermont PTTR** | Property transfers with buyer origin & intent | 1,217 validated transfers |
| **Front Porch Forum** | Community posts, local engagement | 58,174 posts, 6,438 people |

### Homestead Declaration

Vermont requires property owners to file a **Homestead Declaration** if the property is their primary residence. This is our most reliable signal:

- **Filed Homestead**: Owner claims this as their domicile (6+ months/year)
- **No Homestead**: Second home, rental, or vacant

The Grand List API returns `HSDECL = Y` for each unit with a homestead filing. We preserve this at the dwelling level, so condo units have individual homestead status.

### Owner Location

We parse owner mailing addresses from the Grand List. While mailing address doesn't always equal residence, combined with homestead status it's a strong signal:

| Region | Owners | Percentage |
|--------|--------|------------|
| Vermont | 758 | 34.7% |
| Northeast US (MA, CT, NY, etc.) | 1,209 | 55.3% |
| Other US (FL, CA, TX, etc.) | 76 | 3.5% |
| International | 139 | 6.4% |

### Top Owner States

| State | Owners |
|-------|--------|
| VT | 758 |
| MA | 659 |
| CT | 172 |
| NY | 170 |
| NJ | 101 |
| NH | 52 |
| FL | 50 |

---

## Condos vs Single-Family

Warren has significant condo inventory, primarily at Sugarbush:

| Type | Parcels | Dwellings |
|------|---------|-----------|
| Condo Complexes | 27 | 1,307 |
| Non-Condo Properties | 1,796 | 1,802 |

### Top 10 Condo Complexes

| Complex | Units | Homestead Filed |
|---------|-------|-----------------|
| 161 Mountainside Drive | 220 | 14 (6%) |
| 107102 Forest Drive | 164 | 0 (0%) |
| 116 Middle Earth Dr | 120 | 6 (5%) |
| 156 Snow Creek Road | 115 | 1 (1%) |
| 42 Lower Phase Rd (The Bridges) | 100 | 4 (4%) |
| 113 Panorama Road | 72 | 2 (3%) |
| 163 Upper Summit Road | 49 | 0 (0%) |
| 34 Paradise Way | 46 | 8 (17%) |
| 143 Club Sugarbush South Road | 46 | 5 (11%) |
| 91 Huckleberry Lane | 45 | 4 (9%) |

**Key Insight**: Sugarbush condos are overwhelmingly second homes. Forest Drive has 164 units with zero homestead filers.

---

## Ownership Patterns

### Owner Types

| Type | Count | Percentage |
|------|-------|------------|
| Individuals | 2,186 | 80.5% |
| Organizations | 529 | 19.5% |

### Organization Types

| Type | Count |
|------|-------|
| Trusts | 308 |
| LLCs | 174 |
| Other | 28 |
| Corporations | 19 |

**Why It Matters**: LLCs and trusts cannot file homestead declarations. A property owned by "MAD RIVER LLC" is definitionally not a primary residence.

---

## Property Transfers

### Transfer Volume

| Year | Sales | Total Value | Avg Price | Median Price |
|------|-------|-------------|-----------|--------------|
| 2025 | 107 | $53.6M | $500,634 | $390,000 |
| 2024 | 135 | $60.7M | $449,783 | $325,000 |

### Buyer Intent (from PTTR)

| Intended Use | Count | Percentage |
|--------------|-------|------------|
| Secondary Residence | 634 | 52.1% |
| Other | 559 | 45.9% |
| Commercial | 24 | 2.0% |

### Buyer Origin (from PTTR)

| State | Buyers | Percentage |
|-------|--------|------------|
| MA | 440 | 36.4% |
| VT | 427 | 35.3% |
| CT | 81 | 6.7% |
| NY | 51 | 4.2% |
| NJ | 45 | 3.7% |

**Key Insight**: Massachusetts buyers outnumber Vermont buyers in property transfers.

---

## Warren's Transformation Over Time

The PTTR data tracks actual changes in housing use—not just who owns property, but whether it's someone's home.

### Measuring De-Homesteading

We define:
- **Loss**: VT seller → buyer declares "Secondary Residence" or "Non-Primary" use
- **Gain**: Any seller → buyer declares "Primary Residence" or "Domicile"

### Net Homesteading by Year

| Year | Losses | Gains | Net | Status |
|------|--------|-------|-----|--------|
| 2019 | 30 | 34 | **+4** | Re-homesteading |
| 2020 | 41 | 32 | **-9** | De-homesteading |
| 2021 | 36 | 32 | **-4** | De-homesteading |
| 2022 | 20 | 12 | **-8** | De-homesteading |
| 2023 | 21 | 9 | **-12** | De-homesteading |
| 2024 | 27 | 23 | **-4** | De-homesteading |
| 2025 | 15 | 24 | **+9** | Re-homesteading |
| **Total** | **190** | **166** | **-24** | |

**Key Finding**: Net loss of **24 homestead properties** over 7 years. The COVID years (2020-2023) were the worst, with **-33 net**.

### The COVID Effect (2020)

2020 was the peak year for de-homesteading:

| Year | Sales | Total Value | Avg Price | Homestead Losses |
|------|-------|-------------|-----------|------------------|
| 2019 | 200 | $45.2M | $226,187 | 30 |
| 2020 | 239 | $98.7M | $412,903 | **41** |
| 2021 | 208 | $63.5M | $305,118 | 36 |
| 2022 | 161 | $63.7M | $395,608 | 20 |

The pandemic triggered remote work, making second homes more attractive. But those buyers weren't moving to Vermont—they were adding Warren as a second location.

### Who Buys Primary Residences?

When someone does buy a Warren property as their primary home:

| Buyer Origin | Purchases | Percentage |
|-------------|-----------|------------|
| Vermont residents | 156 | 92% |
| Out-of-state buyers | 13 | 8% |

**Key Finding**: Almost all primary residence buyers are already Vermonters. Out-of-state buyers rarely move here full-time.

### What This Means

Warren is de-homesteading, but slowly:

- **-24 net homesteads** over 7 years (~3-4 per year)
- The 16.4% homestead rate is the result of decades of this pattern
- COVID accelerated the trend, but 2025 shows early signs of reversal
- The question isn't whether change is happening—it's whether it's acceptable

---

## Community Engagement (Front Porch Forum)

| Metric | Count |
|--------|-------|
| Total Posts | 58,174 |
| Community Members | 6,438 |

### FPF Members by Town

| Town | Members |
|------|---------|
| Warren | 2,459 |
| Waitsfield | 2,401 |
| Fayston | 944 |
| Moretown | 202 |
| Duxbury | 46 |

**Future Work**: Link FPF members to property owners to understand which owners are engaged in the community.

---

## Act 73 Context

Vermont's Act 73 (2024) creates differentiated property tax rates based on housing use:

| Classification | Description | Tax Treatment |
|----------------|-------------|---------------|
| **Homestead** | Owner's primary residence | Lower rate |
| **NHS Residential** | Second homes, STRs | Higher rate |
| **NHS Non-Residential** | Long-term rentals (5+ units) | Higher rate |

Our dwelling classifications are based on:
1. **Homestead Declaration** from Grand List (HSDECL field)
2. **Owner Mailing Address** (Vermont vs out-of-state)
3. **Owner Type** (LLCs/trusts cannot file homestead)

---

## Data Confidence

| Claim | Confidence | Source |
|-------|------------|--------|
| 16.4% homestead rate | **High** | Direct from VT Grand List HSDECL field |
| 65% out-of-state owners | **High** | Parsed from owner mailing addresses |
| Condo unit counts | **High** | VT Grand List returns one row per unit |
| Transfer buyer origins | **High** | PTTR buyer state field |

### Known Limitations

1. **ADUs invisible**: Accessory dwelling units not in Grand List
2. **Mailing address lag**: Some owner addresses may be stale
3. **No rental data**: Long-term rentals not tracked in public data
4. **PTTR linkage**: Only 43% of transfers link to current parcels (historical SPANs)

---

## Summary

Warren's housing data reveals a community where:

- **5 out of 6 homes are not primary residences**
- **Massachusetts is the top source of both owners and buyers**
- **Sugarbush condos are almost entirely vacation homes**
- **LLCs and trusts own nearly 1 in 5 properties**
- **24 net homesteads lost (2019-2025)** — about 3-4 per year
- **92% of primary residence buyers are already Vermonters**

This pattern is common in Vermont ski towns but creates challenges for year-round residents, workforce housing, and community cohesion.

**The trend is slow but consistent**: 5 of the last 7 years showed net de-homesteading. COVID (2020-2023) was the worst period with -33 net. The 16.4% homestead rate is the result of decades of this pattern—the data just lets us measure it now.

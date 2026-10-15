# Open Valley: Data Architecture

> **Historical housing/FPF architecture and design.** This is not the current
> production model; use [deployment](../DEPLOYMENT.md). Schema examples mix
> conceptual/Pydantic fields with historical ORM proposals. Verify actual names
> in `src/schemas.py` and `src/models.py` before using them. Audit-trigger and
> change-tracking proposals below are not proof that all changes are logged;
> the document's future-work section still treats those triggers as unimplemented.



## Overview

Open Valley is a community intelligence platform for Warren, VT that connects:
- **Property data** (parcels, dwellings, ownership, transactions)
- **People** (residents, property owners, board members)
- **Organizations** (LLCs, government bodies, nonprofits)

---

## Atomic Units

| Entity | Definition | Granularity |
|--------|------------|-------------|
| **Parcel** | A piece of land with a single owner (or ownership group) | Vermont SPAN ID |
| **Dwelling** | A habitable housing unit with sleeping, cooking, sanitary facilities | Physical unit within parcel |
| **Person** | A human individual | SSN-equivalent (deduped by name+context) |
| **Organization** | A legal entity (LLC, trust, govt body) | EIN-equivalent |
| **Transaction** | A transfer of property ownership | PTTR record |

---

## Medallion Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  BRONZE LAYER: Raw Data                                                     │
│  ─────────────────────────────────────────────────────────────────────────  │
│  Data as received from source, minimal transformation                       │
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │ bronze_pttr      │  │ bronze_str       │  │ bronze_fpf       │          │
│  │ (Transfer API)   │  │ (AirROI API)     │  │ (Email exports)  │          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
│                                                                             │
│  Note: Raw owner names preserved in property_ownerships.as_listed_name     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  SILVER LAYER: Validated & Linked                                           │
│  ─────────────────────────────────────────────────────────────────────────  │
│  Cleaned, validated, linked to other entities                               │
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │ parcels          │  │ dwellings        │  │ str_listings     │          │
│  │ (Validated)      │  │ (Inferred)       │  │ (Matched)        │          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │ people           │  │ organizations    │  │ transactions     │          │
│  │ (Parsed)         │  │ (Extracted)      │  │ (Linked)         │          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐                                │
│  │ property_        │  │ fpf_posts        │                                │
│  │ ownerships       │  │ (Embedded)       │                                │
│  └──────────────────┘  └──────────────────┘                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  GOLD LAYER: Analytical Aggregates                                          │
│  ─────────────────────────────────────────────────────────────────────────  │
│  Pre-computed metrics, snapshots, trends                                    │
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │ dwelling_stats   │  │ owner_portfolios │  │ trend_snapshots  │          │
│  │ (Act 73 counts)  │  │ (Multi-property) │  │ (Point-in-time)  │          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐                                │
│  │ community_       │  │ str_market_      │                                │
│  │ engagement       │  │ analysis         │                                │
│  └──────────────────┘  └──────────────────┘                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Layer Responsibilities

| Layer | Purpose | Update Frequency | Examples |
|-------|---------|------------------|----------|
| **Bronze** | Preserve raw data exactly as received | On each import | `bronze_pttr_transfers` |
| **Silver** | Clean, validate, link, enrich | After bronze updates | `dwellings`, `people` |
| **Gold** | Aggregate for analysis/reporting | On demand or scheduled | `dwelling_stats` |

### Implementation Status (2026-01-12)

| Layer | Documented | Implemented | Notes |
|-------|------------|-------------|-------|
| **Bronze** | 3 tables | 2 tables | `bronze_pttr_transfers`, `bronze_str_listings` exist. `bronze_fpf` planned. |
| **Silver** | 8 tables | 10+ tables | All core tables exist plus extras: `fpf_people`, `fpf_issues`, `tax_status`, `dwelling_attestations` |
| **Gold** | 5 views | 0 views | Not implemented - no materialized views or aggregates yet |

Note: Raw owner names are preserved in `property_ownerships.as_listed_name` rather than a separate bronze table.

### Data Lineage

Every silver/gold record tracks its source:
```python
class Dwelling(Base):
    # ... fields ...

    # Lineage
    bronze_source: Mapped[str] = mapped_column(
        String(50),
        doc="Source table: 'bronze_parcels', 'bronze_str', 'manual'"
    )
    bronze_id: Mapped[UUID | None] = mapped_column(
        doc="ID in bronze table if applicable"
    )
    derived_from: Mapped[list[str]] = mapped_column(
        ARRAY(String),
        default=list,
        doc="List of source records used: ['parcel:abc123', 'str:def456']"
    )
```

---

## Entity Relationship Diagram

```
                                    ┌─────────────────────────┐
                                    │        PERSON           │
                                    │  ───────────────────    │
                                    │  The central entity     │
                                    │  connecting all data    │
                                    └───────────┬─────────────┘
                                                │
              ┌─────────────────┬───────────────┼───────────────┬─────────────────┐
              │                 │               │               │                 │
              ▼                 ▼               ▼               ▼                 ▼
    ┌─────────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │ PROPERTY        │ │ ORGANIZATION│ │ FPF_POST    │ │ DWELLING    │ │ FPF_PERSON  │
    │ OWNERSHIP       │ │ MEMBERSHIP  │ │             │ │ (resides_at)│ │ (fpf link)  │
    └────────┬────────┘ └──────┬──────┘ └─────────────┘ └─────────────┘ └─────────────┘
             │                 │
             ▼                 ▼
    ┌─────────────────┐ ┌─────────────────┐
    │     PARCEL      │ │  ORGANIZATION   │
    │                 │ │                 │
    └────────┬────────┘ └────────┬────────┘
             │                   │
             ▼                   │ (also owns)
    ┌─────────────────┐          │
    │    DWELLING     │◄─────────┘
    └────────┬────────┘
             │
             ▼
    ┌─────────────────┐
    │  STR_LISTING    │
    └─────────────────┘
```

---

## Core Entities

### 1. Person

The central entity representing a human individual.

```python
class Person(Base):
    """
    A human individual in the Warren community.

    Can be:
    - A property owner (directly or through organization)
    - A Front Porch Forum participant
    - A member of government/community organizations
    - A resident of a dwelling

    Examples:
    - Macon Phillips: property owner, FPF member, Planning Commission member
    - Fabio Schulthess: property owner (Swiss resident, not FPF member)
    """
    __tablename__ = "people"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)

    # Identity
    first_name: Mapped[str] = mapped_column(
        String(100),
        doc="First name as commonly used"
    )
    last_name: Mapped[str] = mapped_column(
        String(100),
        doc="Last name / family name"
    )
    full_name: Mapped[str] = mapped_column(
        String(200),
        doc="Full name as appears in official records (e.g., 'PHILLIPS III ROBERT M')"
    )
    suffix: Mapped[str | None] = mapped_column(
        String(20),
        doc="Name suffix: Jr, Sr, III, etc."
    )

    # Contact
    email: Mapped[str | None] = mapped_column(
        String(255),
        unique=True,
        doc="Primary email address"
    )
    phone: Mapped[str | None] = mapped_column(
        String(20),
        doc="Phone number"
    )

    # Residency
    primary_address: Mapped[str | None] = mapped_column(
        Text,
        doc="Where this person actually lives (may differ from property owned)"
    )
    primary_town: Mapped[str | None] = mapped_column(
        String(50),
        doc="Town of primary residence"
    )
    primary_state: Mapped[str | None] = mapped_column(
        String(2),
        doc="State of primary residence (2-letter code)"
    )
    is_warren_resident: Mapped[bool] = mapped_column(
        default=False,
        doc="True if this person's primary residence is in Warren"
    )

    # FPF Linkage
    fpf_person_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("fpf_people.id"),
        doc="Link to Front Porch Forum profile if matched"
    )

    # Metadata
    data_sources: Mapped[list[str]] = mapped_column(
        ARRAY(String),
        default=list,
        doc="Where we learned about this person: ['grand_list', 'fpf', 'manual']"
    )
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    property_ownerships: Mapped[list["PropertyOwnership"]] = relationship(back_populates="person")
    organization_memberships: Mapped[list["OrganizationMembership"]] = relationship(back_populates="person")
    fpf_person: Mapped["FPFPerson | None"] = relationship()
```

**Validation Rules:**
- `email` must be valid email format if provided
- `primary_state` must be 2-letter US state code or country code
- `is_warren_resident` should be True if `primary_town == 'Warren'` and `primary_state == 'VT'`

---

### 2. Organization

An entity that can own property or have members.

```python
class OrganizationType(str, Enum):
    """Types of organizations."""
    LLC = "llc"                    # Limited Liability Company (e.g., "MAD RIVER LLC")
    TRUST = "trust"                # Trust (e.g., "WESTON STACEY B REVOCABLE TRUST")
    CORPORATION = "corporation"    # Inc, Corp, etc.
    GOVERNMENT = "government"      # Town bodies (Planning Commission, Selectboard)
    NONPROFIT = "nonprofit"        # 501(c)(3) organizations
    ASSOCIATION = "association"    # HOAs, neighborhood groups
    OTHER = "other"


class Organization(Base):
    """
    An entity that can own property or have members.

    Examples:
    - MAD RIVER LLC (property owner, Brooklyn NY)
    - Warren Planning Commission (government body)
    - Mad River Valley Housing Coalition (nonprofit)
    - RADDOCK DANIEL H & ELIZABETH F REVOCABLE TRUST (trust)
    """
    __tablename__ = "organizations"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)

    # Identity
    name: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        doc="Official name as appears in records"
    )
    display_name: Mapped[str | None] = mapped_column(
        String(255),
        doc="Friendly display name (e.g., 'Mad River LLC' instead of 'MAD RIVER LLC')"
    )
    org_type: Mapped[OrganizationType] = mapped_column(
        SQLEnum(OrganizationType),
        doc="Type of organization"
    )

    # Registration (for property-owning entities)
    registered_state: Mapped[str | None] = mapped_column(
        String(2),
        doc="State where registered (from mailing address)"
    )
    registered_address: Mapped[str | None] = mapped_column(
        Text,
        doc="Official address of the organization"
    )

    # For trusts: link to the grantor/beneficiary
    primary_person_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("people.id"),
        doc="For trusts: the person who created/benefits from the trust"
    )

    # Metadata
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    property_ownerships: Mapped[list["PropertyOwnership"]] = relationship(back_populates="organization")
    members: Mapped[list["OrganizationMembership"]] = relationship(back_populates="organization")
    primary_person: Mapped["Person | None"] = relationship()
```

**Parsing Rules for Grand List Owner Names:**
```python
def parse_owner_name(raw_name: str) -> tuple[list[Person], Organization | None]:
    """
    Parse Grand List owner name into Person(s) and/or Organization.

    Examples:
    - "PHILLIPS III ROBERT M & EMILY" → [Person, Person], None
    - "MAD RIVER LLC" → [], Organization(type=llc)
    - "WESTON STACEY B REVOCABLE TRUST" → [Person], Organization(type=trust)
    - "RADDOCK DANIEL H & ELIZABETH F REVOCABLE TRUST" → [Person, Person], Organization(type=trust)
    """
    # Detection patterns
    LLC_PATTERN = r'\bLLC\b|\bL\.L\.C\b'
    TRUST_PATTERN = r'\bTRUST\b|\bTRUSTEE\b'
    CORP_PATTERN = r'\bINC\b|\bCORP\b|\bCORPORATION\b'

    # ... parsing logic
```

---

### 3. PropertyOwnership

Links People and Organizations to Parcels they own.

```python
class PropertyOwnership(Base):
    """
    Records who owns what property.

    Handles:
    - Individual ownership: person_id set, organization_id null
    - Organizational ownership: organization_id set, person_id null
    - Joint ownership: multiple records with ownership_share < 1.0

    Examples:
    - Macon Phillips owns 50% of 488 Woods Rd S
    - Emily Phillips owns 50% of 488 Woods Rd S
    - Mad River LLC owns 100% of 94 Woods Rd N
    """
    __tablename__ = "property_ownerships"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    parcel_id: Mapped[UUID] = mapped_column(ForeignKey("parcels.id"))

    # Owner: exactly one of these must be set
    person_id: Mapped[UUID | None] = mapped_column(ForeignKey("people.id"))
    organization_id: Mapped[UUID | None] = mapped_column(ForeignKey("organizations.id"))

    # Ownership details
    ownership_share: Mapped[Decimal] = mapped_column(
        Numeric(5, 4),
        default=Decimal("1.0"),
        doc="Ownership percentage as decimal (0.5 = 50%)"
    )
    ownership_type: Mapped[str] = mapped_column(
        String(50),
        default="fee_simple",
        doc="Type: fee_simple, life_estate, trust_beneficiary, etc."
    )
    is_primary_owner: Mapped[bool] = mapped_column(
        default=True,
        doc="True if this is the primary/first-listed owner"
    )

    # From Grand List (preserve original text)
    as_listed_name: Mapped[str] = mapped_column(
        Text,
        doc="Owner name exactly as it appears in Grand List"
    )

    # Dates
    acquired_date: Mapped[date | None] = mapped_column(
        doc="When ownership began (from PTTR if available)"
    )
    disposed_date: Mapped[date | None] = mapped_column(
        doc="When ownership ended (null if current owner)"
    )

    # Source
    data_source: Mapped[str] = mapped_column(
        String(50),
        doc="Where this ownership record came from"
    )

    # Relationships
    parcel: Mapped["Parcel"] = relationship(back_populates="property_ownerships")
    person: Mapped["Person | None"] = relationship(back_populates="property_ownerships")
    organization: Mapped["Organization | None"] = relationship(back_populates="property_ownerships")

    @validates('person_id', 'organization_id')
    def validate_owner(self, key, value):
        """Ensure exactly one of person_id or organization_id is set."""
        # Validation logic
        pass
```

---

### 4. OrganizationMembership

Links People to Organizations with roles.

```python
class OrganizationMembership(Base):
    """
    Records membership/roles in organizations.

    Examples:
    - Macon Phillips is a Commissioner on Planning Commission
    - John Smith is the Managing Member of Mad River LLC
    - Jane Doe is Trustee of Smith Family Trust
    """
    __tablename__ = "organization_memberships"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    person_id: Mapped[UUID] = mapped_column(ForeignKey("people.id"))
    organization_id: Mapped[UUID] = mapped_column(ForeignKey("organizations.id"))

    # Role
    role: Mapped[str] = mapped_column(
        String(100),
        doc="Role in organization: member, owner, trustee, commissioner, chair, etc."
    )
    title: Mapped[str | None] = mapped_column(
        String(100),
        doc="Official title if any"
    )
    is_primary_contact: Mapped[bool] = mapped_column(
        default=False,
        doc="True if this person is the primary contact for the organization"
    )

    # Term
    start_date: Mapped[date | None] = mapped_column()
    end_date: Mapped[date | None] = mapped_column()
    is_active: Mapped[bool] = mapped_column(default=True)

    # Relationships
    person: Mapped["Person"] = relationship(back_populates="organization_memberships")
    organization: Mapped["Organization"] = relationship(back_populates="members")
```

---

## Property Hierarchy

### Parcel → Dwelling (with STR Data)

```
PARCEL (1,823 in Warren)
├── span: "690-219-11993" (Vermont parcel ID)
├── address: "488 WOODS RD SOUTH"
├── assessed_total: $505,800
├── ownerships: [PropertyOwnership, ...]
│
└── DWELLING(S) (3,109 total in Warren)
    ├── unit_number: null (single-family) or "101", "102" (condo)
    │
    │   PRIMARY CLASSIFICATION (occupancy pattern):
    ├── use: FULL_TIME_RESIDENCE | SHORT_TERM_RENTAL | SECOND_HOME | VACANT
    ├── is_owner_occupied: bool (for FULL_TIME_RESIDENCE: owner or tenant?)
    │
    │   STR DATA (separate - can attach to ANY dwelling):
    ├── str_listing_ids: [] (list of matched STR listings)
    │
    │   DERIVED (computed from use + is_owner_occupied):
    └── tax_classification → HOMESTEAD | NHS_RESIDENTIAL | NHS_NONRESIDENTIAL
```

**Key insight**: STR listings are separate data, not a use category. A homeowner who occasionally rents still has `use=FULL_TIME_RESIDENCE`.

See [GLOSSARY.md](../GLOSSARY.md) for the complete data model.

### Where Dwellings Come From

Dwellings are created directly from the **Vermont Grand List API**, which returns one row per owner/unit:

```
Vermont Grand List API Response (3,245 rows for Warren):
┌─────────────────────────────────────────────────────────────────────┐
│ Each API row represents one ownership record:                       │
│                                                                     │
│ Row 1: SPAN=690-219-11993, OWNER="PHILLIPS III ROBERT", HS=Y, $505k │
│ Row 2: SPAN=690-219-13192, OWNER="CULMONE FRANK D", HS=N, $385k     │
│ Row 3: SPAN=C-219-0014, OWNER="VAYDEN NICK", HS=Y, $107k            │
│ Row 4: SPAN=C-219-0014, OWNER="BARON ROBERT", HS=N, $211k           │
│ Row 5: SPAN=C-219-0014, OWNER="HAYES ERIC", HS=N, $122k             │
│ ... (rows 3-5 share the same SPAN = condo units)                    │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ import_vermont_unified.py processes:                                │
│                                                                     │
│ 1. Group by SPAN → 1,823 unique parcels                             │
│ 2. Each row → 1 dwelling with:                                      │
│    - occupant_name from OWNER1                                      │
│    - assessed_value from REAL_FLV                                   │
│    - homestead_filed from HSDECL                                    │
│    - tax_classification computed from homestead + mailing state     │
│ 3. Parse owner name → Person or Organization                        │
│ 4. Create PropertyOwnership linking dwelling to owner               │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Result:                                                             │
│                                                                     │
│ Single-dwelling parcels: 1,790 parcels → 1,790 dwellings            │
│ Multi-dwelling parcels:     33 parcels → 1,319 dwellings (condos)   │
│ ─────────────────────────────────────────────────────────────────   │
│ Total:                   1,823 parcels → 3,109 dwellings            │
└─────────────────────────────────────────────────────────────────────┘
```

**Key Insight**: Condos share a SPAN but have individual owners and homestead status. The Bridges (C-219-0014) has 100 units with 100 different owners, 4 of whom filed homestead.

### Dwelling with DwellingUse Model

```python
class DwellingUse(str, Enum):
    """How a dwelling is used - based on occupancy pattern."""
    FULL_TIME_RESIDENCE = "full_time_residence"  # Someone lives here year-round
    SHORT_TERM_RENTAL = "short_term_rental"      # Primarily used for STR (<30 day stays)
    SECOND_HOME = "second_home"                  # Owner visits occasionally
    VACANT = "vacant"                            # Year-round habitable but empty
    SEASONAL = "seasonal"                        # Not year-round habitable
    COMMERCIAL = "commercial"                    # Business use, 5+ units
    UNKNOWN = "unknown"


class Dwelling(Base):
    """
    A habitable unit within a parcel.

    Key principle: Dwellings are CONTAINED in parcels.
    A parcel can have 0, 1, or many dwellings.

    The model separates three concerns:
    1. DwellingUse (occupancy pattern) - does someone live here full-time?
    2. STR listings (separate data) - can attach to ANY dwelling
    3. Owner info (via PropertyOwnership) - who owns it?
    """
    __tablename__ = "dwellings"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    parcel_id: Mapped[UUID] = mapped_column(ForeignKey("parcels.id"))

    # Identity
    unit_number: Mapped[str | None] = mapped_column(
        String(20),
        doc="Unit identifier for multi-dwelling parcels (null for single-family)"
    )
    unit_address: Mapped[str | None] = mapped_column(
        Text,
        doc="Full address including unit number"
    )
    dwelling_type: Mapped[str | None] = mapped_column(
        String(30),
        doc="single_family, adu, condo, apartment, etc."
    )

    # Physical
    bedrooms: Mapped[int | None] = mapped_column()
    bathrooms: Mapped[Decimal | None] = mapped_column(Numeric(3, 1))
    square_feet: Mapped[int | None] = mapped_column()
    year_built: Mapped[int | None] = mapped_column()

    # PRIMARY CLASSIFICATION: Occupancy pattern
    use: Mapped[DwellingUse | None] = mapped_column(
        SQLEnum(DwellingUse),
        doc="Does someone live here full-time? See DwellingUse enum."
    )

    # For FULL_TIME_RESIDENCE: owner or tenant?
    is_owner_occupied: Mapped[bool | None] = mapped_column(
        doc="True if owner lives here, False if tenant lives here."
    )

    # STR LISTINGS: Separate data (can attach to ANY dwelling)
    str_listing_ids: Mapped[list[str]] = mapped_column(
        ARRAY(String),
        default=list,
        doc="IDs of matched STR listings. ANY dwelling can have listings, even FULL_TIME_RESIDENCE."
    )

    # WHO LIVES HERE (key for residency tracking)
    resident_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("people.id"),
        doc="Person who resides in this dwelling (if known)"
    )
    resident_since: Mapped[date | None] = mapped_column(
        doc="When the current resident moved in"
    )

    # Data provenance
    data_source: Mapped[str] = mapped_column(
        String(50),
        doc="grand_list, str_match, manual, attestation"
    )
    source_confidence: Mapped[Decimal | None] = mapped_column(Numeric(3, 2))

    # Relationships
    parcel: Mapped["Parcel"] = relationship(back_populates="dwellings")
    resident: Mapped["Person | None"] = relationship()

    # DERIVED: Tax classification (computed, not stored)
    def get_tax_classification(self) -> str:
        """Derive Act 73 tax classification from use + is_owner_occupied."""
        if self.use == DwellingUse.FULL_TIME_RESIDENCE:
            if self.is_owner_occupied:
                return "HOMESTEAD"
            else:
                return "NHS_NONRESIDENTIAL"  # Long-term rental
        elif self.use in (DwellingUse.SHORT_TERM_RENTAL, DwellingUse.SECOND_HOME, DwellingUse.VACANT):
            return "NHS_RESIDENTIAL"
        elif self.use == DwellingUse.COMMERCIAL:
            return "NHS_NONRESIDENTIAL"
        return "UNKNOWN"

    @property
    def has_str_listing(self) -> bool:
        """True if any STR listings are linked to this dwelling."""
        return len(self.str_listing_ids) > 0

    @property
    def adds_to_housing_supply(self) -> bool:
        """True if someone lives here year-round (in housing supply)."""
        return self.use == DwellingUse.FULL_TIME_RESIDENCE
```

---

## Front Porch Forum Integration

### Linking FPF People to Property Owners

```
FPF_PERSON (6,438 community members)
├── name: "Macon Phillips"
├── email: "macon.phillips@gmail.com"
├── road: "Woods Rd"
├── town: "Warren"
│
└── PERSON (matched via email or name+address)
    ├── first_name: "Macon"
    ├── last_name: "Phillips"
    ├── fpf_person_id: → FPF_PERSON
    └── property_ownerships: [488 Woods Rd S]
```

### Matching Strategy

```python
def match_fpf_to_property_owner(fpf_person: FPFPerson) -> Person | None:
    """
    Try to match an FPF person to a property owner.

    Strategies (in order of confidence):
    1. Email match (if we had owner emails - rare)
    2. Exact name + road match (e.g., "Macon Phillips" + "Woods Rd")
    3. Fuzzy name match + town match
    """
    # High confidence: Name contains road name from property
    # e.g., FPF road = "Woods Rd", owner address = "488 WOODS RD SOUTH"

    # Medium confidence: Last name match + same town

    # Low confidence: Fuzzy name match only
```

---

## Example: Macon Phillips (Full Graph)

```
PERSON: Macon Phillips
├── id: "abc123"
├── first_name: "Macon"
├── last_name: "Phillips"
├── full_name: "PHILLIPS III ROBERT M"  (as in Grand List, with suffix parsing)
├── email: "macon.phillips@gmail.com"
├── primary_address: "488 Woods Rd South, Warren VT"
├── is_warren_resident: true
├── fpf_person_id: → FPF_PERSON (matched by email)
│
├── property_ownerships:
│   └── PROPERTY_OWNERSHIP
│       ├── parcel_id: → PARCEL (488 Woods Rd S)
│       ├── ownership_share: 0.5 (joint with Emily)
│       ├── as_listed_name: "PHILLIPS III ROBERT M & EMILY"
│       └── data_source: "grand_list_2024"
│
├── organization_memberships:
│   └── ORGANIZATION_MEMBERSHIP
│       ├── organization_id: → ORGANIZATION (Warren Planning Commission)
│       ├── role: "commissioner"
│       └── is_active: true
│
└── resides_at: → DWELLING (488 Woods Rd S, main house)
    ├── use: FULL_TIME_RESIDENCE
    ├── is_owner_occupied: true
    ├── str_listing_ids: []  (no STR activity)
    └── get_tax_classification() → "HOMESTEAD"

---

PERSON: Emily Phillips
├── id: "def456"
├── first_name: "Emily"
├── last_name: "Phillips"
├── is_warren_resident: true
│
├── property_ownerships:
│   └── PROPERTY_OWNERSHIP
│       ├── parcel_id: → PARCEL (488 Woods Rd S)
│       ├── ownership_share: 0.5
│       └── is_primary_owner: false
│
└── resides_at: → DWELLING (488 Woods Rd S, main house)
```

---

## Example: Mad River LLC / 94 Woods Rd N

```
ORGANIZATION: Mad River LLC
├── id: "org789"
├── name: "MAD RIVER LLC"
├── display_name: "Mad River LLC"
├── org_type: "llc"
├── registered_state: "NY"
├── registered_address: "255 Clinton Street, Brooklyn NY 11201"
│
├── property_ownerships:
│   └── PROPERTY_OWNERSHIP
│       ├── parcel_id: → PARCEL (94 Woods Rd N)
│       ├── ownership_share: 1.0
│       └── as_listed_name: "MAD RIVER LLC"
│
└── members: [Unknown - would need LLC filing research]

---

PARCEL: 94 Woods Rd N
├── span: "690-219-12576"
├── ownerships: [→ Mad River LLC]
│
└── DWELLING
    ├── use: SHORT_TERM_RENTAL
    ├── is_owner_occupied: null  (LLC can't live here)
    ├── str_listing_ids: ["53252922"]  (HYGGE HAUS listing)
    ├── resident_id: null (no permanent resident)
    └── get_tax_classification() → "NHS_RESIDENTIAL"

    Linked STR_LISTING (from str_listings table):
    ├── name: "HYGGE HAUS - Mountain Views Minutes from Sugarbush"
    ├── listing_id: "53252922"
    └── bedrooms: 4
```

---

## Audit Trail

All changes to core entities are tracked.

```python
class ChangeLog(Base):
    """
    Audit trail for all data changes.
    """
    __tablename__ = "change_log"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)

    # What changed
    table_name: Mapped[str] = mapped_column(String(50))
    record_id: Mapped[UUID] = mapped_column()
    change_type: Mapped[str] = mapped_column(String(20))  # create, update, delete
    field_name: Mapped[str | None] = mapped_column(String(50))
    old_value: Mapped[str | None] = mapped_column(Text)  # JSON for complex types
    new_value: Mapped[str | None] = mapped_column(Text)

    # Who/why
    changed_by: Mapped[str] = mapped_column(
        String(100),
        doc="'system:grand_list_import', 'user:macon', etc."
    )
    change_reason: Mapped[str | None] = mapped_column(Text)

    # When
    changed_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    # Verification
    verified_by: Mapped[str | None] = mapped_column(String(100))
    verified_at: Mapped[datetime | None] = mapped_column()
```

---

## Data Sources Summary

| Entity | Primary Source | Enrichment Sources |
|--------|---------------|-------------------|
| Parcel | Vermont Grand List (Geodata API) | - |
| Dwelling | Inferred from Grand List DESCPROP | STR listings, manual |
| PropertyOwnership | Grand List OWNER1, OWNER2 | PTTR transfers |
| Person | Parsed from owner names | FPF, manual |
| Organization | Parsed from owner names (LLC, TRUST) | Secretary of State |
| STRListing | AirROI API | Airbnb scraping |
| FPFPerson | Front Porch Forum emails | - |
| FPFPost | Front Porch Forum emails | OpenAI embeddings |

---

## Migration Status

### ✅ Completed (2026-01-01)

1. **Unified Import** - `scripts/import_vermont_unified.py`
   - Creates parcels from unique SPANs
   - Creates dwellings from each API row (handles condos correctly)
   - Parses owner names into People or Organizations
   - Creates PropertyOwnership linking dwellings to owners
   - Preserves per-unit homestead status

2. **STR Matching Cleanup**
   - Removed false positives from spatial-only matching
   - Kept only 15 name-validated links (host first name matches owner)
   - Manual link for known STRs (e.g., HYGGE HAUS → Mad River LLC)

### 🔲 Future Work

1. **Person Deduplication** - Link FPF people to property owners
2. **STR Host Research** - Identify property managers (Vacasa, Evolve) to improve matching
3. **ADU Detection** - Manual addition of accessory dwelling units not in Grand List
4. **Audit Triggers** - Track all data changes with who/when/why

### Key Scripts

| Script | Purpose |
|--------|---------|
| `scripts/import_vermont_unified.py` | Main import: parcels → dwellings → owners |
| `scripts/import_airroi.py` | STR listings from AirROI API |
| `scripts/import_pttr.py` | Property transfers from PTTR API |
| `scripts/embed_fpf_posts.py` | Generate embeddings for FPF posts |

---

## STR Matching Approach

### The Problem with Spatial Matching

Airbnb and VRBO intentionally obfuscate listing coordinates by 100-200 meters for privacy. Our original approach matched STR listings to the nearest parcel centroid, but this created many false positives:

```
Example False Positive:
- STR: "The Vines" by host "Colin" at obfuscated coords
- Nearest parcel: 488 WOODS RD S (owned by PHILLIPS III ROBERT M)
- Actual owner: Colin Phillips at 129 LINCOLN GAP RD (3.2km away)
```

### Current Approach: Name Validation

We now only create STR → Dwelling links when the host name validates against the Grand List owner:

```python
# Validation logic
host_first = host_name.split()[0].upper()  # "Colin" → "COLIN"
owner_name = dwelling.occupant_name.upper()  # "PHILLIPS COLIN R"

if host_first in owner_name:
    # VALID: "COLIN" found in "PHILLIPS COLIN R"
    link_str_to_dwelling(str_listing, dwelling)
```

**Result**: 15 validated links out of 618 STR listings (2.4%)

### Why So Few Links?

Most STR listings are managed by property managers:
- Vacasa Northern Vermont
- Evolve
- Vermont Getaways LLC
- Sam At VTSkiHouses

These hosts don't match the Grand List owner names.

### Future Improvements

1. **Property Manager Registry** - Map known managers to properties they manage
2. **Address Text Matching** - Match STR names containing street names
3. **Manual Verification Queue** - Review high-confidence spatial matches
4. **VRBO Cross-Reference** - Some platforms may have better host data

---

## Warren Government Organizations (Seed Data)

```python
WARREN_ORGS = [
    Organization(
        name="Warren Planning Commission",
        org_type=OrganizationType.GOVERNMENT,
        notes="Reviews development, land use, zoning"
    ),
    Organization(
        name="Warren Selectboard",
        org_type=OrganizationType.GOVERNMENT,
        notes="Town executive body, 5 members"
    ),
    Organization(
        name="Warren Development Review Board",
        org_type=OrganizationType.GOVERNMENT,
        notes="Reviews permits under zoning regulations"
    ),
    Organization(
        name="Mad River Valley Planning District",
        org_type=OrganizationType.GOVERNMENT,
        notes="Regional planning for Warren, Waitsfield, Fayston"
    ),
    Organization(
        name="Mad River Valley Housing Coalition",
        org_type=OrganizationType.NONPROFIT,
        notes="Advocates for affordable housing"
    ),
]
```

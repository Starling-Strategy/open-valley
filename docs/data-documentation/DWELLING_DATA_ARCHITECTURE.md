# Dwelling Data Architecture

See [GLOSSARY.md](../GLOSSARY.md) for detailed definitions of DwellingUse, tax classification, and the data model.

## The Problem

The Vermont Grand List's `CAT` (category) codes are often wrong:
- **488 Woods Rd S**: CAT=R2 (multi-family) but DESCPROP says "& DWL" (one dwelling)
- **448 Woods Rd S**: CAT=R2 but DESCPROP says "& DWL" (one dwelling)

But DESCPROP doesn't capture everything:
- **200 Woods Rd S**: DESCPROP says "& DWL" but there's an ADU above the garage (2 dwellings)

## Solution: Layered Data with Audit Trail

```
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 1: PUBLIC DATA (Authoritative Baseline)                      │
│  ────────────────────────────────────────────────────────────────── │
│  Source: Vermont Grand List (DESCPROP field)                        │
│  Trust level: High for EXISTENCE, low for CLASSIFICATION            │
│  Updated: Annually when Grand List refreshes                        │
│                                                                     │
│  Key insight: Parse "& DWL" vs "& 2 DWLS" from DESCPROP             │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 2: ENRICHMENT DATA                                           │
│  ────────────────────────────────────────────────────────────────── │
│  Sources: AirROI STRs, PTTR transfers                               │
│  Trust level: High for STR status, moderate for classification      │
│  Updated: Periodically via API pulls                                │
│                                                                     │
│  Adds: str_listing_id, buyer_state, intended_use                    │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 3: LOCAL KNOWLEDGE (Corrections & Additions)                 │
│  ────────────────────────────────────────────────────────────────── │
│  Source: Manual input, community knowledge                          │
│  Trust level: Verified (must be confirmed)                          │
│  Updated: As corrections are submitted                              │
│                                                                     │
│  Examples:                                                          │
│  - "200 Woods Rd S has an ADU above garage" → Add dwelling          │
│  - "The Vines STR is at 565 Woods, not 488" → Fix STR match         │
│  - "Phillips moved from CA to Warren in 2023" → Update mailing      │
└─────────────────────────────────────────────────────────────────────┘
```

## Database Schema

### Core Tables

```sql
-- Dwellings: The base table (current state)
-- See GLOSSARY.md for DwellingUse enum values and tax classification derivation
CREATE TABLE dwellings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parcel_id UUID NOT NULL REFERENCES parcels(id),

    -- Identity
    unit_number VARCHAR(20),           -- NULL for single-dwelling parcels
    unit_address TEXT,                  -- Full address including unit

    -- Physical characteristics
    bedrooms INTEGER,
    bathrooms NUMERIC(3,1),
    square_feet INTEGER,
    year_built INTEGER,
    dwelling_type VARCHAR(30),          -- 'single_family', 'adu', 'condo', 'apartment'

    -- PRIMARY CLASSIFICATION: Occupancy pattern
    use VARCHAR(30),                    -- DwellingUse enum: 'full_time_residence', 'short_term_rental', 'second_home', 'vacant', etc.

    -- For FULL_TIME_RESIDENCE: owner or tenant?
    is_owner_occupied BOOLEAN,          -- True=owner lives here, False=tenant, NULL=unknown/N/A

    -- STR LISTINGS: Separate data (can attach to ANY dwelling)
    str_listing_ids TEXT[],             -- Array of matched STR listing IDs

    -- Data provenance
    data_source VARCHAR(50) NOT NULL,   -- 'grand_list', 'str_match', 'manual', 'attestation'
    source_confidence NUMERIC(3,2),     -- 0.0-1.0

    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Soft delete
    deleted_at TIMESTAMP,
    deleted_reason TEXT
);

-- NOTE: Tax classification (HOMESTEAD, NHS_RESIDENTIAL, NHS_NONRESIDENTIAL) is DERIVED:
--   HOMESTEAD = use='full_time_residence' AND is_owner_occupied=true
--   NHS_NONRESIDENTIAL = use='full_time_residence' AND is_owner_occupied=false (LTR)
--   NHS_RESIDENTIAL = use IN ('short_term_rental', 'second_home', 'vacant')

-- Audit log: Every change is recorded
CREATE TABLE dwelling_changes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dwelling_id UUID NOT NULL REFERENCES dwellings(id),

    -- What changed
    change_type VARCHAR(20) NOT NULL,   -- 'create', 'update', 'delete', 'merge', 'split'
    field_name VARCHAR(50),             -- Which field changed (NULL for create/delete)
    old_value TEXT,                     -- Previous value (JSON for complex types)
    new_value TEXT,                     -- New value

    -- Who/why
    changed_by VARCHAR(100),            -- 'system:grand_list_import', 'user:macon', etc.
    change_reason TEXT,                 -- "Corrected based on local knowledge"
    source_reference TEXT,              -- Link to source (SPAN, STR listing ID, etc.)

    -- When
    changed_at TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Verification
    verified_by VARCHAR(100),
    verified_at TIMESTAMP,
    verification_notes TEXT
);

CREATE INDEX idx_dwelling_changes_dwelling ON dwelling_changes(dwelling_id);
CREATE INDEX idx_dwelling_changes_changed_at ON dwelling_changes(changed_at);
```

### Automatic Audit Trigger

```sql
-- Trigger to automatically log all dwelling changes
CREATE OR REPLACE FUNCTION log_dwelling_change()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO dwelling_changes (dwelling_id, change_type, changed_by, change_reason)
        VALUES (NEW.id, 'create', current_setting('app.current_user', true),
                'Initial creation from ' || NEW.data_source);
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Log each changed field
        IF OLD.use IS DISTINCT FROM NEW.use THEN
            INSERT INTO dwelling_changes (dwelling_id, change_type, field_name, old_value, new_value, changed_by)
            VALUES (NEW.id, 'update', 'use', OLD.use, NEW.use,
                    current_setting('app.current_user', true));
        END IF;
        IF OLD.is_owner_occupied IS DISTINCT FROM NEW.is_owner_occupied THEN
            INSERT INTO dwelling_changes (dwelling_id, change_type, field_name, old_value, new_value, changed_by)
            VALUES (NEW.id, 'update', 'is_owner_occupied', OLD.is_owner_occupied::text, NEW.is_owner_occupied::text,
                    current_setting('app.current_user', true));
        END IF;
        -- (Add similar blocks for other important fields)
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO dwelling_changes (dwelling_id, change_type, changed_by, change_reason)
        VALUES (OLD.id, 'delete', current_setting('app.current_user', true), OLD.deleted_reason);
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER dwelling_audit_trigger
AFTER INSERT OR UPDATE OR DELETE ON dwellings
FOR EACH ROW EXECUTE FUNCTION log_dwelling_change();
```

## Workflow: Making Corrections

### Example 1: Split incorrectly-merged dwellings

488 Woods Rd S was created with 2 dwellings but should have 1:

```python
# Before: dwelling_id = 'abc123' (STR) and 'def456' (HOMESTEAD)
# After: Just 'def456' (HOMESTEAD)

with Session(engine) as session:
    # Set context for audit trail
    session.execute(text("SET app.current_user = 'user:macon'"))

    # Delete the incorrect STR dwelling
    wrong_dwelling = session.get(Dwelling, 'abc123')
    wrong_dwelling.deleted_at = datetime.now()
    wrong_dwelling.deleted_reason = "Incorrectly created from R2 CAT code. DESCPROP shows single DWL."

    # Log will automatically capture: deleted by 'user:macon' with reason
    session.commit()
```

### Example 2: Add missing ADU

200 Woods Rd S has 1 dwelling but should have 2 (ADU above garage):

```python
with Session(engine) as session:
    session.execute(text("SET app.current_user = 'user:macon'"))

    # Get the parcel
    parcel = session.query(Parcel).filter(Parcel.span == '690-219-12656').first()

    # Add the ADU (long-term tenant lives there)
    adu = Dwelling(
        parcel_id=parcel.id,
        unit_number="ADU-1",
        unit_address="200 WOODS RD SOUTH (GARAGE APT)",
        dwelling_type="adu",
        use=DwellingUse.FULL_TIME_RESIDENCE,  # Tenant lives here year-round
        is_owner_occupied=False,               # Tenant, not owner
        str_listing_ids=[],                    # No STR activity
        data_source="manual",
        source_confidence=0.95,  # High confidence from local knowledge
    )
    # Derived tax_classification → NHS_NONRESIDENTIAL (long-term rental)
    session.add(adu)

    # Log will automatically capture: created by 'user:macon'
    session.commit()
```

### Example 3: Correct STR match

"The Vines" was matched to 488 but belongs to 565:

```python
with Session(engine) as session:
    session.execute(text("SET app.current_user = 'user:macon'"))

    # Get the STR listing
    str_listing = session.query(STRListing).filter(STRListing.name == 'The Vines').first()

    # Get correct parcel
    correct_parcel = session.query(Parcel).filter(Parcel.address.ilike('%565 WOODS%')).first()

    # Update the match
    str_listing.parcel_id = correct_parcel.id
    str_listing.match_method = 'manual_correction'
    str_listing.match_confidence = 1.0

    session.commit()
```

## Querying History

```sql
-- See all changes for a dwelling
SELECT
    dc.changed_at,
    dc.change_type,
    dc.field_name,
    dc.old_value,
    dc.new_value,
    dc.changed_by,
    dc.change_reason
FROM dwelling_changes dc
WHERE dc.dwelling_id = 'abc123'
ORDER BY dc.changed_at;

-- See all corrections made by a user
SELECT
    p.address,
    dc.field_name,
    dc.old_value,
    dc.new_value,
    dc.change_reason,
    dc.changed_at
FROM dwelling_changes dc
JOIN dwellings d ON d.id = dc.dwelling_id
JOIN parcels p ON p.id = d.parcel_id
WHERE dc.changed_by = 'user:macon'
ORDER BY dc.changed_at DESC;

-- Track dwellings becoming full-time residences over time
SELECT
    DATE_TRUNC('month', dc.changed_at) as month,
    SUM(CASE WHEN dc.new_value = 'full_time_residence' THEN 1 ELSE 0 END) as became_full_time,
    SUM(CASE WHEN dc.old_value = 'full_time_residence' THEN 1 ELSE 0 END) as left_full_time
FROM dwelling_changes dc
WHERE dc.field_name = 'use'
GROUP BY 1
ORDER BY 1;
```

## Implementation Priority

1. **Fix import script** - Parse DESCPROP for dwelling count instead of using CAT codes
2. **Add audit table** - Track all changes with who/when/why
3. **Build correction UI** - Allow manual overrides with reason
4. **Annual refresh** - Compare Grand List changes year-over-year

## The Three Woods Road Properties: Corrected

| Property | Grand List | Correction Needed | Final State |
|----------|-----------|-------------------|-------------|
| 488 Phillips | CAT=R2, DESCPROP="& DWL" | None (use DESCPROP) | 1 dwelling, `use=FULL_TIME_RESIDENCE`, `is_owner_occupied=true` → HOMESTEAD |
| 448 Tremblay | CAT=R2, DESCPROP="& DWL" | None (use DESCPROP) | 1 dwelling, `use=SECOND_HOME` → NHS_RESIDENTIAL |
| 200 Fabio | CAT=R1, DESCPROP="& DWL" | Add ADU manually | 2 dwellings: main (`use=SECOND_HOME`) + ADU (`use=FULL_TIME_RESIDENCE`, `is_owner_occupied=false`) |

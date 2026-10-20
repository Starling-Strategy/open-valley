"""FastAPI application for Warren Community Intelligence."""

import logging
import os
from contextlib import asynccontextmanager

import logfire
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import func

import httpx

from .database import SessionLocal, init_db
from .models import Dwelling, Organization, Parcel, Person, PropertyOwnership, STRListing, TaxStatus

# Vermont Geodata ArcGIS REST API
ARCGIS_BASE = "https://services1.arcgis.com/BkFxaEFNwHqX3tAw/arcgis/rest/services"
PARCELS_LAYER = "FS_VCGI_OPENDATA_Cadastral_VTPARCELS_poly_standardized_parcels_SP_v1/FeatureServer/0"
PARCELS_URL = f"{ARCGIS_BASE}/{PARCELS_LAYER}/query"

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database on startup."""
    init_db()
    yield


app = FastAPI(
    title="Open Valley API",
    description="Warren Community Intelligence - housing data API",
    version="0.1.0",
    lifespan=lifespan,
)

# Configure Logfire for observability (after app creation)
if os.getenv("LOGFIRE_TOKEN"):
    logfire.configure()
    logfire.instrument_fastapi(app)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3999", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "Open Valley API"}


@app.get("/llms.txt")
async def llms_txt():
    """Documentation for AI agents about this API."""
    return """# Open Valley API

## Overview
This Python backend retains the Warren, Vermont housing data API.
It provides property data, homestead classifications, and community statistics.
The public HUUSD Schools experience and assistant live in the Next.js application
in web/, not at /awp. This backend does not provide an /awp assistant endpoint.

## Key Concepts
- SPAN: Vermont's unique parcel identifier (e.g., 690-219-11993)
- Homestead: Primary residence filing - if filed, likely year-round resident
- Assessed Value: Town's valuation for tax purposes

## API Endpoints
- GET / - Health check
- GET /llms.txt - This documentation
- GET /api/stats - Aggregate parcel, dwelling, and short-term rental statistics
- GET /api/dwellings/geojson - Dwelling points with homestead classifications
- GET /api/parcels/geojson - Warren parcel geometry with homestead classifications
- GET /api/transfers/transitions - Property transfer homestead transitions as GeoJSON
"""


# =============================================================================
# Dashboard Stats API
# =============================================================================


class ParcelCategoryStats(BaseModel):
    """Statistics for a parcel category."""
    count: int
    percent: float


class ParcelBreakdown(BaseModel):
    """Breakdown of parcels by category."""
    total: int
    homestead: ParcelCategoryStats
    nhs_residential: ParcelCategoryStats
    other: ParcelCategoryStats


class ParcelStats(BaseModel):
    """Statistics about parcels."""
    count: int
    total_value: int
    breakdown: ParcelBreakdown | None = None


class HomesteadStats(BaseModel):
    """Homestead statistics."""
    count: int
    percent: float


class DwellingStats(BaseModel):
    """Dwelling statistics by classification."""
    total: int
    homestead: HomesteadStats
    nhs_residential: HomesteadStats


class STRStats(BaseModel):
    """Short-term rental statistics."""
    count: int
    linked_dwellings: int = 0


class EntityCounts(BaseModel):
    """Counts for all major entities in the database."""
    parcels: int
    dwellings: int
    people: int
    organizations: int
    property_ownerships: int
    str_listings: int
    str_linked_dwellings: int


class DashboardStatsResponse(BaseModel):
    """Complete dashboard statistics response."""
    parcels: ParcelStats
    dwellings: DwellingStats
    str_listings: STRStats
    entity_counts: EntityCounts


@app.get("/api/stats", response_model=DashboardStatsResponse)
async def get_dashboard_stats():
    """Return key statistics for the dashboard.

    This endpoint provides aggregate statistics for the Open Valley dashboard:
    - Total parcels and assessed value
    - Dwelling breakdown by Act 73 classification (homestead vs NHS residential)
    - Short-term rental listing count
    """
    from sqlalchemy import text as sql_text

    db = SessionLocal()
    try:
        # Parcel statistics
        parcel_count = db.query(func.count(Parcel.id)).scalar() or 0
        total_value = db.query(func.sum(Parcel.assessed_total)).scalar() or 0

        # Parcel breakdown by category
        parcel_breakdown = db.execute(sql_text("""
            WITH parcel_categories AS (
                SELECT
                    p.id,
                    p.property_type,
                    EXISTS (SELECT 1 FROM dwellings d WHERE d.parcel_id = p.id AND d.homestead_filed = true) as is_homestead
                FROM parcels p
            )
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE is_homestead = true) as homestead,
                COUNT(*) FILTER (WHERE is_homestead = false AND property_type IN ('residential', 'multi-family')) as nhs_residential,
                COUNT(*) FILTER (WHERE is_homestead = false AND property_type NOT IN ('residential', 'multi-family')) as other
            FROM parcel_categories
        """)).fetchone()

        # Dwelling statistics using raw SQL (avoid ORM/schema mismatch)
        dwelling_stats = db.execute(sql_text("""
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE homestead_filed = true) as homestead,
                COUNT(*) FILTER (WHERE homestead_filed = false OR homestead_filed IS NULL) as nhs_residential
            FROM dwellings
        """)).fetchone()

        total_dwellings = dwelling_stats.total or 0
        homestead_dwellings = dwelling_stats.homestead or 0
        nhs_residential_dwellings = dwelling_stats.nhs_residential or 0

        # Calculate percentages
        if total_dwellings > 0:
            homestead_pct = round((homestead_dwellings / total_dwellings) * 100, 1)
            nhs_pct = round((nhs_residential_dwellings / total_dwellings) * 100, 1)
        else:
            homestead_pct = 0.0
            nhs_pct = 0.0

        # STR listing count
        str_count = db.query(func.count(STRListing.id)).filter(
            STRListing.is_active == True
        ).scalar() or 0

        # STR-linked dwellings using raw SQL
        str_linked_result = db.execute(sql_text(
            "SELECT COUNT(*) FROM dwellings WHERE str_listing_id IS NOT NULL"
        )).scalar() or 0

        # People count
        people_count = db.query(func.count(Person.id)).scalar() or 0

        # Organizations count
        org_count = db.query(func.count(Organization.id)).scalar() or 0

        # PropertyOwnership count
        ownership_count = db.query(func.count(PropertyOwnership.id)).scalar() or 0

        # Calculate parcel breakdown percentages
        pb_total = parcel_breakdown.total or parcel_count
        pb_homestead = parcel_breakdown.homestead or 0
        pb_nhs_res = parcel_breakdown.nhs_residential or 0
        pb_other = parcel_breakdown.other or 0

        return DashboardStatsResponse(
            parcels=ParcelStats(
                count=parcel_count,
                total_value=int(total_value),
                breakdown=ParcelBreakdown(
                    total=pb_total,
                    homestead=ParcelCategoryStats(
                        count=pb_homestead,
                        percent=round((pb_homestead / pb_total) * 100, 1) if pb_total > 0 else 0.0,
                    ),
                    nhs_residential=ParcelCategoryStats(
                        count=pb_nhs_res,
                        percent=round((pb_nhs_res / pb_total) * 100, 1) if pb_total > 0 else 0.0,
                    ),
                    other=ParcelCategoryStats(
                        count=pb_other,
                        percent=round((pb_other / pb_total) * 100, 1) if pb_total > 0 else 0.0,
                    ),
                ),
            ),
            dwellings=DwellingStats(
                total=total_dwellings,
                homestead=HomesteadStats(
                    count=homestead_dwellings,
                    percent=homestead_pct,
                ),
                nhs_residential=HomesteadStats(
                    count=nhs_residential_dwellings,
                    percent=nhs_pct,
                ),
            ),
            str_listings=STRStats(
                count=str_count,
                linked_dwellings=str_linked_result,
            ),
            entity_counts=EntityCounts(
                parcels=parcel_count,
                dwellings=total_dwellings,
                people=people_count,
                organizations=org_count,
                property_ownerships=ownership_count,
                str_listings=str_count,
                str_linked_dwellings=str_linked_result,
            ),
        )
    finally:
        db.close()


# =============================================================================
# GeoJSON API for MapLibre
# =============================================================================

# Cache for Vermont Geodata response (avoid repeated API calls)
_geojson_cache: dict = {"data": None, "timestamp": 0}
CACHE_TTL = 3600  # 1 hour


@app.get("/api/dwellings/geojson")
async def get_dwellings_geojson():
    """Return dwellings as GeoJSON points for clustered map visualization.

    Each dwelling becomes a point feature at its parcel's centroid.
    Properties include tax_classification for coloring (homestead vs non-homestead).
    """
    from sqlalchemy import text as sql_text

    db = SessionLocal()
    try:
        # Use raw SQL to avoid ORM/schema mismatch
        result = db.execute(sql_text("""
            SELECT
                d.id,
                d.unit_number,
                d.homestead_filed,
                d.bedrooms,
                d.str_listing_id,
                p.id as parcel_id,
                p.span,
                p.address,
                p.lat,
                p.lng
            FROM dwellings d
            JOIN parcels p ON d.parcel_id = p.id
            WHERE p.lat IS NOT NULL AND p.lng IS NOT NULL
        """))

        features = []
        for row in result:
            # Determine classification for coloring based on homestead_filed
            classification = "homestead" if row.homestead_filed else "non_homestead"
            tax_classification = "HOMESTEAD" if row.homestead_filed else "NHS_RESIDENTIAL"

            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [float(row.lng), float(row.lat)]
                },
                "properties": {
                    "id": str(row.id),
                    "parcel_id": str(row.parcel_id),
                    "span": row.span,
                    "address": row.address,
                    "unit_number": row.unit_number,
                    "tax_classification": tax_classification,
                    "classification": classification,
                    "homestead_filed": row.homestead_filed,
                    "bedrooms": row.bedrooms,
                    "has_str": row.str_listing_id is not None,
                }
            })

        logger.info(f"Returning {len(features)} dwelling points")

        return {
            "type": "FeatureCollection",
            "features": features,
        }
    finally:
        db.close()


@app.get("/api/parcels/geojson")
async def get_parcels_geojson():
    """Return Warren parcels as GeoJSON with homestead classification.

    Fetches geometry from Vermont Geodata API and enriches with local
    homestead filing status for choropleth visualization.
    """
    import time

    current_time = time.time()

    # Check cache
    if _geojson_cache["data"] and (current_time - _geojson_cache["timestamp"]) < CACHE_TTL:
        logger.debug("Returning cached GeoJSON")
        return _geojson_cache["data"]

    # Fetch from Vermont Geodata
    logger.info("Fetching parcels from Vermont Geodata API...")

    all_features = []
    offset = 0

    async with httpx.AsyncClient(timeout=60.0) as client:
        while True:
            params = {
                "where": "TOWN = 'WARREN'",
                "outFields": "SPAN,E911ADDR,OWNER1,REAL_FLV,ACRESGL,HSDECL",
                "returnGeometry": "true",
                "outSR": "4326",
                "f": "geojson",
                "resultOffset": offset,
                "resultRecordCount": 1000,
            }

            response = await client.get(PARCELS_URL, params=params)
            response.raise_for_status()
            data = response.json()

            features = data.get("features", [])
            if not features:
                break

            all_features.extend(features)

            if len(features) < 1000:
                break
            offset += 1000

    logger.info(f"Fetched {len(all_features)} parcels from Vermont Geodata")

    # Get local homestead and property_type data for enrichment
    db = SessionLocal()
    try:
        # Build SPAN -> (homestead_filed, property_type) lookup
        tax_records = db.query(
            TaxStatus.parcel_id,
            TaxStatus.homestead_filed,
            Parcel.span,
            Parcel.property_type
        ).join(
            Parcel, TaxStatus.parcel_id == Parcel.id
        ).all()

        homestead_lookup = {r.span: r.homestead_filed for r in tax_records}
        property_type_lookup = {r.span: r.property_type for r in tax_records}
        logger.debug(f"Built homestead lookup with {len(homestead_lookup)} entries")
    finally:
        db.close()

    # Enrich features with local homestead data
    for feature in all_features:
        props = feature.get("properties", {})
        span = props.get("SPAN")

        # Use local data if available, otherwise fall back to API data
        if span and span in homestead_lookup:
            props["homestead_filed"] = homestead_lookup[span]
        else:
            # Fall back to HSDECL from API
            props["homestead_filed"] = props.get("HSDECL") == "Y"

        # Add property_type from local database
        props["property_type"] = property_type_lookup.get(span, "other") if span else "other"

        # Add classification for choropleth (three categories)
        if props["homestead_filed"]:
            props["classification"] = "homestead"
        elif props["property_type"] in ("residential", "multi-family"):
            props["classification"] = "nhs_residential"
        else:
            props["classification"] = "other"

    result = {
        "type": "FeatureCollection",
        "features": all_features,
    }

    # Update cache
    _geojson_cache["data"] = result
    _geojson_cache["timestamp"] = current_time

    return result


# =============================================================================
# Homestead Transitions API (for animated map)
# =============================================================================


@app.get("/api/transfers/transitions")
async def get_homestead_transitions():
    """Return homestead transitions as GeoJSON for map animation.

    Each feature represents a property transfer classified by actual status change:

    - TRUE_LOSS: VT seller (was homestead) → non-primary buyer (de-homesteading)
    - TRUE_GAIN: Non-VT seller (was 2nd home) → primary buyer (re-homesteading)
    - STAYED_HOMESTEAD: VT seller → primary buyer (no net change)
    - STAYED_NON_HOMESTEAD: Non-VT seller → non-primary buyer (no net change)
    - OTHER: Unknown seller state, open land, commercial, etc.

    Uses coordinates directly from PTTR data (93% coverage).
    """
    from sqlalchemy import text as sql_text

    db = SessionLocal()
    try:
        result = db.execute(sql_text("""
            SELECT
                b.raw_json::json->'attributes'->>'span' as span,
                (b.raw_json::json->'attributes'->>'Latitude')::float as lat,
                (b.raw_json::json->'attributes'->>'Longitude')::float as lng,
                pt.transfer_date,
                pt.sale_price,
                b.raw_json::json->'attributes'->>'sellerSt' as seller_state,
                b.raw_json::json->'attributes'->>'bUsePrDesc' as use_desc,
                pt.buyer_state,
                CASE
                    -- TRUE LOSS: VT seller (was homestead) → non-primary buyer
                    WHEN b.raw_json::json->'attributes'->>'sellerSt' = 'VT'
                         AND (pt.intended_use = 'secondary'
                              OR b.raw_json::json->'attributes'->>'bUsePrDesc' LIKE 'Non-PR%')
                    THEN 'TRUE_LOSS'

                    -- TRUE GAIN: Non-VT seller (was 2nd home) → primary buyer
                    WHEN b.raw_json::json->'attributes'->>'sellerSt' IS NOT NULL
                         AND b.raw_json::json->'attributes'->>'sellerSt' != 'VT'
                         AND b.raw_json::json->'attributes'->>'bUsePrDesc'
                             IN ('Domicile/Primary Residence', 'Principal Residence')
                    THEN 'TRUE_GAIN'

                    -- STAYED HOMESTEAD: VT seller → primary buyer (no change)
                    WHEN b.raw_json::json->'attributes'->>'sellerSt' = 'VT'
                         AND b.raw_json::json->'attributes'->>'bUsePrDesc'
                             IN ('Domicile/Primary Residence', 'Principal Residence')
                    THEN 'STAYED_HOMESTEAD'

                    -- STAYED NON-HOMESTEAD: Non-VT seller → non-primary buyer (no change)
                    WHEN b.raw_json::json->'attributes'->>'sellerSt' IS NOT NULL
                         AND b.raw_json::json->'attributes'->>'sellerSt' != 'VT'
                         AND (pt.intended_use = 'secondary'
                              OR b.raw_json::json->'attributes'->>'bUsePrDesc' LIKE 'Non-PR%')
                    THEN 'STAYED_NON_HOMESTEAD'

                    -- OTHER: Unknown seller state, open land, commercial, etc.
                    ELSE 'OTHER'
                END as transition_type
            FROM property_transfers pt
            JOIN bronze_pttr_transfers b ON pt.bronze_id = b.id
            WHERE pt.transfer_date >= '2019-01-01'
              AND (b.raw_json::json->'attributes'->>'Latitude')::float != 0
              AND (b.raw_json::json->'attributes'->>'Longitude')::float != 0
            ORDER BY pt.transfer_date
        """))

        features = []
        for row in result:
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [float(row.lng), float(row.lat)]
                },
                "properties": {
                    "span": row.span,
                    "date": row.transfer_date.isoformat() if row.transfer_date else None,
                    "year": row.transfer_date.year if row.transfer_date else None,
                    "sale_price": row.sale_price,
                    "seller_state": row.seller_state,
                    "buyer_state": row.buyer_state,
                    "use_desc": row.use_desc,
                    "transition_type": row.transition_type,
                }
            })

        # Calculate summary stats by year with new categories
        stats_result = db.execute(sql_text("""
            SELECT
                EXTRACT(YEAR FROM pt.transfer_date)::int as year,
                -- TRUE LOSS: VT seller → non-primary (de-homesteading)
                COUNT(*) FILTER (WHERE
                    b.raw_json::json->'attributes'->>'sellerSt' = 'VT'
                    AND (pt.intended_use = 'secondary'
                         OR b.raw_json::json->'attributes'->>'bUsePrDesc' LIKE 'Non-PR%')
                ) as true_losses,
                -- TRUE GAIN: Non-VT seller → primary (re-homesteading)
                COUNT(*) FILTER (WHERE
                    b.raw_json::json->'attributes'->>'sellerSt' IS NOT NULL
                    AND b.raw_json::json->'attributes'->>'sellerSt' != 'VT'
                    AND b.raw_json::json->'attributes'->>'bUsePrDesc'
                        IN ('Domicile/Primary Residence', 'Principal Residence')
                ) as true_gains,
                -- STAYED HOMESTEAD: VT seller → primary (no change)
                COUNT(*) FILTER (WHERE
                    b.raw_json::json->'attributes'->>'sellerSt' = 'VT'
                    AND b.raw_json::json->'attributes'->>'bUsePrDesc'
                        IN ('Domicile/Primary Residence', 'Principal Residence')
                ) as stayed_homestead,
                -- STAYED NON-HOMESTEAD: Non-VT seller → non-primary (no change)
                COUNT(*) FILTER (WHERE
                    b.raw_json::json->'attributes'->>'sellerSt' IS NOT NULL
                    AND b.raw_json::json->'attributes'->>'sellerSt' != 'VT'
                    AND (pt.intended_use = 'secondary'
                         OR b.raw_json::json->'attributes'->>'bUsePrDesc' LIKE 'Non-PR%')
                ) as stayed_non_homestead
            FROM property_transfers pt
            JOIN bronze_pttr_transfers b ON pt.bronze_id = b.id
            WHERE pt.transfer_date >= '2019-01-01'
              AND (b.raw_json::json->'attributes'->>'Latitude')::float != 0
              AND (b.raw_json::json->'attributes'->>'Longitude')::float != 0
            GROUP BY 1
            ORDER BY 1
        """))

        yearly_stats = {
            row.year: {
                "true_losses": row.true_losses,
                "true_gains": row.true_gains,
                "stayed_homestead": row.stayed_homestead,
                "stayed_non_homestead": row.stayed_non_homestead,
                "net": row.true_gains - row.true_losses,
            }
            for row in stats_result
        }

        # Count by transition type
        true_gains = sum(1 for f in features if f["properties"]["transition_type"] == "TRUE_GAIN")
        true_losses = sum(1 for f in features if f["properties"]["transition_type"] == "TRUE_LOSS")
        stayed_homestead = sum(1 for f in features if f["properties"]["transition_type"] == "STAYED_HOMESTEAD")
        stayed_non_homestead = sum(1 for f in features if f["properties"]["transition_type"] == "STAYED_NON_HOMESTEAD")
        other = sum(1 for f in features if f["properties"]["transition_type"] == "OTHER")

        return {
            "type": "FeatureCollection",
            "features": features,
            "metadata": {
                "total_features": len(features),
                "true_gains": true_gains,
                "true_losses": true_losses,
                "stayed_homestead": stayed_homestead,
                "stayed_non_homestead": stayed_non_homestead,
                "other": other,
                "net_change": true_gains - true_losses,
                "yearly_stats": yearly_stats,
            }
        }
    finally:
        db.close()


# =============================================================================
# ADMIN API: STR-Dwelling HITL Review
# Human-in-the-loop review for linking STR listings to dwellings
# =============================================================================

from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from datetime import datetime
from decimal import Decimal
from sqlalchemy import text
from .models import STRReviewStatus
from .schemas import (
    STRReviewQueueItem,
    STRReviewQueueResponse,
    STRReviewDetailResponse,
    CandidateDwelling,
    STRReviewAction,
    STRReviewActionResponse,
    STRReviewStats,
)

# Simple bearer token auth for admin endpoints
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "dev-admin-token")
security = HTTPBearer(auto_error=False)


async def verify_admin(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Verify admin bearer token."""
    if not credentials:
        raise HTTPException(status_code=401, detail="Admin token required")
    if credentials.credentials != ADMIN_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid admin token")
    return True


def compute_dwelling_match_score(listing: STRListing, dwelling: Dwelling) -> float:
    """Compute how likely a dwelling matches an STR listing."""
    score = 0.0

    # Bedroom match (strong signal)
    if listing.bedrooms and dwelling.bedrooms:
        if listing.bedrooms == dwelling.bedrooms:
            score += 0.4
        elif abs(listing.bedrooms - dwelling.bedrooms) == 1:
            score += 0.2

    # Not homestead (STRs unlikely to be primary residence)
    if not dwelling.homestead_filed:
        score += 0.2

    # Has use_type indicating STR or non-primary use
    if dwelling.use_type:
        use_lower = dwelling.use_type.lower()
        if "rental" in use_lower or "str" in use_lower:
            score += 0.3
        elif "vacation" in use_lower or "seasonal" in use_lower:
            score += 0.2

    # Penalize if already linked to another STR
    if dwelling.str_listing_id:
        score -= 0.2

    return max(0.0, min(1.0, score))


@app.get("/api/admin/str-review/stats", dependencies=[Depends(verify_admin)])
async def get_str_review_stats() -> STRReviewStats:
    """Get statistics about STR review progress."""
    db = SessionLocal()
    try:
        total = db.query(func.count(STRListing.id)).scalar() or 0
        matched = db.query(func.count(STRListing.id)).filter(
            STRListing.parcel_id.isnot(None)
        ).scalar() or 0

        # Get review status counts
        unreviewed = db.query(func.count(STRListing.id)).outerjoin(
            STRReviewStatus, STRListing.id == STRReviewStatus.str_listing_id
        ).filter(
            (STRReviewStatus.id.is_(None)) | (STRReviewStatus.status == "unreviewed")
        ).scalar() or 0

        confirmed = db.query(func.count(STRReviewStatus.id)).filter(
            STRReviewStatus.status == "confirmed"
        ).scalar() or 0

        rejected = db.query(func.count(STRReviewStatus.id)).filter(
            STRReviewStatus.status == "rejected"
        ).scalar() or 0

        skipped = db.query(func.count(STRReviewStatus.id)).filter(
            STRReviewStatus.status == "skipped"
        ).scalar() or 0

        reviewed = confirmed + rejected + skipped
        completion = (reviewed / total * 100) if total > 0 else 0

        return STRReviewStats(
            total_listings=total,
            matched_to_parcel=matched,
            unreviewed=unreviewed,
            confirmed=confirmed,
            rejected=rejected,
            skipped=skipped,
            completion_percent=round(completion, 1),
        )
    finally:
        db.close()


@app.get("/api/admin/str-review/queue", dependencies=[Depends(verify_admin)])
async def get_str_review_queue(
    status: str = "unreviewed",
    limit: int = 100,
    offset: int = 0,
) -> STRReviewQueueResponse:
    """Get STR listings for review with pagination."""
    db = SessionLocal()
    try:
        # Build query for listings
        query = db.query(STRListing, Parcel, STRReviewStatus).outerjoin(
            Parcel, STRListing.parcel_id == Parcel.id
        ).outerjoin(
            STRReviewStatus, STRListing.id == STRReviewStatus.str_listing_id
        )

        # Filter by status
        if status == "unreviewed":
            query = query.filter(
                (STRReviewStatus.id.is_(None)) | (STRReviewStatus.status == "unreviewed")
            )
        elif status in ("confirmed", "rejected", "skipped"):
            query = query.filter(STRReviewStatus.status == status)
        # "all" returns everything

        # Get total before pagination
        total = query.count()

        # Apply pagination
        listings = query.offset(offset).limit(limit).all()

        # Convert to response items
        items = []
        for listing, parcel, review_status in listings:
            # Count candidate dwellings on parcel
            candidate_count = 0
            if parcel:
                candidate_count = db.query(func.count(Dwelling.id)).filter(
                    Dwelling.parcel_id == parcel.id
                ).scalar() or 0

            items.append(STRReviewQueueItem(
                id=str(listing.id),
                platform=listing.platform,
                listing_id=listing.listing_id,
                name=listing.name,
                listing_url=listing.listing_url,
                lat=float(listing.lat) if listing.lat else None,
                lng=float(listing.lng) if listing.lng else None,
                bedrooms=listing.bedrooms,
                max_guests=listing.max_guests,
                price_per_night_usd=listing.price_per_night_usd,
                total_reviews=listing.total_reviews,
                average_rating=float(listing.average_rating) if listing.average_rating else None,
                parcel_id=str(parcel.id) if parcel else None,
                parcel_span=parcel.span if parcel else None,
                parcel_address=parcel.address if parcel else None,
                match_method=listing.match_method,
                match_confidence=float(listing.match_confidence) if listing.match_confidence else None,
                review_status=review_status.status if review_status else "unreviewed",
                dwelling_id=str(review_status.dwelling_id) if review_status and review_status.dwelling_id else None,
                candidate_dwelling_count=candidate_count,
                reviewed_by=review_status.reviewed_by if review_status else None,
                reviewed_at=review_status.reviewed_at.isoformat() if review_status and review_status.reviewed_at else None,
            ))

        # Get status counts for summary
        unreviewed_count = db.query(func.count(STRListing.id)).outerjoin(
            STRReviewStatus, STRListing.id == STRReviewStatus.str_listing_id
        ).filter(
            (STRReviewStatus.id.is_(None)) | (STRReviewStatus.status == "unreviewed")
        ).scalar() or 0

        confirmed_count = db.query(func.count(STRReviewStatus.id)).filter(
            STRReviewStatus.status == "confirmed"
        ).scalar() or 0

        rejected_count = db.query(func.count(STRReviewStatus.id)).filter(
            STRReviewStatus.status == "rejected"
        ).scalar() or 0

        skipped_count = db.query(func.count(STRReviewStatus.id)).filter(
            STRReviewStatus.status == "skipped"
        ).scalar() or 0

        return STRReviewQueueResponse(
            items=items,
            total=total,
            unreviewed_count=unreviewed_count,
            confirmed_count=confirmed_count,
            rejected_count=rejected_count,
            skipped_count=skipped_count,
        )
    finally:
        db.close()


@app.get("/api/admin/str-review/{listing_id}", dependencies=[Depends(verify_admin)])
async def get_str_review_detail(listing_id: str) -> STRReviewDetailResponse:
    """Get detailed STR listing with candidate dwellings."""
    from uuid import UUID
    db = SessionLocal()
    try:
        # Get listing with parcel and review status
        listing_uuid = UUID(listing_id)
        result = db.query(STRListing, Parcel, STRReviewStatus).outerjoin(
            Parcel, STRListing.parcel_id == Parcel.id
        ).outerjoin(
            STRReviewStatus, STRListing.id == STRReviewStatus.str_listing_id
        ).filter(STRListing.id == listing_uuid).first()

        if not result:
            raise HTTPException(status_code=404, detail="STR listing not found")

        listing, parcel, review_status = result

        # Get candidate dwellings on parcel using raw SQL to avoid ORM schema mismatch
        candidates = []
        if parcel:
            dwelling_query = text("""
                SELECT
                    d.id, d.unit_number, d.use_type, d.bedrooms,
                    d.tax_classification, d.homestead_filed, d.str_listing_id,
                    s.id as existing_str_id, s.name as existing_str_name
                FROM dwellings d
                LEFT JOIN str_listings s ON d.str_listing_id = s.id
                WHERE d.parcel_id = :parcel_id
            """)
            dwelling_rows = db.execute(dwelling_query, {"parcel_id": parcel.id}).fetchall()

            for row in dwelling_rows:
                # Compute match score manually
                score = 0.0
                if listing.bedrooms and row.bedrooms:
                    if listing.bedrooms == row.bedrooms:
                        score += 0.4
                    elif abs(listing.bedrooms - row.bedrooms) == 1:
                        score += 0.2
                if not row.homestead_filed:
                    score += 0.2
                if row.use_type:
                    use_lower = row.use_type.lower()
                    if "rental" in use_lower or "str" in use_lower:
                        score += 0.3
                    elif "vacation" in use_lower or "seasonal" in use_lower:
                        score += 0.2
                if row.str_listing_id:
                    score -= 0.2
                score = max(0.0, min(1.0, score))

                candidates.append(CandidateDwelling(
                    id=str(row.id),
                    unit_number=row.unit_number,
                    use_type=row.use_type,
                    bedrooms=row.bedrooms,
                    tax_classification=row.tax_classification,
                    homestead_filed=row.homestead_filed or False,
                    existing_str_id=str(row.existing_str_id) if row.existing_str_id else None,
                    existing_str_name=row.existing_str_name,
                    match_score=score,
                ))

            # Sort by match score descending
            candidates.sort(key=lambda c: c.match_score, reverse=True)

        # Get parcel GeoJSON
        parcel_geojson = None
        if parcel and parcel.geometry:
            # Fetch GeoJSON from geometry column
            geojson_result = db.execute(text(
                "SELECT ST_AsGeoJSON(geometry) FROM parcels WHERE id = :id"
            ), {"id": parcel.id}).scalar()
            if geojson_result:
                import json
                parcel_geojson = json.loads(geojson_result)

        candidate_count = len(candidates)

        queue_item = STRReviewQueueItem(
            id=str(listing.id),
            platform=listing.platform,
            listing_id=listing.listing_id,
            name=listing.name,
            listing_url=listing.listing_url,
            lat=float(listing.lat) if listing.lat else None,
            lng=float(listing.lng) if listing.lng else None,
            bedrooms=listing.bedrooms,
            max_guests=listing.max_guests,
            price_per_night_usd=listing.price_per_night_usd,
            total_reviews=listing.total_reviews,
            average_rating=float(listing.average_rating) if listing.average_rating else None,
            parcel_id=str(parcel.id) if parcel else None,
            parcel_span=parcel.span if parcel else None,
            parcel_address=parcel.address if parcel else None,
            match_method=listing.match_method,
            match_confidence=float(listing.match_confidence) if listing.match_confidence else None,
            review_status=review_status.status if review_status else "unreviewed",
            dwelling_id=str(review_status.dwelling_id) if review_status and review_status.dwelling_id else None,
            candidate_dwelling_count=candidate_count,
            reviewed_by=review_status.reviewed_by if review_status else None,
            reviewed_at=review_status.reviewed_at.isoformat() if review_status and review_status.reviewed_at else None,
        )

        return STRReviewDetailResponse(
            listing=queue_item,
            candidates=candidates,
            parcel_geojson=parcel_geojson,
        )
    finally:
        db.close()


@app.put("/api/admin/str-review/{listing_id}/link", dependencies=[Depends(verify_admin)])
async def update_str_review(
    listing_id: str,
    action: STRReviewAction,
) -> STRReviewActionResponse:
    """Confirm, reject, or skip an STR-dwelling link."""
    from uuid import UUID
    db = SessionLocal()
    try:
        listing_uuid = UUID(listing_id)

        # Get or create review status
        review_status = db.query(STRReviewStatus).filter(
            STRReviewStatus.str_listing_id == listing_uuid
        ).first()

        if not review_status:
            # Verify listing exists
            listing = db.query(STRListing).filter(STRListing.id == listing_uuid).first()
            if not listing:
                raise HTTPException(status_code=404, detail="STR listing not found")

            review_status = STRReviewStatus(
                str_listing_id=listing_uuid,
                status="unreviewed",
            )
            db.add(review_status)

        # Process action
        if action.action == "confirm":
            dwelling_uuid = UUID(action.dwelling_id)

            # Verify dwelling exists
            dwelling = db.query(Dwelling).filter(Dwelling.id == dwelling_uuid).first()
            if not dwelling:
                raise HTTPException(status_code=404, detail="Dwelling not found")

            # Update review status
            review_status.status = "confirmed"
            review_status.dwelling_id = dwelling_uuid
            review_status.rejection_reason = None
            review_status.notes = action.notes
            review_status.reviewed_by = "admin"  # TODO: get from auth
            review_status.reviewed_at = datetime.utcnow()

            # Set the canonical link on the dwelling
            dwelling.str_listing_id = listing_uuid

            message = f"Linked STR to dwelling {action.dwelling_id}"

        elif action.action == "reject":
            review_status.status = "rejected"
            review_status.dwelling_id = None
            review_status.rejection_reason = action.rejection_reason
            review_status.notes = action.notes
            review_status.reviewed_by = "admin"
            review_status.reviewed_at = datetime.utcnow()

            message = f"Rejected: {action.rejection_reason}"

        elif action.action == "skip":
            review_status.status = "skipped"
            review_status.notes = action.notes
            review_status.reviewed_by = "admin"
            review_status.reviewed_at = datetime.utcnow()

            message = "Skipped for later review"

        db.commit()

        return STRReviewActionResponse(
            success=True,
            listing_id=listing_id,
            action=action.action,
            dwelling_id=action.dwelling_id,
            message=message,
        )
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()

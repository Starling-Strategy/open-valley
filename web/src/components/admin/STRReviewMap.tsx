"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { STRQueueItem, STRDetailResponse } from "@/app/admin/str-review/page";

interface STRReviewMapProps {
  listings: STRQueueItem[];
  selectedListing: STRDetailResponse | null;
  onSelectListing: (listing: STRQueueItem) => void;
}

export default function STRReviewMap({
  listings,
  selectedListing,
  onSelectListing,
}: STRReviewMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const map = useRef<any>(null);
  const [isClient, setIsClient] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Store listings in ref for access in event handlers
  const listingsRef = useRef<STRQueueItem[]>(listings);
  useEffect(() => {
    listingsRef.current = listings;
  }, [listings]);

  // Initialize map
  useEffect(() => {
    setIsClient(true);
  }, []);

  const updateMapData = useCallback(async () => {
    if (!map.current) return;

    const maplibregl = await import("maplibre-gl");

    // Convert listings to GeoJSON
    const geojson: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: listings.map((listing) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [listing.lng, listing.lat],
        },
        properties: {
          id: listing.id,
          name: listing.name,
          platform: listing.platform,
          bedrooms: listing.bedrooms,
          review_status: listing.review_status,
          parcel_address: listing.parcel_address,
          candidate_dwelling_count: listing.candidate_dwelling_count,
        },
      })),
    };

    // Update or create source
    const source = map.current.getSource("str-listings");
    if (source) {
      source.setData(geojson);
    } else {
      // Add source
      map.current.addSource("str-listings", {
        type: "geojson",
        data: geojson,
      });

      // Add circle layer for STR pins
      map.current.addLayer({
        id: "str-listings-circles",
        type: "circle",
        source: "str-listings",
        paint: {
          "circle-radius": [
            "case",
            ["==", ["get", "review_status"], "confirmed"],
            8,
            ["==", ["get", "review_status"], "rejected"],
            6,
            ["==", ["get", "review_status"], "skipped"],
            6,
            10, // unreviewed - larger
          ],
          "circle-color": [
            "case",
            ["==", ["get", "review_status"], "confirmed"],
            "#22c55e", // green
            ["==", ["get", "review_status"], "rejected"],
            "#ef4444", // red
            ["==", ["get", "review_status"], "skipped"],
            "#eab308", // yellow
            "#94a3b8", // gray - unreviewed
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#0f172a",
          "circle-opacity": 0.9,
        },
      });

      // Add click handler
      map.current.on("click", "str-listings-circles", (e: { features?: Array<{ properties?: Record<string, unknown> }> }) => {
        if (!e.features?.length) return;
        const props = e.features[0].properties;
        if (!props?.id) return;

        const listing = listingsRef.current.find((l) => l.id === props.id);
        if (listing) {
          onSelectListing(listing);
        }
      });

      // Change cursor on hover
      map.current.on("mouseenter", "str-listings-circles", () => {
        map.current.getCanvas().style.cursor = "pointer";
      });
      map.current.on("mouseleave", "str-listings-circles", () => {
        map.current.getCanvas().style.cursor = "";
      });

      // Hover popup
      const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
      });

      map.current.on("mouseenter", "str-listings-circles", (e: { features?: Array<{ properties?: Record<string, unknown>; geometry?: { coordinates: [number, number] } }> }) => {
        if (!e.features?.length) return;
        const props = e.features[0].properties;
        const geometry = e.features[0].geometry;
        if (!props || !geometry) return;

        const coords = geometry.coordinates.slice() as [number, number];
        const name = props.name || "Unnamed STR";
        const platform = props.platform || "unknown";
        const bedrooms = props.bedrooms ? `${props.bedrooms} BR` : "";
        const status = props.review_status;

        popup
          .setLngLat(coords)
          .setHTML(
            `<div style="font-family: system-ui; font-size: 12px; max-width: 200px;">
              <strong>${name}</strong><br/>
              <span style="color: #666;">${platform} ${bedrooms}</span><br/>
              <span style="color: ${
                status === "confirmed"
                  ? "#22c55e"
                  : status === "rejected"
                  ? "#ef4444"
                  : status === "skipped"
                  ? "#eab308"
                  : "#94a3b8"
              }; text-transform: uppercase; font-size: 10px; font-weight: 600;">
                ${status}
              </span>
            </div>`
          )
          .addTo(map.current);
      });

      map.current.on("mouseleave", "str-listings-circles", () => {
        popup.remove();
      });
    }
  }, [listings, onSelectListing]);

  // Update parcel polygon when selection changes
  const updateParcelPolygon = useCallback(async () => {
    if (!map.current) return;

    const maplibregl = await import("maplibre-gl");

    // Remove existing parcel layer if any
    if (map.current.getLayer("selected-parcel-fill")) {
      map.current.removeLayer("selected-parcel-fill");
    }
    if (map.current.getLayer("selected-parcel-outline")) {
      map.current.removeLayer("selected-parcel-outline");
    }
    if (map.current.getSource("selected-parcel")) {
      map.current.removeSource("selected-parcel");
    }

    // Remove existing selected marker
    const existingMarker = document.getElementById("selected-str-marker");
    if (existingMarker) {
      existingMarker.remove();
    }

    if (!selectedListing) return;

    // Add selected STR marker
    const markerEl = document.createElement("div");
    markerEl.id = "selected-str-marker";
    markerEl.className = "selected-str-marker";
    markerEl.style.cssText = `
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: #3b82f6;
      border: 3px solid #1e3a8a;
      box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.4);
      animation: pulse 2s infinite;
    `;

    new maplibregl.Marker({ element: markerEl })
      .setLngLat([selectedListing.listing.lng, selectedListing.listing.lat])
      .addTo(map.current);

    // Add parcel polygon if available
    if (selectedListing.parcel_geojson) {
      map.current.addSource("selected-parcel", {
        type: "geojson",
        data: selectedListing.parcel_geojson,
      });

      map.current.addLayer({
        id: "selected-parcel-fill",
        type: "fill",
        source: "selected-parcel",
        paint: {
          "fill-color": "#3b82f6",
          "fill-opacity": 0.2,
        },
      });

      map.current.addLayer({
        id: "selected-parcel-outline",
        type: "line",
        source: "selected-parcel",
        paint: {
          "line-color": "#3b82f6",
          "line-width": 3,
        },
      });

      // Fly to selected listing
      map.current.flyTo({
        center: [selectedListing.listing.lng, selectedListing.listing.lat],
        zoom: 17,
        duration: 1000,
      });
    } else {
      // Just fly to the point
      map.current.flyTo({
        center: [selectedListing.listing.lng, selectedListing.listing.lat],
        zoom: 16,
        duration: 1000,
      });
    }
  }, [selectedListing]);

  useEffect(() => {
    if (!isClient || !mapContainer.current || map.current) return;

    const initMap = async () => {
      try {
        const maplibregl = await import("maplibre-gl");
        await import("maplibre-gl/dist/maplibre-gl.css");

        const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;

        if (!MAPTILER_KEY) {
          setError("MapTiler API key not configured");
          setIsLoading(false);
          return;
        }

        map.current = new maplibregl.Map({
          container: mapContainer.current!,
          style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`,
          center: [-72.85, 44.12], // Warren, VT
          zoom: 13,
        });

        map.current.on("load", async () => {
          // Add terrain for context
          map.current.addSource("terrain", {
            type: "raster-dem",
            url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${MAPTILER_KEY}`,
            tileSize: 256,
          });

          // Enable subtle terrain
          map.current.setTerrain({
            source: "terrain",
            exaggeration: 0.5,
          });

          setIsLoading(false);

          // Add listings data
          updateMapData();
        });

        // Add navigation controls
        map.current.addControl(
          new maplibregl.NavigationControl({ visualizePitch: true }),
          "top-right"
        );
      } catch (err) {
        console.error("Map initialization error:", err);
        setError("Failed to initialize map");
        setIsLoading(false);
      }
    };

    initMap();

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, [isClient, updateMapData]);

  // Update map data when listings change
  useEffect(() => {
    if (map.current && !isLoading) {
      updateMapData();
    }
  }, [listings, isLoading, updateMapData]);

  // Update parcel polygon when selection changes
  useEffect(() => {
    if (map.current && !isLoading) {
      updateParcelPolygon();
    }
  }, [selectedListing, isLoading, updateParcelPolygon]);

  if (!isClient) {
    return (
      <div className="h-full bg-slate-800 flex items-center justify-center">
        <span className="text-slate-400">Loading map...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full bg-slate-800 flex items-center justify-center">
        <span className="text-red-400">{error}</span>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <div ref={mapContainer} className="h-full w-full" />

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-slate-900/80 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-400 mx-auto mb-3"></div>
            <span className="text-slate-300">Loading map...</span>
          </div>
        </div>
      )}

      {/* Legend - bottom left */}
      <div className="absolute bottom-4 left-4 bg-slate-900/90 backdrop-blur-sm px-4 py-3 rounded-lg text-white">
        <div className="text-xs text-slate-400 mb-2 uppercase tracking-wider">
          Review Status
        </div>
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-slate-400" />
            <span>Unreviewed</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-emerald-500" />
            <span>Confirmed</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-red-500" />
            <span>Rejected</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-yellow-500" />
            <span>Skipped</span>
          </div>
        </div>
      </div>

      {/* Listing count - top left */}
      <div className="absolute top-4 left-4 bg-slate-900/90 backdrop-blur-sm px-3 py-2 rounded-lg">
        <span className="text-white font-medium">{listings.length}</span>
        <span className="text-slate-400 ml-1 text-sm">listings shown</span>
      </div>

      {/* Pulse animation style */}
      <style jsx global>{`
        @keyframes pulse {
          0%,
          100% {
            box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.4);
          }
          50% {
            box-shadow: 0 0 0 8px rgba(59, 130, 246, 0.2);
          }
        }
      `}</style>
    </div>
  );
}

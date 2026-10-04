"use client";

import { useEffect, useRef, useState } from "react";

interface WarrenMapProps {
  homesteadCount: number;
  secondHomeCount: number;
  strCount: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GeoJSONFeatureCollection = any;

export default function WarrenMap({
  homesteadCount,
  secondHomeCount,
  strCount,
}: WarrenMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  const parcelsDataRef = useRef<GeoJSONFeatureCollection>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDwellings, setShowDwellings] = useState(true);
  const initialized = useRef(false);

  const toggleDwellings = () => {
    const map = mapRef.current;
    if (!map) return;

    const newVisibility = !showDwellings;
    const visibility = newVisibility ? "visible" : "none";

    ["clusters", "cluster-count", "dwelling-point"].forEach((layerId) => {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", visibility);
      }
    });

    setShowDwellings(newVisibility);
  };

  useEffect(() => {
    // Prevent double initialization in React strict mode
    if (initialized.current) return;
    if (!mapContainer.current) return;
    initialized.current = true;

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

        const map = new maplibregl.Map({
          container: mapContainer.current!,
          style: `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${MAPTILER_KEY}`,
          center: [-72.85, 44.12],
          zoom: 12.5,
          pitch: 50,
          bearing: -20,
          maxPitch: 85,
        });

        mapRef.current = map;

        const handleMapLoad = async () => {
          console.log("Map loaded!");

          // Add 3D terrain
          map.addSource("terrain", {
            type: "raster-dem",
            url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${MAPTILER_KEY}`,
            tileSize: 256,
          });
          map.setTerrain({ source: "terrain", exaggeration: 1.5 });

          const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8999";
          console.log("API URL:", apiUrl);

          // Load parcels
          try {
            const parcelsRes = await fetch(`${apiUrl}/api/parcels/geojson`);
            if (parcelsRes.ok) {
              const parcelsData = await parcelsRes.json();
              console.log("Loaded parcels:", parcelsData.features?.length);

              // Store for later lookup in popups
              parcelsDataRef.current = parcelsData;

              map.addSource("parcels", { type: "geojson", data: parcelsData });
              map.addLayer({
                id: "parcels-fill",
                type: "fill",
                source: "parcels",
                paint: {
                  "fill-color": [
                    "case",
                    ["==", ["get", "classification"], "homestead"],
                    "#34d399", // emerald-400 - bright green for homesteads
                    ["==", ["get", "classification"], "nhs_residential"],
                    "#fbbf24", // amber-400 - bright orange for non-homestead residential
                    "#94a3b8", // slate-400 - grey for other parcels
                  ],
                  "fill-opacity": 0.3,
                },
              });
              map.addLayer({
                id: "parcels-outline",
                type: "line",
                source: "parcels",
                paint: { "line-color": "#1e293b", "line-width": 0.5 },
              });
            }
          } catch (err) {
            console.error("Failed to load parcels:", err);
          }

          // Load dwellings
          try {
            const dwellingsRes = await fetch(`${apiUrl}/api/dwellings/geojson`);
            if (dwellingsRes.ok) {
              const dwellingsData = await dwellingsRes.json();
              console.log("Loaded dwellings:", dwellingsData.features?.length);

              map.addSource("dwellings", {
                type: "geojson",
                data: dwellingsData,
                cluster: true,
                clusterMaxZoom: 14,
                clusterRadius: 50,
              });

              // Cluster circles
              map.addLayer({
                id: "clusters",
                type: "circle",
                source: "dwellings",
                filter: ["has", "point_count"],
                paint: {
                  "circle-color": "#a855f7",
                  "circle-radius": ["step", ["get", "point_count"], 18, 50, 24, 200, 32],
                  "circle-stroke-width": 3,
                  "circle-stroke-color": "#fff",
                },
              });

              // Cluster labels
              map.addLayer({
                id: "cluster-count",
                type: "symbol",
                source: "dwellings",
                filter: ["has", "point_count"],
                layout: {
                  "text-field": "{point_count_abbreviated}",
                  "text-size": 13,
                },
                paint: { "text-color": "#fff" },
              });

              // Individual dwelling points
              map.addLayer({
                id: "dwelling-point",
                type: "circle",
                source: "dwellings",
                filter: ["!", ["has", "point_count"]],
                paint: {
                  "circle-color": "#a855f7",
                  "circle-radius": 7,
                  "circle-stroke-width": 2,
                  "circle-stroke-color": "#fff",
                },
              });

              // --- DWELLING HOVER TOOLTIP ---
              map.on("mouseenter", "dwelling-point", (e: { features?: Array<{ properties?: Record<string, unknown> }>; point?: { x: number; y: number } }) => {
                map.getCanvas().style.cursor = "pointer";
                if (!e.features?.length || !tooltipRef.current) return;

                const props = e.features[0].properties || {};
                const address = props.address || "Unknown address";
                const status = props.tax_classification === "HOMESTEAD" ? "Homestead" : "Non-Homestead";
                const bedrooms = props.bedrooms ? `${props.bedrooms} BR` : "";
                const unit = props.unit_number ? ` (${props.unit_number})` : "";

                tooltipRef.current.innerHTML = `
                  <div class="font-semibold">${address}${unit}</div>
                  <div class="text-slate-300">${status}${bedrooms ? ` · ${bedrooms}` : ""}</div>
                `;
                tooltipRef.current.style.display = "block";
                tooltipRef.current.style.left = `${(e.point?.x || 0) + 10}px`;
                tooltipRef.current.style.top = `${(e.point?.y || 0) + 10}px`;
              });

              map.on("mouseleave", "dwelling-point", () => {
                map.getCanvas().style.cursor = "";
                if (tooltipRef.current) {
                  tooltipRef.current.style.display = "none";
                }
              });

              // --- DWELLING CLICK POPUP ---
              map.on("click", "dwelling-point", (e: { features?: Array<{ properties?: Record<string, unknown> }>; lngLat?: { lng: number; lat: number } }) => {
                if (!e.features?.length || !e.lngLat) return;

                const props = e.features[0].properties || {};
                const span = props.span as string;

                // Look up parcel data by SPAN
                let ownerName = "Unknown";
                let assessedValue = "N/A";
                let acres = "N/A";

                if (parcelsDataRef.current?.features) {
                  const parcel = parcelsDataRef.current.features.find(
                    (f: { properties?: { SPAN?: string } }) => f.properties?.SPAN === span
                  );
                  if (parcel?.properties) {
                    ownerName = parcel.properties.OWNER1 || "Unknown";
                    assessedValue = parcel.properties.REAL_FLV
                      ? `$${Number(parcel.properties.REAL_FLV).toLocaleString()}`
                      : "N/A";
                    acres = parcel.properties.ACRESGL
                      ? `${Number(parcel.properties.ACRESGL).toFixed(2)} ac`
                      : "N/A";
                  }
                }

                const address = props.address || "Unknown address";
                const unit = props.unit_number ? ` (${props.unit_number})` : "";
                const status = props.tax_classification === "HOMESTEAD"
                  ? '<span style="color:#34d399">Homestead</span>'
                  : '<span style="color:#fbbf24">Non-Homestead</span>';
                const bedrooms = props.bedrooms ? `${props.bedrooms}` : "N/A";

                new maplibregl.Popup({ closeButton: true, maxWidth: "280px" })
                  .setLngLat(e.lngLat)
                  .setHTML(`
                    <div style="font-family:system-ui;font-size:13px;line-height:1.5;color:#1e293b">
                      <div style="font-weight:600;font-size:14px;margin-bottom:8px;color:#0f172a">${address}${unit}</div>
                      <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin-bottom:8px">
                        <span style="color:#64748b;font-weight:500">Status</span><span>${status}</span>
                        <span style="color:#64748b;font-weight:500">Bedrooms</span><span>${bedrooms}</span>
                      </div>
                      <div style="border-top:1px solid #e2e8f0;padding-top:8px;display:grid;grid-template-columns:auto 1fr;gap:4px 12px">
                        <span style="color:#64748b;font-weight:500">Owner</span><span>${ownerName}</span>
                        <span style="color:#64748b;font-weight:500">Value</span><span>${assessedValue}</span>
                        <span style="color:#64748b;font-weight:500">Acres</span><span>${acres}</span>
                        <span style="color:#64748b;font-weight:500">SPAN</span><span style="font-size:11px;color:#475569">${span || "N/A"}</span>
                      </div>
                    </div>
                  `)
                  .addTo(map);
              });

              // --- CLUSTER HOVER ---
              map.on("mouseenter", "clusters", (e: { features?: Array<{ properties?: Record<string, unknown> }>; point?: { x: number; y: number } }) => {
                map.getCanvas().style.cursor = "pointer";
                if (!e.features?.length || !tooltipRef.current) return;

                const count = e.features[0].properties?.point_count || 0;
                tooltipRef.current.innerHTML = `
                  <div class="font-semibold">${count} Dwellings</div>
                  <div class="text-slate-400 text-xs">Click to zoom in</div>
                `;
                tooltipRef.current.style.display = "block";
                tooltipRef.current.style.left = `${(e.point?.x || 0) + 10}px`;
                tooltipRef.current.style.top = `${(e.point?.y || 0) + 10}px`;
              });

              map.on("mouseleave", "clusters", () => {
                map.getCanvas().style.cursor = "";
                if (tooltipRef.current) {
                  tooltipRef.current.style.display = "none";
                }
              });

              // --- CLUSTER CLICK TO ZOOM ---
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              map.on("click", "clusters", (e: any) => {
                if (!e.features?.length) return;
                const clusterId = e.features[0].properties?.cluster_id;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const source = map.getSource("dwellings") as any;
                if (source && typeof source.getClusterExpansionZoom === "function") {
                  source.getClusterExpansionZoom(clusterId, (err: Error | null, zoom: number) => {
                    if (err) return;
                    map.easeTo({
                      center: e.features![0].geometry!.coordinates,
                      zoom,
                    });
                  });
                }
              });
            }
          } catch (err) {
            console.error("Failed to load dwellings:", err);
          }

          console.log("Setting isLoading to false");
          setIsLoading(false);
        };

        // Handle load event - add data layers once style is ready
        map.once("load", handleMapLoad);

        // Hide loading overlay when map becomes idle (all tiles loaded)
        map.once("idle", () => {
          setIsLoading(false);
        });

        map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
        map.addControl(new maplibregl.FullscreenControl(), "top-right");

      } catch (err) {
        console.error("Map initialization error:", err);
        setError("Failed to initialize map");
        setIsLoading(false);
      }
    };

    initMap();

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      initialized.current = false;
    };
  }, []);

  if (error) {
    return (
      <div className="relative h-[600px] rounded-2xl bg-slate-800 flex items-center justify-center">
        <span className="text-red-400">{error}</span>
      </div>
    );
  }

  return (
    <div className="relative h-[600px] rounded-2xl overflow-hidden">
      <div ref={mapContainer} className="h-full w-full" />

      {/* Hover tooltip */}
      <div
        ref={tooltipRef}
        className="absolute bg-slate-900/95 text-white px-3 py-2 rounded-lg text-sm pointer-events-none z-10 shadow-lg backdrop-blur-sm"
        style={{ display: "none" }}
      />

      {isLoading && (
        <div className="absolute inset-0 bg-slate-900/80 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-400 mx-auto mb-3" />
            <span className="text-slate-300">Loading map...</span>
          </div>
        </div>
      )}

      <div className="absolute top-4 left-4 bg-slate-900/90 backdrop-blur-sm px-5 py-4 rounded-xl text-white">
        <p className="text-green-400 font-medium uppercase tracking-wider text-xs">Warren, Vermont</p>
      </div>

      <div className="absolute bottom-4 left-4 bg-slate-900/90 backdrop-blur-sm px-4 py-3 rounded-lg text-white">
        <p className="text-xs text-slate-400 mb-2">Legend</p>
        <div className="flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showDwellings}
              onChange={toggleDwellings}
              className="sr-only"
            />
            <span className={`w-4 h-4 rounded-full border-2 border-white flex items-center justify-center ${showDwellings ? 'bg-purple-500' : 'bg-slate-600'}`}>
              {showDwellings && (
                <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </span>
            <span>Dwellings</span>
          </label>
          <div className="flex items-center gap-2">
            <span className="w-4 h-4 rounded bg-emerald-400/60 border border-slate-700" />
            <span>Homestead</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-4 h-4 rounded bg-amber-400/60 border border-slate-700" />
            <span>Non-Homestead Residential</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-4 h-4 rounded bg-slate-400/60 border border-slate-700" />
            <span>Other</span>
          </div>
        </div>
      </div>

    </div>
  );
}

"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface TransitionFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: {
    span: string;
    date: string;
    year: number;
    sale_price: number;
    seller_state: string | null;
    buyer_state: string | null;
    use_desc: string | null;
    transition_type: "TRUE_GAIN" | "TRUE_LOSS" | "STAYED_HOMESTEAD" | "STAYED_NON_HOMESTEAD" | "OTHER";
  };
}

interface TransitionsData {
  type: "FeatureCollection";
  features: TransitionFeature[];
  metadata: {
    total_features: number;
    true_gains: number;
    true_losses: number;
    stayed_homestead: number;
    stayed_non_homestead: number;
    other: number;
    net_change: number;
    yearly_stats: Record<number, {
      true_losses: number;
      true_gains: number;
      stayed_homestead: number;
      stayed_non_homestead: number;
      net: number;
    }>;
  };
}

interface YearSummary {
  year: number;
  trueGains: number;
  trueLosses: number;
  stayedHomestead: number;
  stayedNonHomestead: number;
  net: number;
  runningTotal: number;
}

// Line chart component for homestead rate over time
function HomesteadRateChart({ yearSummaries }: { yearSummaries: YearSummary[] }) {
  // Warren has 1,823 parcels, current rate is 16.4% (≈299 homesteads)
  // Working backwards: 299 + 109 net loss = 408 homesteads in early 2019
  const TOTAL_PARCELS = 1823;
  const CURRENT_HOMESTEADS = 299; // 16.4% of 1823
  const TOTAL_NET_LOSS = -109;
  const START_HOMESTEADS = CURRENT_HOMESTEADS - TOTAL_NET_LOSS; // 408

  // Calculate homestead count and rate for each year end
  const dataPoints = yearSummaries.map((summary, index) => {
    // Calculate cumulative net change up to and including this year
    const cumulativeNet = yearSummaries
      .slice(0, index + 1)
      .reduce((acc, s) => acc + s.net, 0);
    const homesteads = START_HOMESTEADS + cumulativeNet;
    const rate = (homesteads / TOTAL_PARCELS) * 100;
    return { year: summary.year, homesteads, rate };
  });

  // Add starting point (beginning of 2019)
  const allPoints = [
    { year: 2018.5, homesteads: START_HOMESTEADS, rate: (START_HOMESTEADS / TOTAL_PARCELS) * 100 },
    ...dataPoints
  ];

  // Chart dimensions
  const width = 400;
  const height = 200;
  const padding = { top: 20, right: 40, bottom: 40, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Scales
  const minYear = 2018.5;
  const maxYear = 2025;
  const minRate = Math.floor(Math.min(...allPoints.map(p => p.rate)) - 1);
  const maxRate = Math.ceil(Math.max(...allPoints.map(p => p.rate)) + 1);

  const xScale = (year: number) => padding.left + ((year - minYear) / (maxYear - minYear)) * chartWidth;
  const yScale = (rate: number) => padding.top + ((maxRate - rate) / (maxRate - minRate)) * chartHeight;

  // Generate path
  const pathD = allPoints
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.year)} ${yScale(p.rate)}`)
    .join(' ');

  // Generate area path (for gradient fill)
  const areaD = `${pathD} L ${xScale(allPoints[allPoints.length - 1].year)} ${yScale(minRate)} L ${xScale(allPoints[0].year)} ${yScale(minRate)} Z`;

  return (
    <div className="bg-slate-700/50 rounded-xl p-4">
      <div className="text-sm text-slate-400 mb-2 text-center">Homestead Rate Over Time</div>
      <svg width={width} height={height} className="mx-auto">
        <defs>
          <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ef4444" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#ef4444" stopOpacity="0.05" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {[minRate, minRate + (maxRate - minRate) / 2, maxRate].map(rate => (
          <g key={rate}>
            <line
              x1={padding.left}
              y1={yScale(rate)}
              x2={width - padding.right}
              y2={yScale(rate)}
              stroke="#475569"
              strokeDasharray="4,4"
            />
            <text
              x={padding.left - 8}
              y={yScale(rate)}
              textAnchor="end"
              dominantBaseline="middle"
              fill="#94a3b8"
              fontSize="11"
            >
              {rate.toFixed(0)}%
            </text>
          </g>
        ))}

        {/* Year labels */}
        {[2019, 2021, 2023, 2025].map(year => (
          <text
            key={year}
            x={xScale(year)}
            y={height - padding.bottom + 20}
            textAnchor="middle"
            fill="#94a3b8"
            fontSize="11"
          >
            {year}
          </text>
        ))}

        {/* Area fill */}
        <path d={areaD} fill="url(#areaGradient)" />

        {/* Line */}
        <path
          d={pathD}
          fill="none"
          stroke="#ef4444"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Data points */}
        {allPoints.map((p, i) => (
          <g key={i}>
            <circle
              cx={xScale(p.year)}
              cy={yScale(p.rate)}
              r={i === 0 ? 4 : 6}
              fill={i === 0 ? "#94a3b8" : "#ef4444"}
              stroke="#1e293b"
              strokeWidth="2"
            />
            {/* Rate label on last point */}
            {i === allPoints.length - 1 && (
              <text
                x={xScale(p.year) + 8}
                y={yScale(p.rate)}
                dominantBaseline="middle"
                fill="#ef4444"
                fontSize="12"
                fontWeight="bold"
              >
                {p.rate.toFixed(1)}%
              </text>
            )}
            {/* Rate label on first point */}
            {i === 0 && (
              <text
                x={xScale(p.year) - 8}
                y={yScale(p.rate)}
                textAnchor="end"
                dominantBaseline="middle"
                fill="#94a3b8"
                fontSize="12"
              >
                {p.rate.toFixed(1)}%
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="text-xs text-slate-500 text-center mt-2">
        Percentage of Warren's {TOTAL_PARCELS.toLocaleString()} parcels with homestead filings
      </div>
    </div>
  );
}

export default function AnimatedTransitionsMap() {
  const mapContainer = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const map = useRef<any>(null);

  const [isClient, setIsClient] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transitionsData, setTransitionsData] = useState<TransitionsData | null>(null);

  // Animation state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentYear, setCurrentYear] = useState<number | null>(null);
  const [yearSummaries, setYearSummaries] = useState<YearSummary[]>([]);
  const [showFinalSummary, setShowFinalSummary] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  const [animationPhase, setAnimationPhase] = useState<"idle" | "bursting" | "summary" | "complete">("idle");

  // Counters
  const [displayedGains, setDisplayedGains] = useState(0);
  const [displayedLosses, setDisplayedLosses] = useState(0);
  const [runningNet, setRunningNet] = useState(0);

  useEffect(() => {
    setIsClient(true);
  }, []);

  // Fetch transitions data
  useEffect(() => {
    if (!isClient) return;

    const fetchData = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8999";
        const response = await fetch(`${apiUrl}/api/transfers/transitions`);
        if (!response.ok) throw new Error("Failed to fetch transitions");
        const data = await response.json();
        setTransitionsData(data);
      } catch (err) {
        console.error("Failed to load transitions:", err);
        setError("Failed to load transition data");
      }
    };

    fetchData();
  }, [isClient]);

  // Initialize map
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
          style: `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${MAPTILER_KEY}`,
          center: [-72.85, 44.12],
          zoom: 12,
          pitch: 45,
          bearing: -15,
        });

        map.current.on("load", async () => {
          // Add terrain
          map.current.addSource("terrain", {
            type: "raster-dem",
            url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${MAPTILER_KEY}`,
            tileSize: 256,
          });
          map.current.setTerrain({ source: "terrain", exaggeration: 1.3 });

          // Fetch and add base parcel layer (muted)
          try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8999";
            const response = await fetch(`${apiUrl}/api/parcels/geojson`);
            if (response.ok) {
              const geojson = await response.json();
              map.current.addSource("parcels", { type: "geojson", data: geojson });
              map.current.addLayer({
                id: "parcels-fill",
                type: "fill",
                source: "parcels",
                paint: {
                  "fill-color": "#475569",
                  "fill-opacity": 0.3,
                },
              });
              map.current.addLayer({
                id: "parcels-outline",
                type: "line",
                source: "parcels",
                paint: { "line-color": "#334155", "line-width": 0.5 },
              });
            }
          } catch (err) {
            console.error("Failed to load parcels:", err);
          }

          setIsLoading(false);
        });

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
  }, [isClient]);

  // Color palette for transition types
  const transitionColors = {
    TRUE_GAIN: "#22c55e",        // Bright green - re-homesteading!
    TRUE_LOSS: "#ef4444",        // Red - de-homesteading
    STAYED_HOMESTEAD: "#3b82f6", // Blue - stable homestead
    STAYED_NON_HOMESTEAD: "#94a3b8", // Gray - stable non-homestead
    OTHER: "#475569",            // Dark gray - unknown
  };

  // Create marker that appears and stays visible
  const createMarker = useCallback(async (
    coords: [number, number],
    type: "TRUE_GAIN" | "TRUE_LOSS" | "STAYED_HOMESTEAD" | "STAYED_NON_HOMESTEAD" | "OTHER"
  ) => {
    if (!map.current) return null;

    const maplibreModule = await import("maplibre-gl");
    const { Marker } = maplibreModule;
    const color = transitionColors[type];
    const isChange = type === "TRUE_GAIN" || type === "TRUE_LOSS";

    const el = document.createElement("div");
    el.className = "pulse-marker";
    const size = isChange ? 24 : 16;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.borderRadius = "50%";
    el.style.backgroundColor = color;
    el.style.boxShadow = `0 0 ${isChange ? "20px 8px" : "12px 4px"} ${color}`;
    el.style.border = "2px solid rgba(255,255,255,0.8)";
    el.style.opacity = "1";
    el.style.transform = "scale(1)";
    el.style.transition = "opacity 0.5s ease-out, transform 0.5s ease-out";

    const marker = new Marker({ element: el })
      .setLngLat(coords)
      .addTo(map.current);

    return { marker, element: el };
  }, []);

  // Fade out all markers
  const fadeOutMarkers = useCallback((markers: Array<{ marker: unknown; element: HTMLElement }>) => {
    markers.forEach(({ element }) => {
      element.style.opacity = "0";
      element.style.transform = "scale(0.5)";
    });
    // Remove after fade animation
    setTimeout(() => {
      markers.forEach(({ marker }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (marker as any).remove();
      });
    }, 600);
  }, []);

  // Play year animation
  const playYear = useCallback(async (year: number, features: TransitionFeature[], cumulativeNet: number): Promise<number> => {
    setAnimationPhase("bursting");
    setCurrentYear(year);

    // Filter and sort by date within the year
    const yearFeatures = features
      .filter(f => f.properties.year === year && f.properties.transition_type !== "OTHER")
      .sort((a, b) => new Date(a.properties.date).getTime() - new Date(b.properties.date).getTime());

    const trueGains = yearFeatures.filter(f => f.properties.transition_type === "TRUE_GAIN");
    const trueLosses = yearFeatures.filter(f => f.properties.transition_type === "TRUE_LOSS");
    const stayedHomestead = yearFeatures.filter(f => f.properties.transition_type === "STAYED_HOMESTEAD");
    const stayedNonHomestead = yearFeatures.filter(f => f.properties.transition_type === "STAYED_NON_HOMESTEAD");

    // Create markers one at a time, in chronological order
    const activeMarkers: Array<{ marker: unknown; element: HTMLElement }> = [];

    for (const feature of yearFeatures) {
      const markerData = await createMarker(
        feature.geometry.coordinates,
        feature.properties.transition_type
      );
      if (markerData) {
        activeMarkers.push(markerData);
      }
      // Small delay between each marker appearing
      await new Promise(resolve => setTimeout(resolve, 30));
    }

    // Pause to let viewers see all markers
    await new Promise(resolve => setTimeout(resolve, 1200));

    // Calculate new cumulative total (only TRUE changes affect net)
    const yearNet = trueGains.length - trueLosses.length;
    const newCumulativeNet = cumulativeNet + yearNet;

    // Update counters
    setDisplayedGains(prev => prev + trueGains.length);
    setDisplayedLosses(prev => prev + trueLosses.length);
    setRunningNet(newCumulativeNet);

    // Show year summary
    setAnimationPhase("summary");
    const newSummary: YearSummary = {
      year,
      trueGains: trueGains.length,
      trueLosses: trueLosses.length,
      stayedHomestead: stayedHomestead.length,
      stayedNonHomestead: stayedNonHomestead.length,
      net: yearNet,
      runningTotal: newCumulativeNet,
    };
    setYearSummaries(prev => [...prev, newSummary]);

    // Pause on summary with all markers visible
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Fade out all markers together
    fadeOutMarkers(activeMarkers);

    // Wait for fade to complete
    await new Promise(resolve => setTimeout(resolve, 700));

    return newCumulativeNet;
  }, [createMarker, fadeOutMarkers]);

  // Show intro card
  const showIntroCard = useCallback(() => {
    setShowIntro(true);
  }, []);

  // Main animation loop
  const startAnimation = useCallback(async () => {
    if (!transitionsData) return;

    setShowIntro(false);
    setIsPlaying(true);
    setShowFinalSummary(false);
    setYearSummaries([]);
    setDisplayedGains(0);
    setDisplayedLosses(0);
    setRunningNet(0);
    setAnimationPhase("idle");

    const years = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
    let cumulativeNet = 0;

    for (const year of years) {
      cumulativeNet = await playYear(year, transitionsData.features, cumulativeNet);
    }

    setAnimationPhase("complete");
    setShowFinalSummary(true);
    setIsPlaying(false);
  }, [transitionsData, playYear]);

  const resetAnimation = useCallback(() => {
    setIsPlaying(false);
    setCurrentYear(null);
    setYearSummaries([]);
    setDisplayedGains(0);
    setDisplayedLosses(0);
    setRunningNet(0);
    setShowFinalSummary(false);
    setShowIntro(false);
    setAnimationPhase("idle");
  }, []);

  if (!isClient) {
    return (
      <div className="relative h-[800px] rounded-2xl bg-slate-800 flex items-center justify-center">
        <span className="text-slate-400">Loading...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="relative h-[800px] rounded-2xl bg-slate-800 flex items-center justify-center">
        <span className="text-red-400">{error}</span>
      </div>
    );
  }

  return (
    <div className="relative h-[800px] rounded-2xl overflow-hidden bg-slate-900">
      <div ref={mapContainer} className="h-full w-full" />

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-slate-900/80 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-400 mx-auto mb-3"></div>
            <span className="text-slate-300">Loading map...</span>
          </div>
        </div>
      )}

      {/* Title and description */}
      <div className="absolute top-4 left-4 bg-slate-900/95 backdrop-blur-sm px-5 py-4 rounded-xl text-white max-w-sm">
        <h2 className="text-xl font-bold mb-1">De-Homesteading Warren</h2>
        <p className="text-slate-400 text-sm">
          Watch as homesteads become non-homesteads, year by year.
        </p>

        {/* Play controls */}
        <div className="mt-4 flex gap-2">
          {!isPlaying && animationPhase === "idle" && !showIntro && (
            <button
              onClick={showIntroCard}
              disabled={!transitionsData}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-500 disabled:bg-slate-600 px-4 py-2 rounded-lg font-medium transition-colors text-sm"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              Play Animation
            </button>
          )}
          {(isPlaying || animationPhase !== "idle" || showIntro) && (
            <button
              onClick={resetAnimation}
              className="flex items-center gap-2 bg-slate-600 hover:bg-slate-500 px-4 py-2 rounded-lg font-medium transition-colors text-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Current year indicator */}
      {currentYear && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-slate-900/95 backdrop-blur-sm px-8 py-4 rounded-xl text-white text-center">
          <div className="text-6xl font-bold tabular-nums">{currentYear}</div>
          {animationPhase === "bursting" && (
            <div className="text-slate-400 text-sm mt-1">Transactions in progress...</div>
          )}
        </div>
      )}

      {/* Running counters */}
      <div className="absolute top-4 right-4 bg-slate-900/95 backdrop-blur-sm px-5 py-4 rounded-xl text-white min-w-[220px]">
        <div className="text-xs text-slate-400 uppercase tracking-wider mb-3">Actual Status Changes</div>
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-green-500"></span>
              Became Homestead
            </span>
            <span className="text-green-400 font-bold tabular-nums">+{displayedGains}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500"></span>
              Lost Homestead
            </span>
            <span className="text-red-400 font-bold tabular-nums">-{displayedLosses}</span>
          </div>
          <div className="border-t border-slate-700 pt-2 flex justify-between items-center">
            <span className="font-medium">Net Change</span>
            <span className={`font-bold text-xl tabular-nums ${runningNet >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {runningNet >= 0 ? '+' : ''}{runningNet}
            </span>
          </div>
        </div>
      </div>

      {/* Year summary cards (bottom) */}
      {yearSummaries.length > 0 && (
        <div className="absolute bottom-4 left-4 right-56 flex gap-2 overflow-x-auto pb-2">
          {yearSummaries.map((summary) => (
            <div
              key={summary.year}
              className={`flex-shrink-0 bg-slate-900/95 backdrop-blur-sm px-4 py-3 rounded-lg text-white min-w-[140px] ${
                summary.net >= 0 ? 'border border-green-500/30' : 'border border-red-500/30'
              }`}
            >
              <div className="text-lg font-bold">{summary.year}</div>
              <div className="text-xs text-slate-400 space-y-0.5">
                <div className="flex justify-between">
                  <span>Became Homestead:</span>
                  <span className="text-green-400 font-medium">+{summary.trueGains}</span>
                </div>
                <div className="flex justify-between">
                  <span>Lost Homestead:</span>
                  <span className="text-red-400 font-medium">-{summary.trueLosses}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>Stayed Homestead:</span>
                  <span className="text-blue-400">{summary.stayedHomestead}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>Stayed Non-Homestead:</span>
                  <span className="text-slate-400">{summary.stayedNonHomestead}</span>
                </div>
              </div>
              <div className={`text-sm font-bold mt-2 pt-2 border-t border-slate-700 ${summary.net >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                Net: {summary.net >= 0 ? '+' : ''}{summary.net}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Intro card overlay */}
      {showIntro && (
        <div className="absolute inset-0 bg-slate-900/85 flex items-center justify-center z-20">
          <div className="bg-slate-800 rounded-2xl p-8 max-w-lg text-white shadow-2xl">
            <h3 className="text-2xl font-bold mb-2 text-center">What You're About to See</h3>
            <p className="text-slate-400 mb-6 text-center text-sm">
              This animation shows every property sale in Warren from 2019-2025, classified by how it changed the home's status.
            </p>

            <div className="space-y-4 mb-6">
              <div className="flex items-start gap-4 bg-slate-700/40 rounded-lg p-3">
                <span className="w-5 h-5 rounded-full bg-green-500 shadow-lg shadow-green-500/50 flex-shrink-0 mt-0.5"></span>
                <div>
                  <div className="font-semibold text-green-400">Became Homestead</div>
                  <div className="text-slate-400 text-sm">Out-of-state seller → Homestead buyer. A non-homestead became a homestead.</div>
                </div>
              </div>

              <div className="flex items-start gap-4 bg-slate-700/40 rounded-lg p-3">
                <span className="w-5 h-5 rounded-full bg-red-500 shadow-lg shadow-red-500/50 flex-shrink-0 mt-0.5"></span>
                <div>
                  <div className="font-semibold text-red-400">Lost Homestead</div>
                  <div className="text-slate-400 text-sm">Vermont seller → Non-homestead buyer. A homestead became a non-homestead.</div>
                </div>
              </div>

              <div className="flex items-start gap-4 bg-slate-700/30 rounded-lg p-3">
                <span className="w-4 h-4 rounded-full bg-blue-500 flex-shrink-0 mt-0.5"></span>
                <div>
                  <div className="font-medium text-blue-400">Stayed Homestead</div>
                  <div className="text-slate-500 text-sm">VT seller → Primary buyer. No net change.</div>
                </div>
              </div>

              <div className="flex items-start gap-4 bg-slate-700/30 rounded-lg p-3">
                <span className="w-4 h-4 rounded-full bg-slate-400 flex-shrink-0 mt-0.5"></span>
                <div>
                  <div className="font-medium text-slate-300">Stayed Non-Homestead</div>
                  <div className="text-slate-500 text-sm">Out-of-state seller → Non-primary buyer. No net change.</div>
                </div>
              </div>
            </div>

            <p className="text-slate-500 text-xs text-center mb-6">
              Transactions appear in chronological order within each year. Larger dots = status changes that affect Warren's homestead count.
            </p>

            <button
              onClick={startAnimation}
              className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 px-6 py-3 rounded-lg font-medium transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              Start Animation
            </button>
          </div>
        </div>
      )}

      {/* Final summary overlay */}
      {showFinalSummary && (
        <div className="absolute inset-0 bg-slate-900/90 flex items-center justify-center overflow-y-auto py-8">
          <div className="bg-slate-800 rounded-2xl p-8 max-w-xl text-center text-white">
            <h3 className="text-2xl font-bold mb-2">2019 — 2025</h3>
            <p className="text-slate-400 mb-6">Seven years of actual homestead status changes</p>

            <div className="grid grid-cols-2 gap-6 mb-6">
              <div className="bg-slate-700/50 rounded-xl p-4">
                <div className="text-4xl font-bold text-green-400">+{displayedGains}</div>
                <div className="text-slate-400 text-sm">Became Homestead</div>
                <div className="text-slate-500 text-xs mt-1">Non-homestead → Homestead</div>
              </div>
              <div className="bg-slate-700/50 rounded-xl p-4">
                <div className="text-4xl font-bold text-red-400">-{displayedLosses}</div>
                <div className="text-slate-400 text-sm">Lost Homestead</div>
                <div className="text-slate-500 text-xs mt-1">Homestead → Non-homestead</div>
              </div>
            </div>

            <div className="border-t border-slate-700 pt-6 mb-6">
              <div className={`text-5xl font-bold ${runningNet >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {runningNet >= 0 ? '+' : ''}{runningNet}
              </div>
              <div className="text-slate-300 mt-2">Net Change in Homesteads</div>
              <p className="text-slate-500 text-sm mt-4 max-w-sm mx-auto">
                {runningNet < 0
                  ? `Warren lost a net ${Math.abs(runningNet)} homesteads as owner-occupied homes were sold to non-homestead buyers faster than non-homesteads became homesteads.`
                  : `Warren gained ${runningNet} net homesteads.`
                }
              </p>
            </div>

            {/* Homestead rate line chart */}
            {yearSummaries.length > 0 && (
              <HomesteadRateChart yearSummaries={yearSummaries} />
            )}

            <button
              onClick={resetAnimation}
              className="mt-6 bg-slate-700 hover:bg-slate-600 px-6 py-2 rounded-lg font-medium transition-colors"
            >
              Watch Again
            </button>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-4 right-4 bg-slate-900/95 backdrop-blur-sm px-4 py-3 rounded-lg text-white text-xs">
        <div className="text-slate-400 uppercase tracking-wider mb-2 text-[10px]">Legend</div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="w-4 h-4 rounded-full bg-green-500 shadow-lg shadow-green-500/50"></span>
            <span>Became Homestead (non-homestead → homestead)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-4 h-4 rounded-full bg-red-500 shadow-lg shadow-red-500/50"></span>
            <span>Lost Homestead (homestead → non-homestead)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-blue-500"></span>
            <span className="text-slate-400">Stayed Homestead</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-slate-400"></span>
            <span className="text-slate-400">Stayed Non-Homestead</span>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  mapFeatureCollection,
  normalizePublicMap,
  findPublicParcels,
  parcelLabel,
  parcelSummaryLines,
  publicMapFeatureKey,
  type PublicParcel,
  type TaxStatusBucket,
} from "./mapProperties";

type Filter = "all" | TaxStatusBucket;
type MapStatus = "loading" | "ready" | "incomplete" | "malformed" | "unavailable";

const mapFilters: Record<Filter, unknown[] | null> = {
  all: null,
  homestead_filed: ["==", ["get", "tax_status_bucket"], "homestead_filed"],
  non_homestead: ["==", ["get", "tax_status_bucket"], "non_homestead"],
  unknown: ["==", ["get", "tax_status_bucket"], "unknown"],
};

function applyFilter(map: import("maplibre-gl").Map, filter: Filter) {
  map.setFilter("baseline-parcels-fill", mapFilters[filter] as never);
  map.setFilter("baseline-parcels-line", mapFilters[filter] as never);
}

function applySelectedParcel(map: import("maplibre-gl").Map, key: string | null) {
  map.setFilter("baseline-parcels-selected", key ? ["==", ["get", "__parcel_key"], key] : ["==", "__parcel_key", ""] as never);
}

function tooltipContent(parcel: PublicParcel): HTMLDivElement {
  const content = document.createElement("div");
  content.className = "text-sm leading-5 text-slate-700";
  for (const [index, line] of parcelSummaryLines(parcel).entries()) {
    const row = document.createElement("p");
    row.textContent = line;
    if (index === 0) row.className = "font-semibold text-slate-950";
    content.append(row);
  }
  return content;
}

function coordinateBounds(coordinates: unknown): [number, number, number, number] | null {
  const values: Array<[number, number]> = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value) && value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      values.push([value[0], value[1]]);
      return;
    }
    if (Array.isArray(value)) value.forEach(visit);
  };
  visit(coordinates);
  if (!values.length) return null;
  return values.reduce<[number, number, number, number]>(
    ([west, south, east, north], [longitude, latitude]) => [
      Math.min(west, longitude), Math.min(south, latitude), Math.max(east, longitude), Math.max(north, latitude),
    ],
    [values[0][0], values[0][1], values[0][0], values[0][1]],
  );
}

export default function BaselineMap({
  coverage,
}: {
  coverage: { matched_geometries: number; geometry_denominator: number } | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const filterRef = useRef<Filter>("all");
  const [filter, setFilter] = useState<Filter>("all");
  const [parcels, setParcels] = useState<PublicParcel[]>([]);
  const [status, setStatus] = useState<MapStatus>("loading");
  const [malformedFeatures, setMalformedFeatures] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const parcelsByKey = useMemo(() => new Map(parcels.map((parcel) => [parcel.key, parcel])), [parcels]);
  const searchResults = useMemo(() => findPublicParcels(parcels, search), [parcels, search]);
  const selected = selectedKey ? parcelsByKey.get(selectedKey) ?? null : null;

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/baseline/map", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("map endpoint unavailable");
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        const parsed = normalizePublicMap(payload);
        if (!parsed.parcels.length) throw new Error("map payload has no usable public features");
        setParcels(parsed.parcels);
        setMalformedFeatures(parsed.malformedFeatures);
        setStatus(parsed.malformedFeatures ? "malformed" : "ready");
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setStatus("unavailable");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!container.current || mapRef.current || !parcels.length) return;
    let destroyed = false;
    void (async () => {
      try {
        const maplibregl = await import("maplibre-gl");
        await import("maplibre-gl/dist/maplibre-gl.css");
        if (destroyed || !container.current) return;
        maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
        const map = new maplibregl.Map({
          container: container.current,
          style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
          center: [-72.86, 44.12],
          zoom: 11.7,
        });
        mapRef.current = map;
        map.on("load", () => {
          if (destroyed) return;
          // `normalizePublicMap` validates the coordinates before this
          // browser-only selection key is added to the strict server payload.
          map.addSource("baseline-parcels", { type: "geojson", data: mapFeatureCollection(parcels) as never });
          map.addLayer({
            id: "baseline-parcels-fill", type: "fill", source: "baseline-parcels",
            paint: {
              "fill-color": [
                "case", ["==", ["get", "tax_status_bucket"], "homestead_filed"], "#059669",
                ["==", ["get", "tax_status_bucket"], "non_homestead"], "#d97706", "#94a3b8",
              ],
              "fill-opacity": 0.62,
            },
          });
          map.addLayer({ id: "baseline-parcels-line", type: "line", source: "baseline-parcels", paint: { "line-color": "#ffffff", "line-width": 0.45 } });
          map.addLayer({
            id: "baseline-parcels-selected", type: "line", source: "baseline-parcels",
            paint: { "line-color": "#0f172a", "line-width": 3 }, filter: ["==", "__parcel_key", ""],
          });
          applyFilter(map, filterRef.current);
          const hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
          map.on("click", "baseline-parcels-fill", (event) => setSelectedKey(publicMapFeatureKey(event.features?.[0]?.properties)));
          map.on("mousemove", "baseline-parcels-fill", (event) => {
            const key = publicMapFeatureKey(event.features?.[0]?.properties);
            const parcel = key ? parcelsByKey.get(key) : null;
            if (parcel) hoverPopup.setLngLat(event.lngLat).setDOMContent(tooltipContent(parcel)).addTo(map);
          });
          map.on("mouseenter", "baseline-parcels-fill", () => { map.getCanvas().style.cursor = "pointer"; });
          map.on("mouseleave", "baseline-parcels-fill", () => { map.getCanvas().style.cursor = ""; hoverPopup.remove(); });
        });
      } catch {
        if (!destroyed) setStatus("unavailable");
      }
    })();
    return () => {
      destroyed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [parcels, parcelsByKey]);

  useEffect(() => {
    filterRef.current = filter;
    const map = mapRef.current;
    if (map?.getLayer("baseline-parcels-fill")) applyFilter(map, filter);
  }, [filter]);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer("baseline-parcels-selected")) applySelectedParcel(map, selectedKey);
  }, [selectedKey]);

  function selectParcel(key: string | null) {
    setSelectedKey(key);
    const parcel = key ? parcelsByKey.get(key) : null;
    const map = mapRef.current;
    const bounds = parcel && coordinateBounds(parcel.geometry.coordinates);
    if (map && bounds) map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 350 });
  }

  const coverageIncomplete = coverage && coverage.matched_geometries < coverage.geometry_denominator;
  const statusMessage = status === "loading"
    ? "Loading public parcel data…"
    : status === "unavailable"
      ? "Parcel data is unavailable. No fallback figures or private records are shown."
      : status === "malformed"
        ? `${malformedFeatures.toLocaleString()} malformed public map record${malformedFeatures === 1 ? " was" : "s were"} omitted; the remaining records are available below.`
        : coverageIncomplete
          ? `Map coverage is incomplete: ${coverage!.matched_geometries.toLocaleString()} of ${coverage!.geometry_denominator.toLocaleString()} tax accounts have matched geometry.`
          : null;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="parcel-map-heading">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="parcel-map-heading" className="font-semibold text-slate-950">Warren public parcel map</h2>
          <p className="text-sm text-slate-600">Color shows an `HSDECL` tax-field observation, not property use or occupancy.</p>
        </div>
        <label className="text-sm font-medium text-slate-700">
          Filter <select className="ml-2 rounded-md border border-slate-300 bg-white px-2 py-1" value={filter} onChange={(event) => {
            const nextFilter = event.target.value as Filter;
            filterRef.current = nextFilter;
            selectParcel(null);
            setFilter(nextFilter);
          }}>
            <option value="all">All mapped accounts</option>
            <option value="homestead_filed">Homestead filed</option>
            <option value="non_homestead">Non-homestead</option>
            <option value="unknown">Unknown status</option>
          </select>
        </label>
      </div>
      <div className="relative h-[520px] bg-slate-100">
        <div ref={container} className="h-full w-full" aria-hidden="true" />
        {(status === "loading" || status === "unavailable") && <p role="status" className="absolute inset-0 grid place-items-center p-6 text-center text-slate-600">{statusMessage}</p>}
      </div>
      <div className="grid gap-3 border-t border-slate-200 p-5 sm:grid-cols-3" aria-label="Map key">
        <Legend color="bg-emerald-600" label="Homestead filed" />
        <Legend color="bg-amber-600" label="Non-homestead" />
        <Legend color="bg-slate-400" label="Unknown status" />
      </div>
      {statusMessage && status !== "loading" && <p role="status" className="border-t border-slate-200 bg-amber-50 px-5 py-3 text-sm text-amber-950">{statusMessage}</p>}
      <div className="border-t border-slate-200 p-5" aria-labelledby="parcel-search-heading">
        <h3 id="parcel-search-heading" className="font-semibold text-slate-950">Find an address</h3>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">Search the public address shown on the map. Results are limited to eight at a time, so the page does not create a 3,000-item control. Search results and the selected summary state the tax-field observation in words; map color is only a visual aid.</p>
        {parcels.length > 0 ? <>
          <label className="mt-3 block max-w-xl text-sm font-medium text-slate-700" htmlFor="parcel-address-search">Address search</label>
          <input
            id="parcel-address-search"
            className="mt-1 block w-full max-w-xl rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-950 placeholder:text-slate-400 focus:outline-2 focus:outline-offset-2 focus:outline-emerald-700"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Start with at least two letters, for example “Brook”"
            aria-describedby="parcel-search-help"
          />
          <p id="parcel-search-help" className="mt-2 text-sm text-slate-600">Only public property addresses are searchable. Mailing addresses and owner information are not part of this release.</p>
          {search.trim().length >= 2 && <ul className="mt-3 max-w-xl divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200" aria-label="Address search results">
            {searchResults.length ? searchResults.map((parcel) => <li key={parcel.key}>
              <button type="button" className="flex w-full items-center justify-between gap-4 px-3 py-3 text-left text-sm hover:bg-slate-50 focus:outline-2 focus:outline-offset-[-2px] focus:outline-emerald-700" onClick={() => selectParcel(parcel.key)}>
                <span className="font-medium text-slate-950">{parcelLabel(parcel)}</span>
                <span className="shrink-0 text-slate-600">{parcel.tax_status_bucket.replaceAll("_", " ")}</span>
              </button>
            </li>) : <li className="px-3 py-3 text-sm text-slate-600">No public address matches that search.</li>}
          </ul>}
        </> : <p className="mt-3 text-sm text-slate-600">Public address search will be available when the map finishes loading.</p>}
        {selected && <div className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-700" aria-live="polite">
          {parcelSummaryLines(selected).map((line, index) => <p key={line} className={index === 0 ? "font-semibold text-slate-950" : "mt-1"}>{line}</p>)}
        </div>}
      </div>
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <p className="flex items-center gap-2 text-sm text-slate-600"><span className={`h-3 w-3 rounded-full ${color}`} />{label}</p>;
}

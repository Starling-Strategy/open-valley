"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { schoolForCampus, type CampusGroup } from "./school-overview-utils";
import styles from "./schools-overview.module.css";

export interface SchoolMapProps {
  groups: CampusGroup[];
  selectedSchoolId: string | null;
  onSelectSchool: (schoolId: string) => void;
}

export default function SchoolMap({ groups, selectedSchoolId, onSelectSchool }: SchoolMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const selected = useRef(selectedSchoolId);
  const buttons = useRef<{ element: HTMLButtonElement; schoolIds: string[] }[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const failed = state === "failed";

  useEffect(() => {
    selected.current = selectedSchoolId;
    for (const { element, schoolIds } of buttons.current) {
      element.setAttribute("aria-pressed", String(schoolIds.includes(selectedSchoolId ?? "")));
    }
  }, [selectedSchoolId]);

  useEffect(() => {
    if (!container.current || failed) return;
    let cancelled = false;
    let map: MapLibreMap | undefined;
    let observer: ResizeObserver | undefined;
    const markers: Marker[] = [];
    const fail = () => {
      if (cancelled) return;
      if (container.current?.contains(document.activeElement)) {
        document.getElementById("school-list")?.focus({ preventScroll: true });
      }
      setState("failed");
    };

    async function initialize() {
      try {
        const maplibre = await import("maplibre-gl");
        if (cancelled || !container.current) return;
        maplibre.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
        const bounds = new maplibre.LngLatBounds();
        for (const { campus } of groups) bounds.extend([campus.longitude, campus.latitude]);
        map = new maplibre.Map({
          container: container.current,
          bounds,
          fitBoundsOptions: { padding: 58, maxZoom: 11, duration: 0 },
          bearing: 0,
          pitch: 0,
          maxPitch: 0,
          minZoom: 6,
          maxZoom: 19,
          renderWorldCopies: false,
          scrollZoom: false,
          dragRotate: false,
          touchPitch: false,
          cooperativeGestures: true,
          attributionControl: { compact: false },
          style: {
            version: 8,
            sources: {
              openstreetmap: {
                type: "raster",
                tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                tileSize: 256,
                maxzoom: 19,
                attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
              },
            },
            layers: [{ id: "geographic-context", type: "raster", source: "openstreetmap", paint: { "raster-fade-duration": 0 } }],
          },
        });
        map.on("error", fail);
        map.on("webglcontextlost", fail);
        map.on("load", () => { if (!cancelled) setState((previous) => previous === "failed" ? previous : "ready"); });
        map.touchZoomRotate.disableRotation();
        map.keyboard.disableRotation();
        map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        map.getCanvas().setAttribute("aria-label", "Campus map. Use the equivalent school directory for school facts.");

        buttons.current = groups.map((group, index) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = styles.mapMarker;
          button.textContent = String(index + 1);
          const names = group.schools.map((school) => school.name).join(" and ");
          button.setAttribute("aria-label", `Campus ${index + 1}: ${names || group.campus.name}${group.schools.length > 1 ? ". Shared campus; choose either reporting group in the map panel." : ". Open school facts."}`);
          button.setAttribute("aria-pressed", String(group.schools.some((school) => school.school_id === selected.current)));
          button.title = group.campus.name;
          button.addEventListener("click", () => {
            const schoolId = schoolForCampus(group, selected.current);
            if (schoolId) onSelectSchool(schoolId);
          });
          markers.push(new maplibre.Marker({ element: button, anchor: "center" })
            .setLngLat([group.campus.longitude, group.campus.latitude]).addTo(map!));
          return { element: button, schoolIds: group.schools.map((school) => school.school_id) };
        });
        observer = new ResizeObserver(() => {
          if (!cancelled && map) {
            map.resize();
            map.fitBounds(bounds, { padding: 58, maxZoom: 11, duration: 0 });
          }
        });
        observer.observe(container.current);
      } catch {
        fail();
      }
    }
    void initialize();
    return () => {
      cancelled = true;
      observer?.disconnect();
      for (const marker of markers) marker.remove();
      buttons.current = [];
      map?.remove();
    };
  }, [groups, onSelectSchool, failed]);

  return (
    <div className={styles.mapStage}>
      <div ref={container} className={styles.mapCanvas} hidden={failed} inert={state !== "ready"} aria-hidden={state !== "ready"} />
      {state !== "ready" && <div className={styles.mapNotice} role="status" aria-live="polite">
        {failed ? <>
          <h3>Map unavailable</h3>
          <p>The geographic basemap could not be displayed. Every school, count and source remains available in the school directory.</p>
          <a href="#school-list">Go to the school directory</a>
        </> : <p>Loading the campus map. The school directory is ready to read.</p>}
      </div>}
    </div>
  );
}

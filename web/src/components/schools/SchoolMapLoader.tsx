"use client";

import { Component, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { PublicSource } from "@/lib/schools";
import type { SchoolMapProps } from "./SchoolMap";
import { SchoolSources } from "./SchoolProfile";
import styles from "./schools-overview.module.css";

function MapUnavailable() {
  return <div className={styles.mapStage}>
    <div className={styles.mapNotice} role="status">
      <h3>Map unavailable</h3>
      <p>The geographic basemap could not be loaded. Every school, count and source remains available in the school directory.</p>
      <a href="#school-list">Go to the school directory</a>
    </div>
  </div>;
}

class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <MapUnavailable /> : this.props.children; }
}

const SchoolMap = dynamic(() => import("./SchoolMap"), {
  ssr: false,
  loading: () => <div className={styles.mapStage}><p className={styles.mapNotice} role="status">Loading the campus map. The school directory is ready to read.</p></div>,
});

export default function SchoolMapLoader({ sources, ...props }: SchoolMapProps & { sources: PublicSource[] }) {
  const sharedGroup = props.groups.find((group) => group.schools.length > 1 && group.schools.some((school) => school.school_id === props.selectedSchoolId));
  return (
    <figure className={styles.mapFigure} aria-labelledby="campus-map-heading">
      <div className={styles.mapHeading}>
        <h3 id="campus-map-heading">Across the district</h3>
        <p className={styles.note}>North up · numbers match the directory</p>
      </div>
      <MapBoundary><SchoolMap {...props} /></MapBoundary>
      {sharedGroup && <div className={styles.mapGroupChooser}>
        <p>{sharedGroup.campus.name}</p>
        <p className={styles.note}>One campus. Choose a reporting group:</p>
        <div className={styles.groupButtons}>
          {sharedGroup.schools.map((school) => <button type="button" key={school.school_id}
            aria-pressed={props.selectedSchoolId === school.school_id} onClick={() => props.onSelectSchool(school.school_id)}>
            {school.name}
          </button>)}
        </div>
      </div>}
      <figcaption className={styles.mapCaption}>
        <p>Geographic context, not district or attendance boundaries. Campus points are general-reference locations; the map does not determine school assignments.</p>
        <p>Use the zoom buttons or a two-finger touch gesture. Scrolling over the map continues down the page.</p>
        <p>Basemap © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>.</p>
        {props.selectedSchoolId && <a className={styles.detailsLink} href={`#school-profile-${props.selectedSchoolId}`}>Go to selected school facts <span aria-hidden="true">↗</span></a>}
        <details className={styles.mapSources}>
          <summary>Campus location sources</summary>
          <SchoolSources references={props.groups.flatMap((group) => group.campus.sources)} sources={sources} />
        </details>
      </figcaption>
    </figure>
  );
}

"use client";

import { memo, useMemo, useState } from "react";
import type { SchoolsPayload } from "@/lib/schools";
import SchoolMapLoader from "./SchoolMapLoader";
import SchoolProfile, { SchoolEnrollment, SchoolSources } from "./SchoolProfile";
import {
  countDate, currentGrades, dateLabel, enrollmentStatus, enrollmentValue, gradeLabel,
  groupCampuses, resolveEnrollment, schoolYearLabel,
} from "./school-overview-utils";
import styles from "./schools-overview.module.css";

export const SchoolOverview = memo(function SchoolOverview({ payload }: { payload: SchoolsPayload; releaseId: string }) {
  const [selectedSchoolId, setSelectedSchoolId] = useState<string | null>(null);
  const groups = useMemo(() => groupCampuses(payload), [payload]);
  const selectedSchool = payload.schools.find((school) => school.school_id === selectedSchoolId);
  const sharedCampuses = groups.filter((group) => group.schools.length > 1);
  const towns = [...new Set(payload.campuses.map(campus => campus.physical_town))].sort();
  const rosterSources = payload.sources.filter((source) => ["huusd-schools", "huusd-about"].includes(source.source_id))
    .flatMap((source) => source.locators.map((source_locator) => ({ source_id: source.source_id, source_locator })));

  function selectFromProfile(schoolId: string) {
    setSelectedSchoolId(schoolId);
    // A sibling/next-school action closes the profile containing the focused button.
    // Keep keyboard focus on the new school without moving the reader's viewport.
    requestAnimationFrame(() => document.getElementById(`school-toggle-${schoolId}`)?.focus({ preventScroll: true }));
  }

  return (
    <div className={styles.overview}>
      <section className={styles.currentSchools} aria-labelledby="current-schools-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>The district at a glance</p>
            <h2 id="current-schools-heading">Our schools today.</h2>
          </div>
          <p className={styles.rosterCount}><strong>{groups.length}</strong> campuses <span aria-hidden="true">/</span> <strong>{payload.schools.length}</strong> K–12 reporting groups</p>
        </div>
        <div className={styles.introduction}>
          <p>The district’s campuses are in {new Intl.ListFormat("en-US", { style: "long", type: "conjunction" }).format(towns)}.</p>
          <p>Start with a school below, or choose its numbered campus on the map. Both open the same school facts. School enrollment describes students attending or reported by a school; it is not a count of all children living in the district.</p>
          {sharedCampuses.map(({ campus, schools }) => <p key={campus.campus_id}>
            {campus.name} shares a campus across {schools.map((school) => school.name).join(" and ")}. The reporting groups stay separate here.
          </p>)}
          <SchoolSources references={rosterSources} sources={payload.sources} />
          <p className={styles.note}>Dataset updated <time dateTime={payload.dataset_date}>{dateLabel(payload.dataset_date)}</time>. “Observed” identifies a recorded count, not a certified final count.</p>
        </div>
        <div className={styles.selectionBar}>
          <button type="button" className={styles.overviewButton} aria-pressed={!selectedSchool} onClick={() => setSelectedSchoolId(null)}>All district schools</button>
          <p role="status" aria-live="polite" aria-atomic="true" className={styles.note}>
            {selectedSchool ? `${selectedSchool.name} selected. Its school facts are open in the directory.` : "District overview. Choose a school to explore its facts and sources."}
          </p>
          {selectedSchool && <a className={styles.detailsLink} href={`#school-profile-${selectedSchool.school_id}`}>Go to selected school facts <span aria-hidden="true">↓</span></a>}
        </div>

        <div className={styles.directoryMap}>
          <div className={styles.directory} id="school-list" aria-label="School directory" tabIndex={-1}>
            {groups.map(({ campus, schools }, index) => <div className={styles.campusGroup} key={campus.campus_id}>
              <div className={styles.campusHeading}>
                <span className={styles.campusNumber} aria-label={`Map campus ${index + 1}`}>{index + 1}</span>
                <p>{campus.physical_town}{schools.length > 1 && <> · Shared campus</>}</p>
              </div>
              {schools.map((school) => {
                const grades = currentGrades(school);
                const latest = resolveEnrollment(payload, school.latest_attending_enrollment_ref);
                const current = resolveEnrollment(payload, school.current_enrollment_ref);
                return <div className={styles.schoolEntry} key={school.school_id}>
                  <details open={selectedSchoolId === school.school_id} className={styles.schoolDetails}>
                    <summary id={`school-toggle-${school.school_id}`} aria-controls={`school-profile-${school.school_id}`} onClick={(event) => {
                      event.preventDefault();
                      setSelectedSchoolId(selectedSchoolId === school.school_id ? null : school.school_id);
                    }}>
                      <span className={styles.schoolName}>{school.name}</span>
                      <span className={styles.schoolGrade}>{grades ? `Grades ${gradeLabel(grades.grade_scope)} · ${schoolYearLabel(grades.school_year)}` : "Current grades: Not available"}</span>
                      <span className={styles.directoryCounts}>
                        <span><strong>{enrollmentValue(latest)}</strong> latest attending{latest && <> · {countDate(latest)} · {latest.status === "observed" ? "Observed" : enrollmentStatus(latest)}</>}</span>
                        <span><strong>{enrollmentValue(current)}</strong> current-year update{current && <> · {schoolYearLabel(current.school_year)} · {enrollmentStatus(current)} · {countDate(current)}</>}</span>
                      </span>
                      <span className={styles.summaryAction}>{selectedSchoolId === school.school_id ? "Close school facts" : "School facts & sources"} <span aria-hidden="true">{selectedSchoolId === school.school_id ? "−" : "+"}</span></span>
                    </summary>
                    <SchoolProfile school={school} campus={campus} payload={payload} onSelectSchool={selectFromProfile} />
                  </details>
                  <details className={styles.directorySources}>
                    <summary>Sources for grades and counts</summary>
                    <SchoolSources references={[...(grades ? [grades] : []), ...(latest ? [latest] : []), ...(current ? [current] : [])]} sources={payload.sources} />
                  </details>
                </div>;
              })}
            </div>)}
          </div>

          <div className={styles.mapColumn}>
            <SchoolMapLoader groups={groups} sources={payload.sources} selectedSchoolId={selectedSchoolId} onSelectSchool={setSelectedSchoolId} />
          </div>
        </div>
      </section>

      <section className={styles.pathways} aria-labelledby="school-pathways-heading">
        <p className={styles.eyebrow}>How the schools fit together</p>
        <h2 id="school-pathways-heading">The usual next step.</h2>
        <p className={styles.sectionLede}>These pathways describe the usual grade structure, not a guaranteed assignment for an individual student. School choice can change the sequence; the dated school notes explain the qualifications.</p>
        <ul className={styles.pathwayList}>
          {payload.schools.map((school) => {
            const grades = currentGrades(school);
            const nextSchools = school.usual_next_school_ids.map((id) => payload.schools.find((item) => item.school_id === id)).filter((item) => item !== undefined);
            return <li key={school.school_id}>
              <div className={styles.pathwayRoute}>
                <h3>{school.name}</h3>
                <p>{grades ? `Grades ${gradeLabel(grades.grade_scope)} · ${schoolYearLabel(grades.school_year)}` : "Current grades: Not available"}</p>
                {nextSchools.map((next) => <p className={styles.pathwayDestination} key={next.school_id}><span aria-hidden="true">→ </span><span className={styles.srOnly}>Usual next school: </span>{next.name}</p>)}
              </div>
              <div>
                <p>{school.pathway_note}</p>
                {grades && <p className={styles.note}>Configuration checked {dateLabel(grades.verified_at)}; effective change date not established.</p>}
                <SchoolSources references={[...(grades ? [grades] : []), ...school.sources]} sources={payload.sources} />
              </div>
            </li>;
          })}
        </ul>
      </section>

      <section className={styles.programs} aria-labelledby="school-programs-heading">
        <p className={styles.eyebrow}>Beyond the K–12 reporting groups</p>
        <h2 id="school-programs-heading">Preschool and other pathways.</h2>
        <p className={styles.sectionLede}>These programs have their own definitions and coverage. They are acknowledged separately and are not added to the school counts above.</p>
        <div className={styles.programGrid}>
          {payload.programs.map((program) => <article key={program.program_id}>
            <h3>{program.name}</h3>
            <p className={styles.note}>{schoolYearLabel(program.school_year)}{program.grade_scope && <> · Grades {gradeLabel(program.grade_scope)}</>}</p>
            <p>{program.notes}</p>
            {program.current_enrollment_ref
              ? <SchoolEnrollment title="Program enrollment" row={resolveEnrollment(payload, program.current_enrollment_ref)} payload={payload} />
              : <p className={styles.programCount}><strong>Current headcount:</strong> {program.value_state === "not_applicable" ? "Not applicable — no single program count is defined." : program.value_state === "suppressed" ? "Suppressed." : "Not available."}</p>}
            <SchoolSources references={program.sources} sources={payload.sources} />
          </article>)}
        </div>
      </section>
    </div>
  );
// Releases are immutable. An eligibility recheck of the same release must not
// replace map controls or discard the reader's camera and keyboard position.
}, (previous, next) => previous.releaseId === next.releaseId);

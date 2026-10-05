import type { Campus, EnrollmentObservation, PublicSource, School, SchoolsPayload, SourceReference } from "@/lib/schools";
import {
  countDate, currentGrades, dateLabel, enrollmentSeries, enrollmentStatus,
  enrollmentValue, gradeLabel, resolveEnrollment, schoolYearLabel,
} from "./school-overview-utils";
import styles from "./schools-overview.module.css";

export function SchoolSources({ references, sources }: { references: SourceReference[]; sources: PublicSource[] }) {
  const unique = references.filter((reference, index) => references.findIndex((other) =>
    other.source_id === reference.source_id && other.source_locator === reference.source_locator) === index);
  if (!unique.length) return null;
  return (
    <ul className={styles.sources} aria-label="Sources">
      {unique.map((reference) => {
        const source = sources.find((item) => item.source_id === reference.source_id);
        return (
          <li key={`${reference.source_id}:${reference.source_locator}`}>
            {source ? <a href={source.url}>{source.title}</a> : <span>Source not available</span>}
            {" — "}{reference.source_locator}
          </li>
        );
      })}
    </ul>
  );
}

export function SchoolEnrollment({ title, row, payload }: {
  title: string; row: EnrollmentObservation | null; payload: SchoolsPayload;
}) {
  const source = row && payload.sources.find((item) => item.source_id === row.source_id);
  return (
    <section className={styles.enrollmentFact} aria-label={title}>
      <h4>{title}</h4>
      <p className={row?.value_state === "observed" ? styles.enrollmentNumber : styles.unavailable}>
        {enrollmentValue(row)}
        {row?.value_state === "observed" && row.value !== null && <span> students</span>}
      </p>
      {row ? <>
        <p className={styles.countMeta}>{schoolYearLabel(row.school_year)} · Grades {gradeLabel(row.grade_scope)}</p>
        <p className={styles.countMeta}>{enrollmentStatus(row)}<br />{countDate(row)}</p>
        {source?.published_at && <p className={styles.note}>Report published {dateLabel(source.published_at)}; publication is not the count date.</p>}
        <p className={styles.note}>{enrollmentSeries(payload, row)?.description}</p>
        <p className={styles.note}>{row.count_basis === "derived_headcount" ? "Derived headcount" : "Reported headcount"}; not a weighted pupil measure.</p>
        {row.notes && <p className={styles.note}>{row.notes}</p>}
        <SchoolSources references={[row]} sources={payload.sources} />
      </> : <p className={styles.note}>No verified count is available in this release.</p>}
    </section>
  );
}

export default function SchoolProfile({ school, campus, payload, onSelectSchool }: {
  school: School; campus: Campus; payload: SchoolsPayload; onSelectSchool: (schoolId: string) => void;
}) {
  const grades = currentGrades(school);
  const latest = resolveEnrollment(payload, school.latest_attending_enrollment_ref);
  const current = resolveEnrollment(payload, school.current_enrollment_ref);
  const siblings = payload.schools.filter((item) => item.campus_id === campus.campus_id);
  const nextSchools = school.usual_next_school_ids.map((id) => payload.schools.find((item) => item.school_id === id)).filter((item) => item !== undefined);
  return (
    <div className={styles.profile} id={`school-profile-${school.school_id}`} tabIndex={-1}>
      <h3>{school.name}</h3>
      {grades ? <>
        <p>Grades <strong>{gradeLabel(grades.grade_scope)}</strong> · {schoolYearLabel(grades.school_year)}</p>
        <p className={styles.note}>Configuration checked {dateLabel(grades.verified_at)}. This is the school year described, not a verified change date.</p>
        <SchoolSources references={[grades]} sources={payload.sources} />
      </> : <p>Current grade configuration: Not available.</p>}

      <div className={styles.location}>
        <h4>Campus</h4>
        <p>{campus.name}</p>
        <p>{campus.address}</p>
        <p className={styles.note}>Physical town: {campus.physical_town}</p>
        {campus.notes && <p className={styles.note}>{campus.notes}</p>}
        <SchoolSources references={campus.sources} sources={payload.sources} />
      </div>

      {siblings.length > 1 && <div className={styles.sharedCampus}>
        <p className={styles.note}>Shared campus · separate reporting groups. Counts below belong to the selected group, not the combined campus.</p>
        <div className={styles.groupButtons}>
          {siblings.map((sibling) => <button type="button" key={sibling.school_id}
            aria-pressed={sibling.school_id === school.school_id} onClick={() => onSelectSchool(sibling.school_id)}>
            {sibling.name}
          </button>)}
        </div>
      </div>}

      <div className={styles.enrollmentPair}>
        <SchoolEnrollment title="Latest verified attending count" row={latest} payload={payload} />
        <SchoolEnrollment title="Current-year update · separate series" row={current} payload={payload} />
      </div>
      <p><a href="#enrollment-history">Explore enrollment history below</a>; choose {school.name} in the school selector.</p>

      <div className={styles.profileSection}>
        <h4>Usual next step</h4>
        {nextSchools.length > 0 && <ul className={styles.nextSchools}>
          {nextSchools.map((next) => <li key={next.school_id}>
            <button type="button" onClick={() => onSelectSchool(next.school_id)}>{next.name} <span aria-hidden="true">→</span></button>
          </li>)}
        </ul>}
        <p>{school.pathway_note}</p>
        {school.aliases.length > 0 && <p className={styles.note}><strong>Names in source records:</strong> {school.aliases.join("; ")}.</p>}
        <SchoolSources references={school.sources} sources={payload.sources} />
      </div>
    </div>
  );
}

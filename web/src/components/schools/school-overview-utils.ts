import type {
  Campus, EnrollmentObservation, EnrollmentReference, School, SchoolsPayload,
} from "@/lib/schools";

export interface CampusGroup {
  campus: Campus;
  schools: School[];
}

const dates = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export function groupCampuses(payload: Pick<SchoolsPayload, "campuses" | "schools">): CampusGroup[] {
  return payload.campuses.map((campus) => ({
    campus,
    schools: payload.schools.filter((school) => school.campus_id === campus.campus_id),
  }));
}

export function schoolForCampus(group: CampusGroup, selectedSchoolId: string | null): string | null {
  return group.schools.find((school) => school.school_id === selectedSchoolId)?.school_id
    ?? group.schools[0]?.school_id ?? null;
}

export function currentGrades(school: School) {
  return school.grade_configurations.reduce<School["grade_configurations"][number] | null>(
    (latest, configuration) => !latest || configuration.school_year > latest.school_year
      ? configuration : latest,
    null,
  );
}

export function enrollmentSeries(payload: Pick<SchoolsPayload, "series">, row: EnrollmentObservation) {
  return payload.series.find((series) =>
    series.kind === "history"
    && series.series_id === row.series_id
    && series.entity_id === row.entity_id
    && series.grade_scope === row.grade_scope
    && series.population_basis === row.population_basis
    && series.count_basis === row.count_basis
    && series.observation_ids.includes(row.observation_id),
  );
}

/** Resolve the publisher's exact reference, never a latest-year or name-only guess. */
export function resolveEnrollment(
  payload: Pick<SchoolsPayload, "enrollment" | "series">,
  reference: EnrollmentReference | null,
): EnrollmentObservation | null {
  if (!reference) return null;
  return payload.enrollment.find((row) =>
    row.series_id === reference.series_id
    && row.entity_id === reference.entity_id
    && row.school_year === reference.school_year
    && row.grade_scope === reference.grade_scope
    && enrollmentSeries(payload, row),
  ) ?? null;
}

export function enrollmentValue(row: EnrollmentObservation | null): string {
  if (row?.value_state === "suppressed") return "Suppressed";
  if (row?.value_state === "not_applicable") return "Not applicable";
  return row?.value_state === "observed" && row.value !== null
    ? row.value.toLocaleString("en-US") : "Not available";
}

export function enrollmentStatus(row: EnrollmentObservation): string {
  return { observed: "Observed · final certification unverified", preliminary: "Preliminary observed count", final: "Final observed count" }[row.status];
}

export function dateLabel(date: string): string {
  return dates.format(new Date(`${date}T12:00:00Z`));
}

export function countDate(row: EnrollmentObservation): string {
  return row.reference_date_status === "known" && row.reference_date
    ? dateLabel(row.reference_date) : "Exact count day not reported";
}

export function schoolYearLabel(year: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(year);
  return match ? `${match[1]}–${Number(match[1]) + 1}` : year;
}

export function gradeLabel(scope: string): string {
  return scope.replaceAll("-", "–");
}

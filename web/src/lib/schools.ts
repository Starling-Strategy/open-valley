/** Public schema-v1 payload only. Publisher lineage/candidate metadata is never a prop. */
export const SCHOOLS_SCHEMA_VERSION = 1 as const;

export type ValueState = "observed" | "missing" | "suppressed" | "not_applicable";
/** `observed` is not a claim of final certification. */
export type EnrollmentStatus = "observed" | "preliminary" | "final";
export type CountBasis = "reported_headcount" | "derived_headcount" | "projected_headcount";

export interface SourceReference {
  source_id: string;
  source_locator: string;
}

export interface EnrollmentReference {
  series_id: string;
  entity_id: string;
  school_year: string;
  grade_scope: string;
}

export interface Campus {
  campus_id: string;
  name: string;
  address: string;
  physical_town: string;
  latitude: number;
  longitude: number;
  state_school_id: string;
  sources: SourceReference[];
  notes: string;
}

export interface GradeConfiguration extends SourceReference {
  school_year: string;
  grade_scope: string;
  verified_at: string;
}

export interface School {
  school_id: string;
  name: string;
  campus_id: string;
  directory_school_id: string;
  state_school_id: string;
  aliases: string[];
  grade_configurations: GradeConfiguration[];
  usual_next_school_ids: string[];
  pathway_note: string;
  sources: SourceReference[];
  latest_attending_enrollment_ref: EnrollmentReference | null;
  current_enrollment_ref: EnrollmentReference | null;
}

export interface SchoolProgram {
  program_id: string;
  name: string;
  school_id: string;
  campus_id: string | null;
  grade_scope: string | null;
  school_year: string;
  current_enrollment_ref: EnrollmentReference | null;
  value_state: ValueState;
  sources: SourceReference[];
  notes: string;
}

export interface PublicSource {
  source_id: string;
  title: string;
  url: string;
  published_at: string | null;
  reviewed_at: string;
  locators: string[];
}

interface ObservationFields extends SourceReference, EnrollmentReference {
  observation_id: string;
  reference_date: string | null;
  reference_date_status: "known" | "unknown";
  population_basis: string;
  /** A numeric forecast cell also has value_state=observed; consult status. */
  value: number | null;
  value_state: ValueState;
  notes: string;
}

export interface EnrollmentObservation extends ObservationFields {
  count_basis: "reported_headcount" | "derived_headcount";
  status: EnrollmentStatus;
}

export interface EnrollmentProjection extends ObservationFields {
  count_basis: "projected_headcount";
  status: "projection";
  forecast_vintage: string;
  author: string;
  base_year: string;
  horizon: string;
  assumptions: string;
}

export interface EnrollmentSeries {
  series_key: string;
  series_id: string;
  entity_id: string;
  grade_scope: string;
  population_basis: string;
  count_basis: CountBasis;
  kind: "history" | "projection";
  /** False means table/disconnected points only. Never bridge null/year gaps. */
  connect_points: boolean;
  description: string;
  observation_ids: string[];
}

export interface SchoolsPayload {
  schema_version: typeof SCHOOLS_SCHEMA_VERSION;
  dataset_date: string;
  content_digest: string;
  campuses: Campus[];
  schools: School[];
  programs: SchoolProgram[];
  notes: string[];
  enrollment: EnrollmentObservation[];
  projections: EnrollmentProjection[];
  sources: PublicSource[];
  series: EnrollmentSeries[];
}

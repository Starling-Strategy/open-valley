import type {
  CountBasis,
  EnrollmentObservation,
  EnrollmentProjection,
  EnrollmentSeries,
  SchoolsPayload,
} from "../../lib/schools";

export type EnrollmentRow = EnrollmentObservation | EnrollmentProjection;
export interface DisplayGroup {
  series: EnrollmentSeries;
  rows: EnrollmentRow[];
  points: EnrollmentRow[];
  lines: EnrollmentRow[][];
  notes: string[];
}

const counts = new Intl.NumberFormat("en-US");
const dates = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

export function displayValue(row: EnrollmentRow): string {
  if (row.value_state === "suppressed") return "Suppressed";
  if (row.value_state === "not_applicable") return "Not applicable";
  if (row.value_state === "missing" || row.value === null) return "Not available";
  return counts.format(row.value);
}

export function statusLabel(row: EnrollmentRow): string {
  if (row.status === "projection") return "Forecast · not an observed count";
  if (row.status === "preliminary") return "Preliminary count";
  if (row.status === "final") return "Final reported count";
  return "Observed count · final certification unverified";
}

export function countLabel(basis: CountBasis): string {
  return { reported_headcount: "Reported headcount", derived_headcount: "Derived headcount", projected_headcount: "Projected headcount" }[basis];
}

export function yearLabel(year: string): string {
  return `${year.slice(0, 4)}–${Number(year.slice(0, 4)) + 1}`;
}

export function dateLabel(date: string | null): string {
  if (!date) return "Not stated";
  return dates.format(new Date(`${date}T00:00:00Z`));
}

export function entityLabel(payload: SchoolsPayload, entity: string): string {
  if (entity === "huusd") return "All district schools";
  return payload.schools.find(school => school.school_id === entity)?.name
    ?? payload.programs.find(program => program.program_id === entity)?.name
    ?? entity.replaceAll(/[-_]/g, " ");
}

export function seriesLabel(series: EnrollmentSeries): string {
  const titles: Record<string, string> = {
    "attending-october": "October attending counts",
    "district-2017": "Earlier district counts, excluding preschool",
    "district-2017-pk-inclusive": "Earlier district total, including preschool",
    "district-headline-ec-inclusive": "District totals including Early College",
    "district-retrospective-2019-2020": "Earlier October counts reprinted by the district",
    "nesdec-2018-history": "Earlier school-supplied counts",
    "nesdec-2026-history": "Historical counts supplied to NESDEC",
    "nesdec-2026-k12": "Published school-age forecast",
    "nesdec-2026-pk": "Published preschool forecast",
    "nesdec-2026-pk-history": "Public and private preschool history",
    "public-pk-october": "Public-school preschool attendance",
    "september-2026-preliminary": "Separate September preliminary update",
    "wwsu-2016": "Counts before the district merger",
  };
  return `${titles[series.series_id] ?? countLabel(series.count_basis)} — ${series.grade_scope.replaceAll("-", "–")}`;
}

export function seriesDescription(series: EnrollmentSeries): string {
  return series.description
    .replace("Show a table or disconnected points, never a common trend line.", "These records are not comparable to the October attending series. Definitions vary across years, so the points are not joined.")
    .replace("Never connect to attending history.", "This forecast uses a different population from attending history and is shown separately.")
    .replace("older primary-basis years are gaps", "earlier comparable attendance counts are not available")
    .replace("Not certified final.", "Final certification is unverified.");
}

/** Presentation only: retain the source's facts and arithmetic without publisher directives. */
export function recordNote(payload: SchoolsPayload, note: string): string {
  return note
    .replace(/\b([a-z][a-z0-9-]*)=(\d+)\b/g, (_, entity: string, value: string) => `${entityLabel(payload, entity)}: ${value}`)
    .replaceAll("|", "; ")
    .replaceAll("same-source school rows", "school counts in the same source")
    .replaceAll("Primary-basis gap", "Comparable attendance count not available")
    .replaceAll("As-supplied retrospective candidate", "Retrospective count supplied to the consultant")
    .replaceAll("Do not assume a fully offsite Early College exclusion", "An exclusion for fully offsite Early College has not been established")
    .replaceAll("do not recover by subtraction", "the exact count is withheld and is not reconstructed from totals")
    .replaceAll("do not label entire history EC-inclusive", "Early College inclusion is inconsistent across this history")
    .replaceAll("do not add to K-12 series", "reported separately from K–12 attendance")
    .replace(/\bEC\b/g, "Early College")
    .replace(/\bUNGR\b/g, "Ungraded count")
    .replace(/\b(headline|attending|attendance|base|gives|PK)(?=\d)/g, "$1 ");
}

function hasValue(row: EnrollmentRow): boolean {
  return row.value_state === "observed" && row.value !== null;
}

function sameDefinition(a: EnrollmentRow, b: EnrollmentRow): boolean {
  if (a.status !== b.status || a.population_basis !== b.population_basis || a.count_basis !== b.count_basis || a.grade_scope !== b.grade_scope) return false;
  if (a.status === "projection" && b.status === "projection") {
    return a.forecast_vintage === b.forecast_vintage && a.author === b.author && a.base_year === b.base_year && a.horizon === b.horizon;
  }
  return true;
}

function displayGroup(series: EnrollmentSeries, rows: EnrollmentRow[]): DisplayGroup {
  const sorted = [...rows].sort((a, b) => a.school_year.localeCompare(b.school_year));
  const lines: EnrollmentRow[][] = [];
  let run: EnrollmentRow[] = [];
  const finish = () => {
    if (run.length > 1) lines.push(run);
    run = [];
  };
  if (series.connect_points) {
    for (const row of sorted) {
      if (!hasValue(row)) { finish(); continue; }
      const previous = run.at(-1);
      if (previous && (Number(row.school_year.slice(0, 4)) !== Number(previous.school_year.slice(0, 4)) + 1 || !sameDefinition(previous, row))) finish();
      run.push(row);
    }
    finish();
  }
  return { series, rows: sorted, points: sorted.filter(hasValue), lines,
    notes: [...new Set(sorted.map(row => row.notes).filter(Boolean))] };
}

function groupsFor(payload: SchoolsPayload, kind: EnrollmentSeries["kind"], entity?: string): DisplayGroup[] {
  const records = new Map<string, EnrollmentRow>((kind === "history" ? payload.enrollment : payload.projections).map(row => [row.observation_id, row]));
  return payload.series.filter(series => series.kind === kind && (entity === undefined || series.entity_id === entity)).map(series => displayGroup(series,
    series.observation_ids.flatMap(id => { const row = records.get(id); return row ? [row] : []; }),
  )).filter(group => group.rows.length > 0);
}

export function chartYears(rows: EnrollmentRow[]): string[] {
  const years = rows.map(row => Number(row.school_year.slice(0, 4)));
  if (years.length === 0) return [];
  const first = Math.min(...years);
  const last = Math.max(...years);
  return Array.from({ length: last - first + 1 }, (_, index) => {
    const year = first + index;
    return `${year}-${String(year + 1).slice(-2)}`;
  });
}

/** Same plot records serve the desktop chart and the phone's readable year rows. */
export function figureView(group: DisplayGroup, maximum: number) {
  const supplied = group.rows.filter(row => row.value_state !== "missing");
  const years = chartYears(supplied.length ? supplied : group.rows);
  const records = new Map(group.rows.map(row => [row.school_year, row]));
  const entries = years.map(year => {
    const row = records.get(year);
    const numeric = row !== undefined && hasValue(row);
    return { year, row, value: row ? displayValue(row) : "Not available",
      position: numeric ? row.value! / maximum * 100 : null,
      status: numeric ? { observed: "Observed", final: "Final", preliminary: "Preliminary", projection: "Forecast" }[row.status] : "",
    };
  });
  return { years, entries, omittedRows: group.rows.filter(row => !years.includes(row.school_year)) };
}

function historyTakeaway(group: DisplayGroup | undefined) {
  if (!group || group.series.kind !== "history") return null;
  // Lines already encode the source's permission, numeric years, definitions and status.
  const segment = group.lines.at(-1);
  if (!segment) return null;
  const differences = segment.slice(1).map((row, index) => row.value! - segment[index].value!);
  return { series: group.series, first: segment[0], last: segment[segment.length - 1],
    hasRisesAndFalls: differences.some(value => value > 0) && differences.some(value => value < 0) };
}

function readingGroups(groups: DisplayGroup[]) {
  const broadest = [...groups].filter(group => group.points.length > 0).sort((a, b) =>
    chartYears(b.points).length - chartYears(a.points).length
    || b.points.length - a.points.length
    || b.points[b.points.length - 1].school_year.localeCompare(a.points[a.points.length - 1].school_year));
  const primary = groups.find(group => group.series.series_id === "attending-october")
    ?? broadest.find(group => group.lines.length > 0) ?? broadest[0] ?? groups[0];
  const broader = broadest.find(group => group !== primary && group.points.length > 1);
  const featuredGroups = primary ? [primary, ...(broader ? [broader] : [])] : [];
  return { featuredGroups, otherGroups: groups.filter(group => !featuredGroups.includes(group)), takeaway: historyTakeaway(primary) };
}

function scopeSelection(scope: string): string {
  if (scope === "PK") return "pk";
  if (scope.includes("PK")) return "pk-inclusive";
  if (scope === "UNGR") return "ungraded";
  if (/^(K|\d{1,2})$/.test(scope)) return scope;
  return "totals";
}

function gradeLabel(scope: string): string {
  if (scope === "totals") return "School-age totals · separate definitions";
  if (scope === "pk") return "PK · separate population";
  if (scope === "pk-inclusive") return "PK-inclusive totals · separate population";
  if (scope === "ungraded") return "Ungraded · separate reporting group";
  return scope === "K" ? "Kindergarten" : `Grade ${scope}`;
}

export function buildHistoryView(payload: SchoolsPayload, entity = "huusd", selection = "totals") {
  const available = groupsFor(payload, "history", entity);
  const options = new Set(available.filter(group => group.rows.some(row => row.value_state !== "missing" && row.value_state !== "not_applicable"))
    .map(group => scopeSelection(group.series.grade_scope)));
  const gradeOptions = ["totals", ...[...options].filter(scope => scope !== "totals").sort((a, b) => a.localeCompare(b, "en", { numeric: true }))]
    .map(value => ({ value, label: gradeLabel(value) }));
  const groups = available.filter(group => scopeSelection(group.series.grade_scope) === selection);
  const rows = groups.flatMap(group => group.rows).sort((a, b) => a.school_year.localeCompare(b.school_year));
  return { entity, selection, title: `${entityLabel(payload, entity)} · ${gradeLabel(selection)}`,
    groups, rows, years: chartYears(rows), gradeOptions, ...readingGroups(groups) };
}

export function buildOutlookView(payload: SchoolsPayload) {
  const groups = groupsFor(payload, "projection");
  return { groups, rows: groups.flatMap(group => group.rows) };
}

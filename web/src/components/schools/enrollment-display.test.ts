import assert from "node:assert/strict";
import test from "node:test";
import type { EnrollmentObservation, EnrollmentProjection, EnrollmentSeries, SchoolsPayload } from "../../lib/schools";
import { buildHistoryView, buildOutlookView, displayValue, statusLabel, figureView, seriesLabel, seriesDescription, recordNote } from "./enrollment-display";

// Synthetic public-schema records only; no research documents or release snapshot.
function observation(id: string, year: string, value: number | null, fields: Partial<EnrollmentObservation> = {}): EnrollmentObservation {
  return { observation_id: id, series_id: "attending", entity_id: "huusd", school_year: year,
    grade_scope: "K-12", reference_date: `${year.slice(0, 4)}-10-01`, reference_date_status: "known",
    population_basis: "attending", count_basis: "reported_headcount", value,
    value_state: value === null ? "missing" : "observed", status: "observed",
    source_id: "public-report", source_locator: `Table A, ${year}`, notes: "", ...fields };
}

function series(rows: (EnrollmentObservation | EnrollmentProjection)[], fields: Partial<EnrollmentSeries> = {}): EnrollmentSeries {
  const row = rows[0];
  return { series_key: `${row.series_id}|${row.entity_id}|${row.grade_scope}`, series_id: row.series_id,
    entity_id: row.entity_id, grade_scope: row.grade_scope, population_basis: row.population_basis,
    count_basis: row.count_basis, kind: row.status === "projection" ? "projection" : "history",
    connect_points: true, description: "The stated population for this source.",
    observation_ids: rows.map(r => r.observation_id), ...fields };
}

function payload(enrollment: EnrollmentObservation[], groups: EnrollmentSeries[], projections: EnrollmentProjection[] = []): SchoolsPayload {
  return { schema_version: 1, dataset_date: "2031-10-02", content_digest: "synthetic",
    campuses: [], schools: [], programs: [], notes: [], sources: [{ source_id: "public-report", title: "Public enrollment report",
      url: "https://example.org/report", published_at: "2031-10-02", reviewed_at: "2031-10-03", locators: ["Table A"] }],
    enrollment, series: groups, projections };
}

test("the rendered history model preserves every year and never bridges missing, suppressed, N/A or absent years", () => {
  const rows = [observation("a", "2020-21", 100), observation("b", "2021-22", 98),
    observation("c", "2022-23", null), observation("d", "2023-24", 95),
    observation("e", "2024-25", null, { value_state: "suppressed" }), observation("f", "2025-26", 93),
    observation("g", "2027-28", 91), observation("h", "2028-29", null, { value_state: "not_applicable" }),
    observation("i", "2029-30", 0)];
  const view = buildHistoryView(payload(rows, [series(rows)]));
  assert.equal(view.rows.length, 9);
  assert.ok(view.years.includes("2026-27"), "the missing school year remains on the chart axis");
  assert.deepEqual(view.groups[0].lines.map(line => line.map(r => r.observation_id)), [["a", "b"]]);
  assert.deepEqual(view.groups[0].points.map(r => r.value), [100, 98, 95, 93, 91, 0]);
  assert.equal(displayValue(rows[2]), "Not available");
  assert.equal(displayValue(rows[4]), "Suppressed");
  assert.equal(displayValue(rows[7]), "Not applicable");
  assert.equal(displayValue(rows[8]), "0");
});

test("disconnected consultant history and distinct definitions cannot become one line", () => {
  const old = [observation("old-a", "2020-21", 105, { series_id: "consultant", population_basis: "mixed" }),
    observation("old-b", "2021-22", 104, { series_id: "consultant", population_basis: "mixed" })];
  const current = [observation("new-a", "2022-23", 99), observation("new-b", "2023-24", 98)];
  const view = buildHistoryView(payload([...old, ...current], [series(old, { connect_points: false, description: "Mixed definitions; unresolved discrepancy." }), series(current)]));
  assert.equal(view.groups.length, 2);
  assert.deepEqual(view.groups[0].lines, []);
  assert.equal(view.groups[0].points.length, 2);
  assert.match(view.groups[0].series.description, /unresolved discrepancy/);
  assert.deepEqual(view.groups[1].lines[0].map(r => r.observation_id), ["new-a", "new-b"]);
});

test("a ten-year record is retained across separately defined older and recent series", () => {
  const rows = Array.from({ length: 10 }, (_, i) => observation(`year-${i}`, `${2016 + i}-${String(17 + i)}`, 200 - i,
    { series_id: i < 5 ? `older-${i}` : "recent", population_basis: i < 5 ? `older-definition-${i}` : "attending" }));
  const groups = [...rows.slice(0, 5).map(row => series([row], { connect_points: false })), series(rows.slice(5))];
  const view = buildHistoryView(payload(rows, groups));
  assert.deepEqual(view.years, rows.map(row => row.school_year));
  assert.equal(view.rows.length, 10);
  assert.deepEqual(view.groups.flatMap(group => group.lines).map(line => line.map(row => row.school_year)),
    [["2021-22", "2022-23", "2023-24", "2024-25", "2025-26"]]);
});

test("school and verified-grade selection changes the same title, rows, definitions and sources used by the view", () => {
  const district = observation("district", "2030-31", 200);
  const school = observation("school", "2030-31", 60, { entity_id: "north", grade_scope: "K-6", notes: "School structure changed." });
  const grade = observation("grade", "2030-31", 12, { entity_id: "north", grade_scope: "3", source_locator: "Table A, grade 3" });
  const unavailable = observation("unavailable", "2030-31", null, { entity_id: "north", grade_scope: "4" });
  const pk = observation("pk", "2030-31", 8, { entity_id: "north", grade_scope: "PK" });
  const rows = [district, school, grade, unavailable, pk];
  const p = payload(rows, rows.map(row => series([row], { description: `Definition for ${row.observation_id}` })));
  p.schools = [{ school_id: "north", name: "North School", campus_id: "north", directory_school_id: "north", state_school_id: "north",
    aliases: [], grade_configurations: [], usual_next_school_ids: [], pathway_note: "", sources: [], latest_attending_enrollment_ref: null, current_enrollment_ref: null }];
  assert.deepEqual(buildHistoryView(p).rows.map(row => row.observation_id), ["district"]);
  const selected = buildHistoryView(p, "north");
  assert.match(selected.title, /North School/);
  assert.deepEqual(selected.rows.map(row => row.observation_id), ["school"]);
  assert.ok(selected.gradeOptions.some(option => option.value === "3"));
  assert.ok(!selected.gradeOptions.some(option => option.value === "4"));
  assert.match(selected.groups[0].notes.join(" "), /School structure changed/);
  const detail = buildHistoryView(p, "north", "3");
  assert.match(detail.title, /Grade 3/);
  assert.deepEqual(detail.rows.map(row => row.observation_id), ["grade"]);
  assert.equal(detail.groups[0].series.description, "Definition for grade");
  assert.equal(detail.rows[0].source_locator, "Table A, grade 3");
  assert.deepEqual(buildHistoryView(p, "north", "pk").rows.map(row => row.observation_id), ["pk"]);
});

test("preliminary status interrupts a solid observed line and remains explicit", () => {
  const rows = [observation("a", "2030-31", 100, { status: "final" }), observation("b", "2031-32", 90, { status: "preliminary", reference_date: null, reference_date_status: "unknown" })];
  const view = buildHistoryView(payload(rows, [series(rows)]));
  assert.deepEqual(view.groups[0].lines, []);
  assert.equal(statusLabel(rows[0]), "Final reported count");
  assert.equal(statusLabel(rows[1]), "Preliminary count");
  assert.equal(statusLabel(observation("c", "2032-33", 89)), "Observed count · final certification unverified");
});

test("forecast model never imports history, combines PK with K–12, or mistakes a numeric cell for an observed count", () => {
  const observed = observation("past", "2030-31", 100);
  const forecast = (id: string, year: string, scope: string, value: number): EnrollmentProjection => ({ ...observation(id, year, value),
    series_id: `forecast-${scope}`, grade_scope: scope, population_basis: `forecast-${scope}-including-other-programs`,
    count_basis: "projected_headcount", status: "projection", forecast_vintage: "2031-v2", author: "Published forecaster",
    base_year: "2030-31", horizon: "2031-32 through 2032-33", assumptions: "Published cohort assumptions." });
  const k12 = [forecast("k1", "2031-32", "K-12", 110), forecast("k2", "2032-33", "K-12", 108)];
  const pk = [forecast("p1", "2031-32", "PK", 20), forecast("p2", "2032-33", "PK", 21)];
  const p = payload([observed], [series([observed]), series(k12), series(pk)], [...k12, ...pk]);
  const view = buildOutlookView(p);
  assert.equal(view.groups.length, 2);
  assert.deepEqual(view.groups.map(group => group.rows.map(row => row.grade_scope)), [["K-12", "K-12"], ["PK", "PK"]]);
  assert.deepEqual(view.groups.flatMap(group => group.rows).map(row => row.observation_id), ["k1", "k2", "p1", "p2"]);
  assert.ok(view.groups.every(group => group.lines.every(line => line.every(row => row.status === "projection"))));
  assert.equal(statusLabel(k12[0]), "Forecast · not an observed count");
  assert.equal(displayValue(k12[0]), "110");
  assert.deepEqual(figureView(view.groups[0], 200).entries.map(entry => entry.status), ["Forecast", "Forecast"]);
  assert.equal(buildHistoryView(p).rows.length, 1);
});

test("the default reading path features attending counts and broad history while retaining every edition in the table", () => {
  const attending = [observation("a1", "2021-22", 110, { series_id: "attending-october" }), observation("a2", "2022-23", 105, { series_id: "attending-october" }), observation("a3", "2023-24", 108, { series_id: "attending-october" }), observation("a4", "2024-25", 101, { series_id: "attending-october" })];
  const broad = Array.from({ length: 10 }, (_, i) => observation(`b${i}`, `${2016 + i}-${17 + i}`, 120 - i, { series_id: "nesdec-2026-history", population_basis: "mixed" }));
  const earlier = [observation("old", "2016-17", 122, { series_id: "wwsu-2016" })];
  const update = [observation("update", "2026-27", 98, { series_id: "september-2026-preliminary", status: "preliminary" })];
  const p = payload([...attending, ...broad, ...earlier, ...update], [series(earlier), series(broad, { connect_points: false }), series(update, { connect_points: false }), series(attending)]);
  const view = buildHistoryView(p);
  assert.deepEqual(view.featuredGroups.map(group => group.series.series_id), ["attending-october", "nesdec-2026-history"]);
  assert.deepEqual(view.otherGroups.map(group => group.series.series_id), ["wwsu-2016", "september-2026-preliminary"]);
  assert.equal(view.rows.length, 16);
  assert.deepEqual(view.featuredGroups[1].lines, []);
  assert.equal(view.takeaway?.first.value, 110);
  assert.equal(view.takeaway?.last.value, 101);
  assert.equal(view.takeaway?.hasRisesAndFalls, true);
  assert.equal(view.takeaway?.first.source_locator, "Table A, 2021-22");
  assert.equal(view.takeaway?.last.source_locator, "Table A, 2024-25");
});

test("takeaways describe only a compatible consecutive segment, never a gap or a status/definition change", () => {
  const rows = [observation("a", "2020-21", 200), observation("b", "2021-22", 190), observation("gap", "2022-23", null),
    observation("c", "2023-24", 100), observation("d", "2024-25", 105), observation("e", "2025-26", 80, { status: "preliminary" })];
  const view = buildHistoryView(payload(rows, [series(rows)]));
  assert.equal(view.takeaway?.first.observation_id, "c");
  assert.equal(view.takeaway?.last.observation_id, "d");
  for (const changed of [{ status: "preliminary" as const }, { population_basis: "includes_other_students" }, { count_basis: "derived_headcount" as const }, { school_year: "2026-27" }]) {
    const isolated = [observation("x", "2023-24", 100), observation("y", "2024-25", 90, changed)];
    assert.equal(buildHistoryView(payload(isolated, [series(isolated)])).takeaway, null);
  }
  assert.equal(buildHistoryView(payload(rows, [series(rows, { connect_points: false })])).takeaway, null);
});

test("phone plot begins with supported counts but preserves internal gaps, explicit zero and withheld states", () => {
  const rows = [observation("early", "2020-21", null), observation("a", "2021-22", 100),
    observation("b", "2022-23", null, { value_state: "suppressed" }), observation("c", "2024-25", 0, { status: "preliminary" }),
    observation("d", "2025-26", null, { value_state: "not_applicable" })];
  const view = buildHistoryView(payload(rows, [series(rows)]));
  const plot = figureView(view.groups[0], 200);
  assert.deepEqual(plot.years, ["2021-22", "2022-23", "2023-24", "2024-25", "2025-26"]);
  assert.deepEqual(plot.entries.map(entry => [entry.year, entry.value, entry.position]), [
    ["2021-22", "100", 50], ["2022-23", "Suppressed", null], ["2023-24", "Not available", null],
    ["2024-25", "0", 0], ["2025-26", "Not applicable", null],
  ]);
  assert.equal(plot.entries[0].status, "Observed");
  assert.equal(plot.entries[3].status, "Preliminary");
  assert.deepEqual(plot.omittedRows.map(row => row.observation_id), ["early"]);
  assert.equal(view.rows.length, 5, "all original records remain available to the semantic table");
});

test("school filtering and single-grade views keep the reading hierarchy and takeaway within the selected entity", () => {
  const district = [observation("d1", "2021-22", 1000), observation("d2", "2022-23", 900)];
  const school = [observation("s1", "2021-22", 50, { entity_id: "north" }), observation("s2", "2022-23", 55, { entity_id: "north" })];
  const grade = [observation("g1", "2022-23", 10, { entity_id: "north", grade_scope: "3" })];
  const p = payload([...district, ...school, ...grade], [series(district), series(school), series(grade)]);
  const view = buildHistoryView(p, "north");
  assert.equal(view.takeaway?.first.value, 50);
  assert.equal(view.takeaway?.last.value, 55);
  assert.ok(view.featuredGroups.every(group => group.series.entity_id === "north"));
  const detail = buildHistoryView(p, "north", "3");
  assert.equal(detail.takeaway, null);
  assert.equal(detail.featuredGroups.length, 1);
  assert.equal(detail.otherGroups.length, 0);
});

test("reader-facing labels and explanations preserve caveats without exposing keys or publisher instructions", () => {
  const row = observation("history", "2023-24", 150, { series_id: "nesdec-2026-history" });
  const group = series([row], { connect_points: false, description: "History as supplied to NESDEC; inconsistent Early College inclusion. 2023–24 is seven above the district headline, unexplained. Show a table or disconnected points, never a common trend line." });
  assert.match(seriesLabel(group), /Historical counts supplied to NESDEC/);
  assert.doesNotMatch(seriesLabel(group), /nesdec 2026 history/);
  assert.match(seriesDescription(group), /seven above.*unexplained/);
  assert.match(seriesDescription(group), /not comparable to.*attending/i);
  assert.doesNotMatch(seriesDescription(group), /Show a table|never a common trend line/);
  assert.doesNotMatch(seriesLabel({ ...group, series_id: "unfamiliar-private-key" }), /unfamiliar|private-key/);
  const p = payload([], []);
  p.schools = [{ school_id: "north", name: "North School" } as SchoolsPayload["schools"][number]];
  const note = recordNote(p, "Sum of same-source school rows north=81|south=90; EC treatment unresolved");
  assert.match(note, /North School: 81/);
  assert.match(note, /Early College treatment unresolved/);
  assert.doesNotMatch(note, /\|/);
  const projectionDescription = seriesDescription({ ...group, description: "Base 150 includes Early College, unlike attending 140. Never connect to attending history." });
  assert.match(projectionDescription, /150.*140/);
  assert.doesNotMatch(projectionDescription, /Never connect/);
});

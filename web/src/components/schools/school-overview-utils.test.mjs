import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// Compile only the pure selector module in memory; no app build or fixtures on disk.
const input = readFileSync(new URL("./school-overview-utils.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(input, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const { groupCampuses, schoolForCampus, resolveEnrollment, enrollmentValue, enrollmentStatus, currentGrades, countDate } =
  await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const reference = { series_id: "attending", entity_id: "middle", school_year: "2025-26", grade_scope: "7-8" };
const observation = {
  ...reference, observation_id: "attending-middle", count_basis: "reported_headcount",
  population_basis: "attending", status: "observed", value_state: "observed", value: 71,
};
const series = {
  ...reference, series_key: "attending-middle", kind: "history", count_basis: "reported_headcount",
  population_basis: "attending", observation_ids: [observation.observation_id],
};

test("a shared campus has one marker group and keeps its two distinct selectable schools", () => {
  const schools = [
    { school_id: "middle", campus_id: "shared" },
    { school_id: "high", campus_id: "shared" },
    { school_id: "primary", campus_id: "primary" },
  ];
  const groups = groupCampuses({
    campuses: [{ campus_id: "shared" }, { campus_id: "primary" }], schools,
    programs: [{ program_id: "alternate", campus_id: "shared", school_id: "high" }],
  });
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].schools.map((school) => school.school_id), ["middle", "high"]);
  assert.equal(schoolForCampus(groups[0], "high"), "high");
  assert.equal(schoolForCampus(groups[0], "primary"), "middle");
  assert.equal(schoolForCampus(groups[1], "high"), "primary");
});

test("current counts resolve every reference field and membership in the exact history series", () => {
  const decoys = [
    { ...observation, observation_id: "other-school", entity_id: "high", value: 401 },
    { ...observation, observation_id: "old-year", school_year: "2024-25", value: 90 },
    { ...observation, observation_id: "grade-only", grade_scope: "7", value: 33 },
    { ...observation, observation_id: "preliminary", series_id: "preliminary", value: 80 },
    { ...observation, observation_id: "not-member", value: 81 },
  ];
  const payload = { enrollment: [...decoys, observation], series: [series], projections: [{ ...observation, status: "projection", count_basis: "projected_headcount", value: 100 }] };
  assert.equal(resolveEnrollment(payload, reference), observation);
  assert.equal(resolveEnrollment(payload, null), null);
  assert.equal(resolveEnrollment({ ...payload, series: [{ ...series, kind: "projection" }] }, reference), null);
  assert.equal(resolveEnrollment({ ...payload, series: [{ ...series, population_basis: "residents" }] }, reference), null);
  assert.equal(resolveEnrollment({ ...payload, series: [{ ...series, count_basis: "derived_headcount" }] }, reference), null);
});

test("missing and suppressed counts never become zero; observed does not mean certified final", () => {
  assert.equal(enrollmentValue(null), "Not available");
  assert.equal(enrollmentValue({ ...observation, value_state: "missing", value: null }), "Not available");
  assert.equal(enrollmentValue({ ...observation, value_state: "suppressed", value: null }), "Suppressed");
  assert.equal(enrollmentValue({ ...observation, value: 0 }), "0");
  assert.equal(enrollmentValue({ ...observation, status: "preliminary", value: 71 }), "71");
  assert.equal(enrollmentStatus(observation), "Observed · final certification unverified");
  assert.equal(enrollmentStatus({ ...observation, status: "preliminary" }), "Preliminary observed count");
});

test("the dated grade configuration is selected without changing payload order", () => {
  const configurations = [
    { school_year: "2020-21", grade_scope: "K-6", verified_at: "2021-01-01" },
    { school_year: "2026-27", grade_scope: "K-4", verified_at: "2026-10-04" },
  ];
  assert.equal(currentGrades({ grade_configurations: configurations }), configurations[1]);
  assert.equal(configurations[0].grade_scope, "K-6");
  assert.equal(currentGrades({ grade_configurations: [] }), null);
});

test("a preliminary report publication day is never substituted for an unknown count day", () => {
  assert.equal(countDate({ ...observation, status: "preliminary", reference_date: null, reference_date_status: "unknown", published_at: "2026-09-09" }), "Exact count day not reported");
  assert.equal(countDate({ ...observation, reference_date: "2025-10-01", reference_date_status: "known" }), "October 1, 2025");
});

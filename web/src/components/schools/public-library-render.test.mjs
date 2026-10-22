import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { registerHooks } from "node:module";

test("large library renders cited, core and reviewed-report anchors in initial HTML without mounting the archive", async () => {
  // Node does not load CSS modules; this test checks server markup, not styles.
  const hooks = registerHooks({ load(url, context, nextLoad) {
    return url.endsWith(".module.css") ? { format: "commonjs", source: "module.exports = {}", shortCircuit: true } : nextLoad(url, context);
  } });
  const { SourceNotes } = await import("./SourceNotes.tsx");
  hooks.deregister();
  const collections = i => i < 25 ? ["core"] : i < 32 ? ["reviewed_report"] : ["historical_board"];
  const payload = {
    schema_version: 1, dataset_date: "2026-10-20", content_digest: "synthetic-library",
    schools: [], campuses: [], programs: [], enrollment: [], projections: [], series: [], notes: [],
    sources: Array.from({ length: 1157 }, (_, i) => ({ source_id: `synthetic-${i}`, title: `Synthetic public record ${i}`,
      url: `https://example.org/${i}`, published_at: null, reviewed_at: "2026-10-20", locators: [],
      library: { category: i < 10 ? "Enrollment" : "Governance", body: "Synthetic board", kind: "Minutes", school_year: "2025-26",
        document_date: null, meetings: [], collections: collections(i) } })),
  };
  payload.enrollment.push({ observation_id: "cited", series_id: "synthetic", entity_id: "huusd", school_year: "2025-26",
    grade_scope: "K-12", reference_date: null, reference_date_status: "unknown", population_basis: "synthetic",
    count_basis: "reported_headcount", value: 10, value_state: "observed", status: "observed", source_id: "synthetic-1000", source_locator: "Synthetic table, row 1", notes: "Synthetic fixture only" });
  const before = JSON.stringify(payload);
  const html = renderToStaticMarkup(createElement(SourceNotes, { payload, releaseId: "synthetic-release" }));
  assert.equal(JSON.stringify(payload), before, "rendering must not mutate the payload");
  for (const i of [...Array.from({ length: 32 }, (_, i) => i), 1000]) {
    assert.equal(html.split(`id="source-synthetic-${i}"`).length - 1, 1, `source ${i}`);
  }
  assert.equal((html.match(/id="source-/g) ?? []).length, 33);
  assert.ok(!html.includes('id="source-synthetic-1001"'));
  assert.match(html, /Synthetic table, row 1/);
  assert.match(html, /1,157/);
  assert.doesNotMatch(html, /Reviewed/);
  // Browsing views load from /api/schools/library; no unpinned record is rendered up front.
  assert.ok(!html.includes("Synthetic public record 1001"));
  assert.match(html, /Loading…/);
});

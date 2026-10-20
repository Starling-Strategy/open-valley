import { expect, test } from "@playwright/test";
import { buildLibraryCatalog, isPinnedDocument, payloadReferences } from "../src/lib/schools-library";
import type { AnswerKind, AskCitation, AskResponse } from "../src/lib/schools-ask";

test("public library filters, meeting archive and proof inspector work", async ({ page }) => {
  await page.goto("/schools");
  const { payload } = await (await page.request.get("/api/schools")).json();
  const catalog = buildLibraryCatalog(payload.sources, payloadReferences(payload));
  const library = page.locator("#school-sources");
  await expect(library.getByRole("heading", { name: "Public Library & Meeting Archive", exact: true })).toBeVisible();
  await library.getByRole("button", { name: "Building Use & Visioning", exact: true }).click();
  await expect(library.locator("[data-library-results] > li")).toHaveCount(Math.min(25, catalog.counts.buildingUse));
  await library.getByRole("button", { name: "Meetings timeline", exact: true }).click();
  await expect(library.getByLabel("Meeting body")).toBeVisible();
  if (catalog.meetings.length) {
    await library.getByLabel("Meeting body").selectOption(catalog.meetings[0].body);
    await library.getByLabel("Meeting date").fill(catalog.meetings[0].date);
    await expect(library).toContainText(catalog.meetings[0].body);
  }
  await library.getByRole("button", { name: "All library documents", exact: true }).click();
  await expect(library.locator("[data-library-results] > li")).toHaveCount(Math.min(25, catalog.counts.total));
  if (catalog.counts.total > 25) {
    await library.getByRole("button", { name: "Show more documents" }).click();
    await expect(library.locator("[data-library-results] > li")).toHaveCount(Math.min(50, catalog.counts.total));
  }
  await library.getByLabel("Body", { exact: true }).selectOption(catalog.documents[0].body);
  await library.getByLabel("Kind", { exact: true }).selectOption(catalog.documents[0].kind);
  await library.getByLabel("Category", { exact: true }).selectOption(catalog.documents[0].category);
  await library.getByLabel("School Year", { exact: true }).selectOption(catalog.documents[0].school_year);
  await library.getByLabel("Search library").fill(catalog.documents[0].title);
  await expect(library.locator("[data-library-results]")).toContainText(catalog.documents[0].title);
  await library.locator("[data-library-results]").getByRole("button", { name: "Inspect record" }).first().click();
  await expect(library.getByRole("region", { name: "Source record" })).toContainText("Page locators");
  await library.getByLabel("Search library").fill("no-matching-document-xyz");
  await expect(library.getByText("No documents match these filters.")).toBeVisible();
});

type Reply = { status: number; json: unknown };

/** Serve contract-shaped replies from a queue; the assistant service is not started in browser tests. */
async function mockAssistant(page: import("@playwright/test").Page, replies: Reply[]) {
  const requests: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  await page.route("**/api/schools/ask", async route => {
    requests.push(route.request().postDataJSON());
    const reply = replies.shift() ?? { status: 503, json: { status: "unavailable" } };
    await route.fulfill({ status: reply.status, json: reply.json, headers: { "Cache-Control": "no-store" } });
  });
  return requests;
}

async function schoolsPage(page: import("@playwright/test").Page) {
  await page.goto("/schools");
  const releaseId = (await page.locator("[data-release-id]").getAttribute("data-release-id"))!;
  const { payload } = await (await page.request.get("/api/schools")).json();
  return { releaseId, sources: payload.sources as Array<{ source_id: string; title: string; url: string }> };
}

function reply(releaseId: string, answer_kind: AnswerKind, text: string, citations: AskCitation[] = [], follow_up_suggestions: string[] = []): Reply {
  const json: AskResponse = { release_id: releaseId, answer_kind, text, citations, follow_up_suggestions, unanswered_logged: false };
  return { status: 200, json };
}

test("Ask the record renders a cited conversation from the assistant service", async ({ page }) => {
  const { releaseId, sources } = await schoolsPage(page);
  const [first, second] = [sources[0], sources[1] ?? sources[0]];
  const citation = (marker: number, source: typeof first, pages: [number | null, number | null]): AskCitation => ({
    marker, passage_id: `passage-${marker}`, source_id: source.source_id, title: source.title, url: source.url,
    page_start: pages[0], page_end: pages[1], quote: `Synthetic quoted passage ${marker}.`, kind: "Report", body: "HUUSD Board", document_date: "2025-10-01" });
  const requests = await mockAssistant(page, [
    reply(releaseId, "answered", "Attending enrollment was **1,578** in 2025–26 [1].\n\n- Earlier counts use other definitions [2]\n- Forecasts are separate [9]",
      [citation(1, first, [3, 4]), citation(2, second, [7, 7])], ["What does the NESDEC forecast say?"]),
    reply(releaseId, "documents_found", "These records discuss the question [1].", [citation(1, second, [null, null])]),
  ]);
  const assistant = page.locator("#ask-the-record");
  await expect(assistant).toContainText("Answers are written by AI from public records");
  await expect(assistant).toContainText("Open Valley is independent of HUUSD");
  await assistant.getByRole("button", { name: "How has district K–12 enrollment changed since 2021–22?", exact: true }).click();
  await expect(assistant.getByText("Answer drawn from the cited records", { exact: true })).toBeVisible();
  expect(requests[0]).toEqual({ messages: [{ role: "user", content: "How has district K–12 enrollment changed since 2021–22?" }] });
  const transcript = assistant.getByRole("list", { name: "Conversation" });
  await expect(transcript).toContainText("You asked");
  await expect(transcript.locator("strong", { hasText: "1,578" })).toBeVisible();
  await expect(transcript.locator("ul > li")).toHaveCount(2);
  const marker = transcript.locator("sup a", { hasText: "[1]" });
  await expect(marker).toHaveAttribute("href", "#answer-1-citation-1");
  await expect(transcript.getByText("Forecasts are separate [9]")).toBeVisible();
  const card = page.locator("#answer-1-citation-1");
  await expect(card).toContainText(first.title);
  await expect(card).toContainText("Report · HUUSD Board · ");
  await expect(card).toContainText("pp. 3–4");
  await expect(card.locator("blockquote")).toHaveText("Synthetic quoted passage 1.");
  await expect(card.getByRole("link", { name: "Open original ↗" })).toHaveAttribute("href", first.url);
  await expect(page.locator("#answer-1-citation-2")).toContainText("p. 7");
  await marker.click();
  await expect(page).toHaveURL(/#answer-1-citation-1$/);
  await card.getByRole("link", { name: "Find in library" }).click();
  await expect(page.getByRole("region", { name: "Source record" })).toContainText(first.title);

  const question = assistant.getByLabel("Your question");
  await question.fill("First line");
  await question.press("Shift+Enter");
  await question.pressSequentially("second line");
  await expect(question).toHaveValue("First line\nsecond line");
  expect(requests).toHaveLength(1);
  await question.press("Enter");
  await expect(assistant.getByText("Relevant records found — no written answer", { exact: true })).toBeVisible();
  expect(requests[1].messages.map(m => m.role)).toEqual(["user", "assistant", "user"]);
  expect(requests[1].messages[2].content).toBe("First line\nsecond line");
  await expect(page.locator("#answer-3-citation-1")).not.toContainText(/p\. |pp\. /);
  await expect(question).toHaveValue("");
});

test("Ask the record shows each answer status, errors and release changes", async ({ page }) => {
  const { releaseId } = await schoolsPage(page);
  await mockAssistant(page, [
    reply(releaseId, "not_in_record", "The published record does not say."),
    reply(releaseId, "declined", "This assistant does not discuss individual students."),
    reply(releaseId, "homes_redirect", "Housing questions belong to the Homes research."),
    { status: 429, json: { status: "rate_limited" } },
    { status: 503, json: { status: "unavailable" } },
    reply("a-newer-release", "answered", "Stale [1]."),
  ]);
  const assistant = page.locator("#ask-the-record");
  const question = assistant.getByLabel("Your question");
  const send = async (text: string) => { await question.fill(text); await assistant.getByRole("button", { name: "Ask the record", exact: true }).click(); };
  for (const [text, label] of [["Cafeteria menu?", "The published record doesn't answer this"],
    ["A student's records?", "Outside what this assistant covers"], ["Warren property assessments?", "Homes research is in progress"]]) {
    await send(text);
    await expect(assistant.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(assistant.locator('a[href="/homes"]')).toBeVisible();
  await send("Too many?");
  await expect(assistant.getByRole("status")).toContainText("wait a minute");
  await expect(question).toHaveValue("Too many?");
  await send("Service down?");
  await expect(assistant.getByRole("status")).toContainText("The assistant is unavailable right now.");
  await send("Changed release?");
  await expect(assistant.getByRole("status")).toContainText("The published record has changed since this page loaded.");
  await expect(assistant.getByRole("button", { name: "Reload page" })).toBeVisible();
  await expect(assistant.getByRole("button", { name: "Ask the record", exact: true })).toBeDisabled();
  await expect(assistant).not.toContainText("Stale");
});

test("the ask endpoint fails closed without an assistant service and pages show no review dates", async ({ page, request }) => {
  const response = await request.post("/api/schools/ask", { data: { messages: [{ role: "user", content: "How many students?" }] } });
  expect([429, 503]).toContain(response.status());
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect((await request.post("/api/schools/ask", { data: { question: "old shape" } })).status()).toBeGreaterThanOrEqual(400);
  await page.goto("/schools");
  await expect(page.locator("main, body").first()).not.toContainText(/Reviewed by Open Valley|Reviewed:/);
});

// Automated reflow checks use synthetic tiles; live basemap review is separate.
test.beforeEach(async ({ page }) => {
  await page.route("https://tile.openstreetmap.org/**", (route) => route.fulfill({
    contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN49+YxAAWJAr5XcdpqAAAAAElFTkSuQmCC", "base64"),
  }));
});

test("school-first navigation reaches the database-backed reading page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Start with our schools/ }).click();
  await expect(page).toHaveURL(/\/schools$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/schools/i);
  await expect(page.locator("#school-directory")).toBeVisible();
  await expect(page.locator("#enrollment-history")).toBeVisible();
  await expect(page.locator("#enrollment-outlook")).toBeVisible();
  await expect(page.locator("#sources")).toBeVisible();
});

test("school responses are request-time and private routes stay unavailable", async ({ request }) => {
  for (const path of ["/schools", "/api/schools"]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");
    const rsc = await request.get(path, { headers: { RSC: "1", "Next-Router-Prefetch": "1" } });
    expect(rsc.headers()["cache-control"]).toContain("no-store");
  }
  for (const path of ["/admin/str-review", "/api/admin/str-review", "/awp", "/api/awp/test", "/api/api/admin/test", "/chat", "/api/copilotkit"]) {
    const response = await request.get(path, { headers: { RSC: "1" } });
    expect(response.status()).toBe(404);
    expect(response.headers()["cache-control"]).toContain("no-store");
  }
});

test("Homes research and public assessment search remain reachable", async ({ page }) => {
  for (const path of ["/homes", "/story", "/data", "/learn", "/learn/methodology", "/explore?q=Main"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
});

for (const width of [320, 390, 768, 1440]) {
  test(`school page reflows at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/schools");
    await expect(page.locator("#school-directory")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const library = page.locator("#school-sources");
    await library.getByRole("button", { name: "All library documents", exact: true }).click();
    await library.locator("[data-library-results]").getByRole("button", { name: "Inspect record" }).first().click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("directory and markers select the same school; history has independent filters", async ({ page }) => {
  await page.goto("/schools");
  const { payload } = await (await page.request.get("/api/schools")).json();
  const school = payload.schools[0];
  const toggle = page.locator(`#school-toggle-${school.school_id}`);
  await toggle.click();
  await expect(page.locator(`#school-profile-${school.school_id}`)).toBeVisible();
  await expect(page.getByLabel("School or district", { exact: true })).toHaveValue("huusd");
  await page.getByRole("button", { name: "All district schools", exact: true }).click();
  await expect(page.locator(`#school-profile-${school.school_id}`)).not.toBeVisible();
  await page.getByRole("button", { name: new RegExp(`Campus \\d+: ${school.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).click();
  await expect(page.locator(`#school-profile-${school.school_id}`)).toBeVisible();
  await page.getByLabel("School or district", { exact: true }).selectOption(school.school_id);
  await expect(page.locator("#enrollment-history h3").first()).toContainText(school.name);
  await page.locator("#enrollment-history summary").filter({ hasText: "Enrollment data table" }).click();
  await expect(page.locator("#enrollment-history table caption")).toContainText(school.name);
});

test("map failure preserves the directory and scrollable source tables", async ({ page }) => {
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  await page.goto("/schools");
  await expect(page.getByRole("heading", { name: "Map unavailable" })).toBeVisible();
  const first = page.locator("#school-list summary").first();
  await first.click();
  await expect(page.locator("#school-list details[open] [id^=school-profile-]")).toBeVisible();
  await page.locator("#enrollment-history summary").filter({ hasText: "Enrollment data table" }).click();
  await expect(page.locator("#enrollment-history table")).toBeVisible();
});

test("keyboard focus, reduced motion and forced colors retain usable controls", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active", colorScheme: "dark" });
  await page.goto("/schools");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  const first = page.locator("#school-list summary").first();
  await first.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#school-list details[open] [id^=school-profile-]")).toBeVisible();
  expect(await first.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe("none");
  await expect(first).toBeFocused();
  const ask = page.locator("#schools-question");
  await ask.focus();
  expect(await ask.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe("none");
});

test("a failed map worker leaves school facts usable", async ({ page }) => {
  await page.route("**/maplibre/maplibre-gl-worker.mjs", route => route.abort());
  await page.goto("/schools");
  await expect(page.getByRole("heading", { name: "Map unavailable" })).toBeVisible();
  await page.locator("#school-list summary").first().click();
  await expect(page.locator("#school-list details[open] [id^=school-profile-]")).toBeVisible();
});

test("an unchanged eligibility refresh preserves the map and keyboard focus", async ({ page }) => {
  const isRefresh = (response: { url(): string; headers(): Record<string, string> }) =>
    response.url().includes("/schools?") && response.headers()["content-type"]?.includes("text/x-component");
  // The router may stop reading a refresh stream it no longer needs, so `finished()` is not
  // guaranteed; wait for the response, then give the stream a bounded time to settle.
  const settled = (response: { finished(): Promise<unknown> }) =>
    Promise.race([response.finished(), new Promise(resolve => setTimeout(resolve, 2_000))]);
  // The page refreshes once on mount; a focus event during that request starts no second one.
  const mountRefresh = page.waitForResponse(isRefresh);
  await page.goto("/schools");
  await settled(await mountRefresh);
  const marker = page.getByRole("button", { name: /Campus 1:/ });
  await expect(marker).toBeVisible();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await marker.focus();
  await page.locator("canvas.maplibregl-canvas").evaluate(canvas => { canvas.dataset.sameMap = "true"; });
  const response = page.waitForResponse(isRefresh);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await settled(await response);
  await page.evaluate(() => new Promise(resolve => requestIdleCallback(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
  await expect(page.locator("canvas.maplibregl-canvas")).toHaveAttribute("data-same-map", "true");
  await expect(marker).toBeFocused();
});

test("a shared campus keeps each school's profile and selection distinct", async ({ page }) => {
  const { payload } = await (await page.request.get("/api/schools")).json();
  const shared = payload.campuses.find((campus: { campus_id: string }) =>
    payload.schools.filter((school: { campus_id: string }) => school.campus_id === campus.campus_id).length > 1);
  test.skip(!shared, "This publication has no shared campus.");
  const schools = payload.schools.filter((school: { campus_id: string }) => school.campus_id === shared.campus_id);
  await page.goto("/schools");
  for (const school of schools) {
    await page.locator(`#school-toggle-${school.school_id}`).click();
    await expect(page.locator(`#school-profile-${school.school_id}`)).toBeVisible();
    const marker = page.getByRole("button", { name: /Campus \d+:/ }).filter({ hasText: String(payload.campuses.indexOf(shared) + 1) });
    await expect(marker).toHaveAttribute("aria-pressed", "true");
    await marker.click();
    await expect(page.locator(`#school-profile-${school.school_id}`)).toBeVisible();
    await expect(page.locator("#school-list [id^=school-profile-]:visible")).toHaveCount(1);
  }
});

test("school facts and tables remain readable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(`${process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3100"}/schools`);
    await page.locator("#school-list summary").first().click();
    await expect(page.locator("#school-list details[open] [id^=school-profile-]")).toBeVisible();
    await page.locator("#enrollment-history summary").filter({ hasText: "Enrollment data table" }).click();
    await expect(page.locator("#enrollment-history table")).toBeVisible();
    await expect(page.locator("#sources a").first()).toBeVisible();
    const { payload } = await (await page.request.get("/api/schools")).json();
    const catalog = buildLibraryCatalog(payload.sources, payloadReferences(payload));
    for (const source of catalog.documents.filter(isPinnedDocument)) {
      await expect(page.locator(`[id="source-${source.source_id}"]`)).toHaveCount(1);
    }
    if (catalog.counts.total > 100) {
      expect(await page.locator("#school-sources [id^=source-]").count()).toBeLessThan(catalog.counts.total);
    }
  } finally { await context.close(); }
});

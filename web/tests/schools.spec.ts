import { expect, test } from "@playwright/test";

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
});

test("a failed map worker leaves school facts usable", async ({ page }) => {
  await page.route("**/maplibre/maplibre-gl-worker.mjs", route => route.abort());
  await page.goto("/schools");
  await expect(page.getByRole("heading", { name: "Map unavailable" })).toBeVisible();
  await page.locator("#school-list summary").first().click();
  await expect(page.locator("#school-list details[open] [id^=school-profile-]")).toBeVisible();
});

test("an unchanged eligibility refresh preserves the map and keyboard focus", async ({ page }) => {
  await page.goto("/schools");
  const marker = page.getByRole("button", { name: /Campus 1:/ });
  await expect(marker).toBeVisible();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await marker.focus();
  await page.locator("canvas.maplibregl-canvas").evaluate(canvas => { canvas.dataset.sameMap = "true"; });
  const response = page.waitForResponse(response => response.url().includes("/schools?") && response.headers()["content-type"]?.includes("text/x-component"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await (await response).finished();
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
  } finally { await context.close(); }
});

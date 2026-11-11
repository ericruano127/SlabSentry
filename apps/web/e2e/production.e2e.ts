import { db } from "./helpers";
import { expect, test } from "./fixtures";

/**
 * Runs against a PRODUCTION build (`next build && next start`; see the `e2e` CI job), where the policy
 * is stricter than in development: no eval, and <style> elements need the nonce. Development sign-in
 * is refused in production, so this covers the signed-out pages and a shared report; signed-in pages
 * use the same layout and policy and are exercised in development by the other tests.
 * Fails on any Content-Security-Policy violation (e2e/fixtures.ts).
 */
const pages: [string, RegExp][] = [
  ["/", /Verify|slab/i], ["/login", /Welcome back/], ["/signup", /Create your free account/], ["/pricing", /Plans for every collector/],
  ["/legal/terms", /Terms/], ["/legal/privacy", /Privacy/], ["/whats-new", /new/i], ["/reset-password", /password/i],
];

test.describe("production build", () => {
  test("strict policy: no eval, nonce-only <style> elements", async ({ request }) => {
    const csp = (await request.get("/")).headers()["content-security-policy"];
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toMatch(/style-src-elem 'self' 'nonce-[^']+'(;|$)/);
    expect(csp).toContain("upgrade-insecure-requests");
  });

  for (const [path, heading] of pages) {
    test(`${path} works under the policy`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText(heading);
      await page.waitForLoadState("networkidle");
    });
  }

  test("pricing loads plans (client scripts and API calls work)", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByRole("heading", { name: "Collector Pro" })).toBeVisible();
  });

  test("a shared report renders", async ({ page }) => {
    const [row] = await db(`select share_token from verification_reports where share_token is not null limit 1`);
    test.skip(!row, "needs a shared report in the database (created by the development tests)");
    await page.goto(`/r/${row.share_token}`);
    await expect(page.locator("#summary")).toBeVisible();
  });
});

import { randomUUID } from "node:crypto";
import path from "node:path";
import pg from "pg";
import { expect, type BrowserContext, type Page } from "@playwright/test";

export const FIXTURES = process.env.FIXTURES_DIR ?? "/tmp/fixtures";
export const fixture = (name: string) => path.join(FIXTURES, name);

let client: pg.Client | null = null;
/** Direct database access for test setup (e.g. using up a user's free credits). */
export async function db<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (!client) {
    client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/slabguard_e2e" });
    await client.connect();
  }
  return (await client.query(sql, params)).rows;
}

/**
 * Signs a brand-new user in with the development sign-in, accepting the current Terms and Privacy Policy
 * through the API (the sign-up test covers the consent screen itself). Returns the user id.
 */
export async function signInNewUser(context: BrowserContext, baseURL: string) {
  const id = randomUUID();
  await context.addCookies([{ name: "dev_user", value: id, url: baseURL }]);
  const headers = { cookie: `dev_user=${id}` };
  const st = await (await context.request.get("/api/consent", { headers })).json();
  if (st.required) {
    const r = await context.request.post("/api/consent", { headers, data: { terms: st.terms.current, privacy: st.privacy.current } });
    expect(r.ok()).toBeTruthy();
  }
  return id;
}

/** The capture card for one photo slot, by its heading. */
export const captureCard = (page: Page, heading: string) =>
  page.locator(".capture").filter({ has: page.getByRole("heading", { name: heading, exact: true }) });

/** Uploads a photo through the slot's file input and waits for the quality check result. */
export async function uploadPhoto(page: Page, heading: string, file: string) {
  const card = captureCard(page, heading);
  await card.locator('input[type="file"]').setInputFiles(fixture(file));
  await expect(card.getByText(/Photo looks good|Retake needed|Tip:/).first()).toBeVisible({ timeout: 60_000 });
  return card;
}

/** Runs a quick in-hand scan up to the "Analyze" click: front + back, label read, certification confirmed. */
export async function quickScanToConfirm(page: Page) {
  await page.goto("/scan");
  await page.getByRole("button", { name: /^In hand/ }).click();
  await uploadPhoto(page, "Front", "front_genuine.jpg");
  await uploadPhoto(page, "Back", "front_different_card.jpg");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Read label" }).click();
  await expect(page.getByRole("heading", { name: "Confirm certification" })).toBeVisible({ timeout: 60_000 });
  // The certification number is read from the slab's QR code; the grader is detected from the label.
  await expect(page.getByLabel("Certification number")).toHaveValue("12345678");
  await page.getByLabel("Grading company").selectOption("PSA");
  await page.getByLabel("Grade on label (for market value)").fill("10");
}

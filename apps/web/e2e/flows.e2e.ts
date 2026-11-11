import { expect, test } from "@playwright/test";
import { db, quickScanToConfirm, signInNewUser, uploadPhoto } from "./helpers";

test.describe("sign up", () => {
  test("new user signs up, accepts the terms and lands on the dashboard @phone", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /^Start free/ }).click();
    await expect(page).toHaveURL(/\/signup/);
    await expect(page.getByRole("heading", { name: "Create your free account" })).toBeVisible();
    await page.getByRole("button", { name: "Continue as local dev user" }).click();

    // First visit: the consent screen blocks the app until the Terms and Privacy Policy are accepted.
    const agree = page.getByRole("button", { name: "Agree and continue" });
    await expect(agree).toBeDisabled();
    await page.getByRole("checkbox").first().check();
    await agree.click();
    await expect(agree).toBeHidden(); // the page reloads once the consent is saved
    await page.waitForLoadState("load");

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("link", { name: "Scan new slab" })).toBeVisible();
    await expect(page.getByText(/No scans yet/)).toBeVisible();
    await page.getByRole("link", { name: "Scan new slab" }).click();
    await expect(page.getByText("3 verifications available")).toBeVisible();
  });
});

test.describe("scan and report", () => {
  test("quick scan → report → history, using one credit", async ({ page, context, baseURL }) => {
    await signInNewUser(context, baseURL!);
    await quickScanToConfirm(page);
    await page.getByRole("button", { name: "Analyze (quick scan)" }).click();

    await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/);
    const summary = page.locator("#summary");
    await expect(summary).toBeVisible({ timeout: 90_000 }); // analysis runs in the background
    await expect(page.getByText(/PSA 12345678/).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recommended next action" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Photo quality" })).toBeVisible();

    // The report is in History, and exactly one credit was used.
    await page.goto("/history");
    await expect(page.getByRole("link", { name: /PSA 12345678/ })).toBeVisible();
    await page.goto("/scan");
    await expect(page.getByText("2 verifications available")).toBeVisible();
  });

  test("a blurry photo gets retake guidance before any credit is used @phone", async ({ page, context, baseURL }) => {
    await signInNewUser(context, baseURL!);
    await page.goto("/scan");
    await page.getByRole("button", { name: /^In hand/ }).click();
    const card = await uploadPhoto(page, "Front", "front_blurry.jpg");
    await expect(card.getByRole("alert").first()).toContainText(/Retake needed|Tip:/);
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled(); // back photo still missing
    await expect(page.getByText("3 verifications available")).toBeVisible();
  });

  test("share link shows the report signed out, without photos or personal data", async ({ page, context, baseURL, browser }) => {
    const userId = await signInNewUser(context, baseURL!);
    await quickScanToConfirm(page);
    await page.getByRole("button", { name: "Analyze (quick scan)" }).click();
    await expect(page.locator("#summary")).toBeVisible({ timeout: 90_000 });
    const headline = (await page.locator("#summary").textContent())!.trim();

    await page.getByRole("button", { name: "Share" }).click();
    const link = page.getByRole("status").getByRole("link");
    await expect(link).toHaveAttribute("href", /\/r\/[^/]+$/);
    const url = new URL((await link.getAttribute("href"))!);

    const anon = await browser.newContext(); // no sign-in cookie
    const pub = await anon.newPage();
    await pub.goto(url.pathname);
    await expect(pub.getByText(headline).first()).toBeVisible();
    const html = await pub.content();
    expect(html).not.toContain(userId);
    expect(html).not.toMatch(/@example\.com|\/api\/images\//);
    await expect(pub.locator("main img")).toHaveCount(0);
    await anon.close();
  });

  test("out of free credits: analysis is refused with an upgrade prompt", async ({ page, context, baseURL }) => {
    const userId = await signInNewUser(context, baseURL!);
    await page.goto("/dashboard"); // creates the free allowance
    await expect(page.getByRole("link", { name: "Scan new slab" })).toBeVisible();
    await db(`update verification_allowances set used = granted where user_id = $1 and kind = 'lifetime_free'`, [userId]);

    await quickScanToConfirm(page);
    await expect(page.getByText("0 verifications available")).toBeVisible();
    await page.getByRole("button", { name: "Analyze (quick scan)" }).click();
    await expect(page.getByRole("link", { name: /upgrade|see plans|view plans/i }).first()).toBeVisible();
    await expect(page).toHaveURL(/\/scan/); // no report was started
  });
});

test.describe("plans", () => {
  test("signed out: choosing the free plan goes to sign-up", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByRole("heading", { name: "Collector Pro" })).toBeVisible();
    await page.getByRole("button", { name: "Start free" }).click();
    await expect(page).toHaveURL(/\/signup/);
  });

  test("free user upgrades: monthly and annual prices start checkout with the right price @phone", async ({ page, context, baseURL }) => {
    await signInNewUser(context, baseURL!);
    // Stripe isn't used in tests: capture the checkout request and send the browser to a stand-in page.
    const asked: string[] = [];
    await page.route("**/api/billing/checkout", async (route) => {
      asked.push(route.request().postDataJSON().priceId);
      await route.fulfill({ json: { url: `${baseURL}/dashboard?checkout=stub` } });
    });
    await page.goto("/pricing");
    const pro = page.locator(".plan").filter({ has: page.getByRole("heading", { name: "Collector Pro" }) });
    await expect(pro.getByText("Your plan")).toHaveCount(0);
    await expect(page.locator(".plan").filter({ has: page.getByRole("heading", { name: "Free" }) }).getByRole("button")).toHaveText("Current plan");
    await expect(pro.locator(".price")).toContainText("9.99");
    await pro.getByRole("button", { name: "Upgrade" }).click();
    await expect(page).toHaveURL(/checkout=stub/);

    await page.goto("/pricing");
    await page.getByRole("button", { name: /^Annual/ }).click();
    await expect(pro.locator(".price")).toContainText("99");
    await pro.getByRole("button", { name: "Upgrade" }).click();
    await expect(page).toHaveURL(/checkout=stub/);
    expect(asked).toEqual(["pro_month", "pro_year"]);
  });
});

test.describe("account", () => {
  test("download my data, then delete the account", async ({ page, context, baseURL }) => {
    const userId = await signInNewUser(context, baseURL!);
    await page.goto("/account");
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download my data" }).click();
    expect((await dl).suggestedFilename()).toBe("slabguard-data.zip");

    const del = page.getByRole("button", { name: "Delete account" });
    await expect(del).toBeDisabled();
    await page.getByLabel("Type DELETE to confirm").fill("DELETE");
    page.once("dialog", (d) => d.accept());
    await del.click();
    await expect(page).toHaveURL(new URL("/", baseURL).href);
    expect(await db(`select 1 from app_users where id = $1`, [userId])).toHaveLength(0);
  });
});


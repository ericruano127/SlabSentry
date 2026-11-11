import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Results go OUTSIDE the app folder: the development server reloads pages when files in it change.
const OUT = process.env.E2E_OUT ?? path.join(os.tmpdir(), "slabguard-e2e");

/**
 * Browser end-to-end tests of the main flows (e2e/*.e2e.ts).
 * They run against a DEVELOPMENT server with test sign-in and the vision service; see docs/TESTING.md.
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.e2e\.ts$/,
  globalSetup: "./e2e/global-setup.ts",
  outputDir: path.join(OUT, "test-results"),
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: path.join(OUT, "report") }]] : "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: process.env.CI ? "retain-on-failure" : "off",
    screenshot: "only-on-failure",
  },
  projects: [
    // Development server (test sign-in): every flow.
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /production\.e2e\.ts/ },
    { name: "phone", use: { ...devices["Pixel 7"] }, grep: /@phone/, testIgnore: /production\.e2e\.ts/ },
    // Production build, only when PROD_BASE_URL is set: the strict production Content-Security-Policy.
    ...(process.env.PROD_BASE_URL ? [{ name: "production", use: { ...devices["Desktop Chrome"], baseURL: process.env.PROD_BASE_URL }, testMatch: /production\.e2e\.ts/ }] : []),
  ],
});

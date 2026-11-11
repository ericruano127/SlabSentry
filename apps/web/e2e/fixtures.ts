import { test as base, expect } from "@playwright/test";

/**
 * Every browser test fails if any page reports a Content-Security-Policy violation, so the strict
 * policy (lib/csp.ts) is exercised by every flow. Tests that trigger a violation on purpose can
 * call `allowCspViolations()`.
 */
export const test = base.extend<{ cspViolations: string[]; allowCspViolations: () => void }>({
  cspViolations: [async ({ context }, use) => {
    const seen: string[] = [];
    const watch = (p: import("@playwright/test").Page) =>
      p.on("console", (m) => { if (m.type() === "error" && /Content Security Policy/i.test(m.text())) seen.push(`${p.url()}: ${m.text().slice(0, 300)}`); });
    context.pages().forEach(watch);
    context.on("page", watch);
    await use(seen);
  }, { auto: true }],
  allowCspViolations: async ({ cspViolations }, use) => {
    let allowed = false;
    await use(() => { allowed = true; });
    if (!allowed) expect(cspViolations, "Content-Security-Policy violations").toEqual([]);
  },
});

// Make the check run for every test, even ones that don't ask for allowCspViolations.
test.afterEach(async ({ allowCspViolations }) => { void allowCspViolations; });

export { expect };

#!/usr/bin/env node
/**
 * Accessibility audit (WCAG 2.0/2.1/2.2 A + AA) with axe-core, plus a keyboard walk.
 * Runs against a DEVELOPMENT server (dev sign-in) and exits 1 on any violation.
 *
 *   AUTH_MODE=dev next dev -p 3000          # in another terminal
 *   node scripts/a11y-audit.mjs [--make-admin] [--session <id>] [--share <token>]
 *
 * Scans each page in light + dark (desktop) and light (phone), signed out / signed in / as staff.
 * Keyboard: Tab through every page; each stop must show a focus indicator, focus must never get stuck,
 * and the first stop must be the "Skip to main content" link.
 * --make-admin gives the audit's staff user the admin role (needs DATABASE_URL; for CI/fresh databases).
 */
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const B = process.env.BASE_URL ?? "http://localhost:3000";
const USER = process.env.A11Y_USER ?? "00000000-0000-4000-8000-0000000a11e1";
const ADMIN = process.env.A11Y_ADMIN ?? "00000000-0000-4000-8000-0000000a11e2";
const SESSION = opt("session"), SHARE = opt("share");
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const pages = [
  ["anon", "/"], ["anon", "/login"], ["anon", "/signup"], ["anon", "/pricing"], ["anon", "/reset-password"],
  ["anon", "/legal/terms"], ["anon", "/legal/privacy"], ["anon", "/whats-new"],
  ["user", "/dashboard"], ["user", "/scan"], ["user", "/history"], ["user", "/account"], ["user", "/bulk"],
  ["admin", "/admin"], ["admin", "/admin/library"], ["admin", "/admin/quality"], ["admin", "/admin/templates"],
];
if (SESSION) pages.push(["user", `/sessions/${SESSION}`]);
if (SHARE) pages.push(["anon", `/r/${SHARE}`]);

const cookie = (id) => `dev_user=${id}; dev_aal=aal2`;
async function onboard(id) {
  const st = await (await fetch(`${B}/api/consent`, { headers: { cookie: cookie(id) } })).json();
  if (st.required) await fetch(`${B}/api/consent`, { method: "POST", headers: { cookie: cookie(id), "content-type": "application/json" }, body: JSON.stringify({ terms: st.terms.current, privacy: st.privacy.current }) });
}

async function main() {
  for (const id of [USER, ADMIN]) await onboard(id); // also creates the accounts
  if (args.includes("--make-admin")) {
    const { default: pg } = await import("pg");
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect(); await c.query(`update app_users set role='admin' where id=$1`, [ADMIN]); await c.end();
  }
  const browser = await chromium.launch();
  const failures = [];
  const runs = [["light", 1280, 900, "desktop"], ["dark", 1280, 900, "desktop"], ["light", 390, 844, "phone"]];
  for (const [scheme, w, h, view] of runs) for (const role of ["anon", "user", "admin"]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
    if (role !== "anon") await ctx.addCookies([{ name: "dev_user", value: role === "admin" ? ADMIN : USER, url: B }, { name: "dev_aal", value: "aal2", url: B }]);
    const p = await ctx.newPage();
    for (const [, path] of pages.filter((x) => x[0] === role)) {
      const where = `${path} (${scheme}/${view})`;
      await p.goto(B + path, { waitUntil: "networkidle", timeout: 120_000 });
      await p.waitForTimeout(700);
      const ax = await new AxeBuilder({ page: p }).withTags(TAGS).exclude("nextjs-portal").analyze();
      for (const v of ax.violations) failures.push(`${where}: [${v.impact}] ${v.id}: ${v.help}\n      ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join("\n      ")}`);
      if (scheme === "light" && view === "desktop") {
        await p.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
        let last = null, same = 0;
        for (let i = 0; i < 60; i++) {
          await p.keyboard.press("Tab");
          const f = await p.evaluate(() => {
            const el = document.activeElement;
            if (!el || el === document.body) return null;
            if (el.tagName.toLowerCase() === "nextjs-portal") return { key: "dev-overlay", visible: true }; // development-only overlay
            const cs = getComputedStyle(el);
            return { key: `${el.tagName.toLowerCase()}|${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)}`,
              visible: (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || (!!cs.boxShadow && cs.boxShadow !== "none") };
          });
          if (!f) break;
          if (i === 0 && !f.key.startsWith("a|Skip to main content")) failures.push(`${where}: first Tab stop is "${f.key}", expected the skip link`);
          if (!f.visible) failures.push(`${where}: no visible focus indicator on ${f.key}`);
          if (f.key === last) { if (++same > 3) { failures.push(`${where}: keyboard focus stuck on ${f.key}`); break; } } else same = 0;
          last = f.key;
        }
      }
      process.stdout.write(".");
    }
    await ctx.close();
  }
  await browser.close();
  const scans = runs.length * pages.length;
  if (failures.length) {
    console.error(`\n${failures.length} accessibility problem(s) in ${scans} page scans:\n - ${[...new Set(failures)].join("\n - ")}`);
    process.exit(1);
  }
  console.log(`\naccessibility ok: ${scans} page scans (WCAG 2.2 A/AA via axe-core; keyboard walk) with no violations`);
}
main().catch((e) => { console.error(e); process.exit(1); });

# Content-Security-Policy

The policy limits what a page may load and run, so that if an attacker ever got markup into a page (cross-site scripting), their script still wouldn't execute.

## How it works
- `apps/web/proxy.ts` runs before every page and creates a **fresh random nonce** (128 bits). It builds the policy with `lib/csp.ts` and sends it as the `Content-Security-Policy` header.
- Next.js reads the nonce while rendering and puts it on its own `<script>` and `<style>` tags. To make that possible, every page renders per request (`await connection()` in `app/layout.tsx`).
- **Scripts:** only tags carrying this request's nonce run, plus whatever those scripts load (`'strict-dynamic'`). Injected `<script>` tags, inline event handlers (`onerror=…`), `javascript:` links and `eval` are all blocked. There is no `'unsafe-inline'` or `'unsafe-eval'` for scripts in production.
- **Styles:** `<style>` elements need the nonce. Inline `style=""` attributes stay allowed. React's `style={{…}}` renders as attributes, nonces can't cover attributes, and attribute styles can't run code.
- **Everything else:**
  - same origin only;
  - photos and sign-in may also use **exactly** your Supabase origin (from `NEXT_PUBLIC_SUPABASE_URL`, no wildcard);
  - no plugins (`object-src 'none'`) and no frames (`frame-src 'none'`), and the app can't be framed (`frame-ancestors 'none'`);
  - `base-uri 'none'`;
  - forms post only to the app;
  - production also upgrades insecure requests.
- **API responses** get a fixed `default-src 'none'` policy (`next.config.ts`): they're data and must never render as a page.
- **Development** additionally allows `eval` (React's debugging needs it) and inline `<style>` (the dev overlay).

## Violation reports
Browsers report blocked content to `/api/csp-report`, in both the old `report-uri` format and the Reporting API.

**What the endpoint does:**
- Counts each report in `slabguard.csp.violations{directive}`.
- Logs up to 100 reports a minute as `csp violation`, with share tokens and IDs masked and query strings dropped.
- Caps request bodies at 16 KB and never echoes them back.

The `CspViolations` alert fires on a sustained stream (`docs/MONITORING.md`). Right after a deploy, a stream usually means the policy blocks something legitimate. Scattered single reports are usually browser extensions injecting scripts, and can be ignored.

## Tests
- **Unit (`test/csp.test.ts`):**
  - the production policy has no inline or eval scripts, and `<style>` needs the nonce;
  - only the exact Supabase origin is allowed;
  - development adds only `eval`;
  - nonces are random.
- **Browser, development (`e2e/csp.e2e.ts`):**
  - every page gets a policy with a new nonce on every request, and every `<script>` the server sends carries it;
  - a script, event handler and `javascript:` link **injected into a real page response** (simulated XSS) don't run, while the app's own scripts do (checked to fail when the header is removed);
  - API responses are locked down, and reports are accepted.
- **Every browser test** fails on any policy violation (`e2e/fixtures.ts`), so all the main flows (sign-up, scan, report, share, plans, account) run under the policy.
- **Browser, production build (`e2e/production.e2e.ts`, CI `e2e` job):** the strict production policy (no eval, nonce-only `<style>`), with no violations on the signed-out pages, the plans loading, and a shared report.

## Adding a third-party script or service
Don't loosen the policy with `'unsafe-inline'` or wildcards.
- **A script:** load it with `next/script`. Pass the nonce from `(await headers()).get("x-nonce")` and add its exact origin to `script-src` in `lib/csp.ts`.
- **An API the browser calls:** add its exact origin to `connect-src`.
- **Images:** add the exact origin to `img-src`.

Then run the browser tests: any violation fails them.

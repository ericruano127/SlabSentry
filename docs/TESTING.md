# Testing & Accuracy

For hand testing on staging (real sign-in, purchases, phones, screen readers), see `docs/MANUAL_TEST_PLAN.md`.

## Automated suites
| Suite | Command | Covers |
|---|---|---|
| Core (vitest) | `pnpm --filter @slabguard/core test` | grader detection, cert extraction, rules engine (cloning, different copy, user-supplied caps, older-holder handling, UV unsupported, online-listing limits, screenshot detection), entitlement windows (month-end, annual monthly resets, cancel/refund/cross-provider) |
| Vision (pytest) | `cd services/vision && .venv/bin/python -m pytest` | same copy vs different copy vs different card, photo reuse, blur/glare/cut-off, QR + OCR, edge straightness, tilt hue shift, API |
| Web billing integration (vitest + Postgres) | `pnpm --filter @slabguard/web test` | 3 free allowed / 4th blocked (402 + upgrade), multiple photos = 1 credit, failure releases credit, job failure releases, concurrent scans at the limit, Stripe activation, duplicate webhooks, stale events, monthly reset (monthly & annual), upgrade/downgrade, cancel-until-period-end → Free with history kept, cross-device (App Store via RevenueCat), store refund via reconcile, refunds/disputes, provider outage, failed webhook retry |
| End-to-end pipeline | same command with vision running + `python -m tests.make_fixtures /tmp/claude-0/fixtures` (`FIXTURES_DIR` overrides) | upload → gate → reserve → analysis → report → consume; different copy flagged; blurry rejected without credit; retake re-analysis is free |
| Phase 2 (vitest, live vision) | `test/phase2.e2e.test.ts`, `test/narrative.test.ts` | unique marks localized, physical match never from artwork alone, label swap (and no false positive on OCR segmentation), tilt video → frames → holo analysis, edge review, near-duplicate collapse + retake request, static video rejected free, narrative request shape / refusal / forbidden-claim fallback (local fake API), bulk queue entitlement + credit stop |
| Phase A (vitest) | `test/metadata.test.ts`, `test/phaseA.test.ts` | lossless EXIF/GPS/XMP/IPTC/text-chunk/video-box stripping with pixel-identical decode checks, orientation kept, trailing data cut, truncated/bomb files rejected; consent gate + stale versions + re-acceptance; append-only consent log; training opt-in snapshot/revocation; data export zip; retention purge; metadata backfill; RBAC + mandatory staff 2FA; role changes audited; production startup guard |
| Phase B (vitest + pytest) | `packages/core/test/library.test.ts`, `apps/web/test/phaseB.test.ts`, vision geometry tests | item year never used; 1952 card graded 2024 → 2024 holder; official label type; reholder; era mismatch only for later-era exclusive features; inferred era low confidence; verified cert ranges; library validation; new grader without code; category check switches; release immutability trigger; tamper → integrity failure pauses analysis; draft/publish/rollback with RBAC + audit; public view hides markers; category/grader validation; live pipeline for TCG and sealed games; generic shape detection |
| Phase C (vitest + pytest) | `packages/core/test/phaseC.test.ts`, `apps/web/test/phaseC.e2e.test.ts`, vision Phase C tests | set check; editing-software + copy-paste review items (no false alarms on clean slabs); live-capture single-use codes; cloned cert across users (no data leak, hashed keys); verified label templates (same design consistent, different design flagged); UV without template inconclusive; microprint resolvability; FMV median/outliers/range + price anomaly; NumPy JSON regression |
| Phase D (vitest + pytest) | `packages/core/test/phaseD.test.ts`, `apps/web/test/frame-analysis.test.ts`, phase D gate in `phaseC.e2e.test.ts`, vision motion-blur/label-sharpness tests | quick summary buckets (verified / inconsistent / can't see / ask next, listing phrasing, deep-check recommendation); per-photo quality table incl. limited checks and duplicates; live frame checks (framing, edges cut off, keystone, motion, size); motion blur vs defocus; front+back required before credit |
| Phase E (vitest) | `packages/core/test/phaseE.test.ts`, `apps/web/test/phaseE.test.ts` | missed fakes / false flags with 5× weighting, per-group metrics; gate blocks new missed fakes even when total cost falls; public-notes lint; labeling requires consent or staff sample; disputed labels excluded; release components/accuracy/gate recorded; immutability; owner-only override; reports record release version + replayable engine snapshot |

Synthetic fixtures (`services/vision/tests/synth.py`) generate cards sharing artwork but differing in cut and surface marks — they validate logic, **not real-world accuracy**.

## Accessibility
`apps/web/scripts/a11y-audit.mjs`: WCAG 2.2 A/AA (axe-core) plus a keyboard walk on every page, in light/dark and desktop/phone, signed out, signed in and as staff. Runs in CI (`accessibility` job) and fails on any violation. See `docs/ACCESSIBILITY.md`.

## Browser tests (end to end)
`apps/web/e2e/*.e2e.ts` (Playwright) drive a real browser through the main flows. They run in CI on every push (the `e2e` job), on a desktop browser, and the tests tagged `@phone` also run at phone size (Pixel 7).

| Flow | What's checked |
|---|---|
| Sign up | landing page → sign-up → the consent screen blocks until the Terms and Privacy Policy are accepted → dashboard; 3 free verifications |
| Quick scan → report | in-hand scan with front + back photos, label read, certification number taken from the QR code, analysis → report page, listed in History, exactly one credit used |
| Bad photo | a blurry photo gets retake guidance; no credit used |
| Share link | the shared report opens signed out with the same headline and no photos, image links, user id or email |
| Out of credits | analysis is refused with an upgrade prompt, and no report starts |
| Plans | signed out, "Start free" goes to sign-up; a free user's "Upgrade" asks checkout for the right monthly and annual price |
| Account | "Download my data" downloads the zip; deleting the account (after typing DELETE) removes it |
| Content-Security-Policy | fresh nonce on every page and every server-sent `<script>`; an injected script, event handler and `javascript:` link don't run; API responses locked down; **every test fails on any policy violation** |
| Production build | CI also builds the production app and runs `e2e/production.e2e.ts` against it: the strict production policy, the signed-out pages, plans and a shared report, with no violations (`PROD_BASE_URL`, `--project production`) |

**Limits:**
- Sign-in uses the development test sign-in. Real Supabase sign-up (email confirmation, Google/Apple, two-factor) needs a Supabase project, so check it by hand on staging.
- Stripe checkout is stubbed: the tests check the app asks for the right price, not Stripe's own pages. Test purchases on staging cover that (`docs/LAUNCH_CHECKLIST.md`).
- The live camera isn't covered; it needs a real camera.

**To run locally**, start the vision service and make the test photos:

```bash
cd services/vision && .venv/bin/python -m tests.make_fixtures /tmp/fixtures && .venv/bin/uvicorn app.main:app --port 8001
```

Then create and migrate a separate database, and start the app with test sign-in. Keep uploads outside the app folder, because the development server reloads pages when files in it change:

```bash
createdb -h localhost -U postgres slabguard_e2e && cd apps/web && DATABASE_URL=postgres://postgres@localhost:5432/slabguard_e2e pnpm db:migrate
```

```bash
cd apps/web && DATABASE_URL=postgres://postgres@localhost:5432/slabguard_e2e AUTH_MODE=dev NEXT_PUBLIC_AUTH_MODE=dev LOCAL_STORAGE_DIR=/tmp/e2e-uploads npx next dev -p 3000
```

Then run the tests:

```bash
cd apps/web && FIXTURES_DIR=/tmp/fixtures DATABASE_URL=postgres://postgres@localhost:5432/slabguard_e2e pnpm exec playwright test
```

Results and failure screenshots go to your temp folder (`slabguard-e2e`), or to `E2E_OUT`. In CI, a failed run uploads them as the `e2e-report` artifact, with a trace for each failed test.

## Load, stress & capacity
Reduced-scale autocannon runs and the analysis-throughput benchmark: `loadtest/local/` (results in `loadtest/results/`).
Full 10,000-user k6 suites for staging: `loadtest/k6/`. Results, breaking point and capacity model: `docs/SCALING.md`.
Re-run after every major patch.

## Accuracy evaluation plan (real data)
Dataset (authorized images only, independently labeled by at least two reviewers; disagreements adjudicated; AI output never used as ground truth):
genuine matched slabs · genuine with poor photos · same design/different copy · reused cert numbers · simulated wrong labels · different legitimate holder generations · official images with perspective/lighting differences · reholders · missing records · suspicious seams · photo replays and listing reuse.

Metrics per release: card-ID accuracy, OCR character/field error rate, design-match precision/recall, different-copy detection TPR at fixed FPR, holder-generation accuracy, overall false-positive and false-negative rates (by grader and by holder generation), capture completion rate, p50/p95 processing time, and a user-comprehension survey on report limitations. Thresholds live as named constants in `compare.py` / `holder.py` / `quality.py` for tuning.

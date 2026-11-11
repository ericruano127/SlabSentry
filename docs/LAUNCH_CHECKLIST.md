# Launch checklist

Everything between now and a public launch, in rough order. Last updated 2026-11-11.

**Status:**
- ✅ done
- 🟡 built, needs your setup or a decision
- ⛔ blocked on an outside party
- ⬜ not started

**Owner:**
- **You**
- **Lawyer**
- **PSA** (or another grader)
- **Pen-test firm**
- **Claude** (ask in a session)

## 1. Accounts and infrastructure
| | Item | Owner | Details |
|---|---|---|---|
| 🟡 | Staging on Fly.io: apps, Postgres, Redis, secrets, GitHub `staging` environment | You | `docs/STAGING_FLY.md` (about 30 min) |
| 🟡 | Separate **staging Supabase** project (sign-in + photo storage); restrict sign-ups | You | `docs/STAGING_FLY.md` § Supabase |
| 🟡 | Grafana Cloud stack, OTLP secrets on both apps, dashboard + alert rules imported, contact point | You | `docs/MONITORING.md` (about 15 min) |
| 🟡 | Production on Fly.io: separate apps/DB/Redis (ideally a separate Fly org), custom domain + TLS | You | `docs/PRODUCTION_FLY.md` |
| 🟡 | GitHub `production` environment: **Required reviewers**, `main`-only deployments, production secrets/variables | You | `docs/PRODUCTION_FLY.md` |
| 🟡 | Production **Supabase** project (email confirmation, Google/Apple sign-in, private bucket, redirect URLs) | You | `docs/DEPLOYMENT.md` |
| ⬜ | Confirm database backup retention **and test a restore** | You | Fly MPG dashboard |
| ⬜ | First production deploy watched end to end, plus one deliberate rollback test | You + Claude | `docs/PRODUCTION_FLY.md` |
| ✅ | Deploy pipelines: staging after CI; production manual, approval-gated, blue-green, automatic rollback | Claude | `.github/workflows/deploy-*.yml` |
| ✅ | Migration safety check in CI (blue-green / rollback compatible) | Claude | `apps/web/scripts/check-migrations.mjs` |

## 2. Data partners and content
| | Item | Owner | Details |
|---|---|---|---|
| ⛔ | **PSA API: higher daily limit.** The default (about 50 lookups/day) is the real capacity ceiling | PSA | `docs/SCALING.md` |
| ⛔ | PSA: grading dates / label types in the API (improves holder-era detection) | PSA | `docs/PHASE_B.md` |
| ⬜ | **Verified-genuine template photos** for the main holder generations (PSA, CGC, TAG first), submitted and second-person approved | You | `docs/REFERENCE_LIBRARY.md` |
| ⬜ | Labeled genuine and counterfeit samples, so accuracy metrics and the release gate use real data | You | `docs/TESTING.md`, Staff tools → Quality |
| ⬜ | Price data provider (optional): enable only after confirming the field mapping against a real response | You | `config/fmv.json` |

## 3. Legal and privacy
| | Item | Owner | Details |
|---|---|---|---|
| ⛔ | **Review the Terms, Privacy Policy, notice at collection and training consent**, then mark them approved. Production won't start before this | Lawyer | `legal/` |
| ⬜ | Incident response plan reviewed; contacts filled in | You + Lawyer | `docs/security/INCIDENT_RESPONSE.md` |
| ⬜ | Confirm encryption at rest for the database, storage and backups in each provider; document it | You | `docs/security/HARDENING_CHECKLIST.md` |
| ⬜ | App Store / Play privacy labels match `legal/privacy.md` | You | Store consoles |

## 4. Billing
| | Item | Owner | Details |
|---|---|---|---|
| 🟡 | Stripe **live** keys + webhook secret (production only); prices match `config/plans.json` | You | `docs/DEPLOYMENT.md` § Stripe |
| 🟡 | RevenueCat production project; App Store and Play subscription products created and linked | You | `docs/DEPLOYMENT.md` § RevenueCat |
| ⬜ | Test purchase, renewal, cancellation and refund in Stripe test mode and the store sandboxes, on staging | You | Staff tools → Users / Billing |

## 5. Mobile apps
| | Item | Owner | Details |
|---|---|---|---|
| ⬜ | Development build on real devices; live-camera checklist (one newer and one older device per platform) | You | `docs/MOBILE_CAMERA.md` |
| ⬜ | Apple Developer + Google Play accounts; app records, icons, screenshots, review notes | You | Store consoles |
| ⬜ | Point the app config at production (`apps/mobile/app.json` `extra`) | You | `apps/mobile/app.json` |

## 6. Security
| | Item | Owner | Details |
|---|---|---|---|
| ✅ | Internal security and code review (8 findings fixed) | Claude | `docs/security/REVIEW_2026-11-11.md` |
| 🟡 | GitHub: 2FA required, branch protection on `main` (PR + review + required checks), push protection on | You | `docs/security/HARDENING_CHECKLIST.md` |
| 🟡 | 2FA on every provider account (Fly, Supabase, Stripe, RevenueCat, Apple, Google, Grafana, domain registrar, email) | You | Same file |
| ✅ | Strict Content-Security-Policy with per-request nonces (no inline or eval scripts); tested against injected scripts, in development and a production build | Claude | `docs/security/CSP.md` |
| ⛔ | **Third-party penetration test** (web, API, mobile, storage permissions), with findings fixed | Pen-test firm | Same file |

## 7. Performance and reliability
| | Item | Owner | Details |
|---|---|---|---|
| ✅ | Reduced-scale load and stress tests; performance pass | Claude | `docs/SCALING.md`, `docs/PERFORMANCE.md` |
| 🟡 | **10,000-user load test on staging** (k6, distributed); record the results | You run it, Claude analyses | `.github/workflows/loadtest-staging.yml` |
| ✅ | Graceful worker shutdown; worker health checks; private vision service; alerts | Claude | `docs/PRODUCTION_FLY.md` |

## 8. Product quality (optional before launch, recommended)
| | Item | Owner | Details |
|---|---|---|---|
| ✅ | Accessibility audit (WCAG 2.2 AA, axe + keyboard): 7 issue types fixed, 0 violations in 57 scans, enforced in CI | Claude | `docs/ACCESSIBILITY.md` |
| ⬜ | Screen-reader session (VoiceOver/TalkBack) on the main flows, web and mobile | You (or a specialist) | `docs/ACCESSIBILITY.md` |
| ✅ | Browser end-to-end tests of the main flows in CI (sign up, scan → report → share, out of credits, plans, account; desktop + phone) | Claude | `docs/TESTING.md` § Browser tests |
| ✅ | CI upkeep: actions updated off deprecated Node 20, all pinned to commit SHAs (Fly.io step no longer tracks `master`), grouped Dependabot updates | Claude | `.github/workflows/`, `docs/security/HARDENING_CHECKLIST.md` |

## 9. Manual testing on staging
| | Item | Owner | Details |
|---|---|---|---|
| ⬜ | Smoke test (★ tests) after each staging deploy you care about | You | `docs/MANUAL_TEST_PLAN.md` |
| ⬜ | Full manual pass on desktop, iPhone and Android; blockers and majors fixed and re-tested | You (+ a second tester) | `docs/MANUAL_TEST_PLAN.md` |

## Launch day
1. Legal approved, then deploy production (approval, blue-green, smoke test).
2. Check Grafana: API errors, analysis queue, workers reporting.
3. Make a real purchase with a real card on production, then refund it.
4. Run a full in-hand scan on production with a known genuine slab.
5. Submit the mobile apps for review (or release them if already approved).

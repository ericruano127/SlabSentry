# Architecture, Data Model & API Contracts

```
apps/web (Next.js 16)        apps/mobile (Expo 58 / RN 0.88)
  UI + REST API  <──────────── same REST API (Bearer Supabase JWT)
     │  ├─ credits ledger, entitlements, billing webhooks (Stripe, RevenueCat)
     │  ├─ pipeline orchestration (jobs table, SKIP LOCKED workers, priority)
     │  └─ grader adapters (PSA API | official links), reverse image (GCV)
     ├──────────► services/vision (FastAPI + OpenCV + RapidOCR)
     │               /quality /extract /compare /holder
     └──────────► Postgres (Supabase) + private object storage (Supabase Storage | local disk)
packages/core (TS, shared): types, grader registry, holder security library, rules engine, report model, plan/entitlement logic
```

**Principles:** deterministic CV + source-backed facts decide; no LLM decides authenticity. Every observation carries `basis` (fact / inference / unknown) and `provenance` (source, tool version, timestamp). Rules are transparent (`rules-0.1.0`); no probability score until calibrated on labeled data.

## Verification pipeline (per analysis run)
1. **Quality gate** (free, per upload): sharpness, resolution, glare, exposure, holder edges in frame, camera angle, subject size → specific retake guidance.
2. **Holder inspection** (`vision/holder`): slab quad, edge visibility & straightness, label region, QR/barcode decode, OCR, tilt-frame hue variation, backlit luminance change.
3. **Identification**: grader from QR domain + label tokens; cert from QR → barcode → OCR; user confirms.
4. **Official record**: adapter (PSA API or link-only), cached 24h.
5. **Reference images**: official (PSA API) stored with provenance, else user-supplied with attestation.
6. **Reference comparison** (`vision/compare`): card localisation → SIFT+MAGSAC artwork alignment (design match) → **card-edge offset relative to aligned artwork** (cut/centering differs between copies of the same design) → border ratios → glare-masked high-pass NCC grid (local differences) → pHash (photo reuse / screenshot-of-reference). Produces side-by-side, aligned blend, and heatmap overlays.
6b. **Physical fingerprint v2** (`vision/fingerprint.py`, 1000×1400 artwork-aligned frame): unique marks (residual blobs present in one image only, glare/edge-ghost suppressed), edge & corner wear profile correlation, inter-channel print registration. Each signal reports its own status; low resolution → inconclusive.
6c. **Label vs. reference label** (`vision/label.py`) and **edge/seam review** (`vision/seam.py`); **tilt video** → distinct frames (`vision/video.py`).
7. **Reverse image** (Pro+, if configured): Google Cloud Vision Web Detection; same-photo vs similar separated.
8. **Rules engine** (`rules-0.2.0`, `risk/phase2.ts`) → physical-match verdict per side (supported needs ≥2 agreeing strong signals, none conflicting), near-duplicate collapse, adaptive retake requests, deterministic interpretation, observations, findings (with legitimate explanations), evidence quality, overall assessment, next actions.
9. **Billing**: consume the reserved credit only after the report is persisted; release on any failure, or when a provider outage left no meaningful comparison.
Retakes rerun only changed steps (holder cache keyed by input hashes, comparisons cached per image pair, lookups cached).

## Data model (db/migrations)
| Table | Purpose |
|---|---|
| app_users | id = Supabase auth user id; stripe_customer_id; is_admin |
| subscription_plans / subscription_prices | admin-editable plans, allowances, features; Stripe/Apple/Google product ids |
| user_subscriptions | one row per provider subscription; status, period, cancel_at_period_end, `provider_updated_at` (stale-event guard) |
| billing_events | every webhook, unique (provider, event id) → idempotency; status/attempts for retry |
| payments | invoices/transactions, refunds, disputes |
| account_entitlements | materialized current plan/features/window (same for every device) |
| verification_allowances | `lifetime_free` (never resets), `subscription_period` (one row per monthly window), `admin_grant` |
| verification_usage_ledger | reserve/consume/release per (session, attempt) — unique, so no double charge |
| verification_sessions | one slab; credit_state, locked_cert (session bound to one slab after first report), analysis_count |
| submitted_images | originals (`is_original`) separate from derived overlays; sha256, quality, provenance |
| extracted_certifications, official_reference_images, image_comparisons, verification_evidence, risk_findings, verification_reports | evidence with run number → assessment history |
| grading_companies, holder_generations, security_features | seeded from the versioned core library |
| jobs, processing_costs, rate_limits, admin_audit_log, cert_lookups | ops, unit economics, abuse control, audit |

Concurrency: every credit/subscription mutation runs in a transaction holding `pg_advisory_xact_lock(user)` plus `FOR UPDATE` on the session and allowance rows.

## API contracts (JSON; auth = `Authorization: Bearer <Supabase access token>`)
| Method & path | Body → Response |
|---|---|
| GET /api/me | → `{ user, usage: UsageSummary, welcome }` |
| GET /api/plans | public → `{ plans: Plan[] }` (prices with `webPurchasable`) |
| POST /api/sessions | `{ mode: "in_hand"\|"online_listing" }` → 201 `{ id }` (free) |
| GET /api/sessions?q= | → `{ sessions, searchEnabled }` (search: Power) |
| GET /api/sessions/:id | → session view incl. images, references, latest report, assessmentHistory |
| PATCH /api/sessions/:id | `{ grader?, certNumber?, certSource?, certConfirmed?, mode?, status?: "canceled" }`; 409 if cert differs from locked_cert |
| POST /api/sessions/:id/images | multipart `file`, `role` (incl. `tilt_video`: mp4/mov/webm ≤60 MB → frames extracted), `attestation?` (required for reference_*) → `{ image: { id, role, quality } }` (free) |
| POST /api/sessions/:id/extract | → `{ graders, candidates[{value,source}], codes, ocrText }` |
| POST /api/sessions/:id/analyze | → 202 `{ status, credit, usage }`; 422 `retake_needed {problems}`; 402 `limit_reached {planId, resetsAt, upgrade}`; 429 |
| GET /api/sessions/:id/report.pdf | PDF (Pro+); 403 `upgrade_required` |
| POST /api/reports/batch | `{ ids[] }` → PDF (Power) |
| POST /api/sessions/:id/narrative | Pro+ → `{ narrative: { text, source: "ai"\|"template", model?, analysisRun } }` (cached per run) |
| POST /api/sessions/bulk-analyze | Power → `{ ids[] }` → `{ results[{id,status}], usage }` (one credit per slab) |
| POST/DELETE /api/sessions/:id/share | → `{ url }` public link without photos/personal data; GET /api/share/:token |
| GET /api/images/:id | owner-only image bytes |
| POST /api/billing/checkout | `{ priceId }` → `{ url }` (Stripe Checkout); 409 `managed_elsewhere` / `use_portal`; 503 `billing_unavailable` |
| POST /api/billing/portal | → `{ url }` (Stripe portal: upgrade/downgrade/cancel) |
| POST /api/billing/sync | server-side RevenueCat reconcile (mobile purchase / Restore Purchases) → `{ applied, usage }` |
| POST /api/webhooks/stripe | Stripe-signed; idempotent |
| POST /api/webhooks/revenuecat | `Authorization` shared secret; idempotent; reconciles via REST when key set |
| DELETE /api/account | `{ confirm: "DELETE" }` → deletes data, photos, auth user; cancels web subscription |
| GET /api/admin/metrics?days= · GET/PUT /api/admin/plans | admin only; PUT audited |

Vision endpoints: `/quality /extract /compare /holder /frames /edge`. Contract: see `services/vision/app/main.py` (multipart in, JSON out, `x-vision-key` header).

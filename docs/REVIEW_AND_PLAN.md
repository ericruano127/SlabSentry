# Slab Guard — Current State, Gap Analysis, Phased Plan (2026-11-09)

Status legend: ✅ addressed · 🟡 partial · ❌ missing. Nothing in this plan overwrites existing work; items that conflict with earlier decisions are called out explicitly.

## 1. Current state

| Area | What exists |
|---|---|
| **Architecture** | pnpm monorepo: `packages/core` (TS rules engine, grader registry, holder security library, report model, plans/entitlements), `services/vision` (FastAPI + OpenCV + RapidOCR), `apps/web` (Next.js 16 UI + REST API + worker), `apps/mobile` (Expo 58). Postgres (Supabase-compatible), private object storage, Postgres job queue with `SKIP LOCKED` workers and priority. |
| **Analysis** | Quality gate (sharpness, resolution, glare, exposure, edges in frame, angle, subject size); QR/barcode + OCR cert extraction with user confirmation; PSA Public API lookup (token) with 24h cache, official links for CGC/BGS/SGC/TAG/AGS; reference comparison (SIFT design match, cut/centering offset, local residuals, pHash photo reuse); fingerprint v2 (unique marks, edge-wear profile, print registration); holder inspection (edges, straightness, codes, OCR, tilt hue change, backlit change); label vs reference label; seam close-up review; tilt-video frame extraction. |
| **Rules/report** | `rules-0.2.0`: observations with basis (fact / inference / unknown) + provenance; findings with innocent explanations; evidence quality; 4 assessment categories (never "real/fake"); physical-match rule (≥2 strong signals); adaptive retake requests; near-duplicate collapse; deterministic interpretation; optional AI explanation (validated, cannot change findings). Reports record rules, vision tool and holder-library versions. PDF, share link, history. |
| **Data model** | 3 migrations: users, plans/prices, subscriptions, billing events, payments, entitlements, allowances, usage ledger, sessions, images (originals vs derived), evidence, comparisons, findings, reports (per run), grading companies / holder generations / security features (seeded from code), jobs, costs, rate limits, admin audit log, cert lookup cache. RLS enabled on all tables. |
| **UI** | Web: landing, auth (email, Google, Apple, reset), dashboard, scan wizard, live camera with on-device focus/exposure/glare hints, tilt recorder, report view, history, pricing, account (deletion), bulk queue, admin metrics + plan editor. Mobile: login, dashboard, guided capture (system camera), report, paywall, account. |
| **Billing** | Free 3 lifetime / Pro / Power, config-driven; credit ledger (reserve → consume/release, idempotent, concurrency-safe); Stripe + RevenueCat with verified, idempotent webhooks. |
| **Tests** | 77 automated (core 27, vision 19, web 31 incl. live end-to-end). All image tests use **synthetic** fixtures — real-world accuracy is unmeasured. |
| **Open items (from docs)** | Labeled real-data evaluation; PSA image endpoint schema; authorized imagery for non-PSA graders; legal documents; observability; deferred Phase 2 items (segmentation/logo/typography models, mobile live guidance, calibrated score). |

## 2. Gap analysis

### §1 Core principle
| Requirement | Status | Notes |
|---|---|---|
| Never declare real/fake | ✅ | Assessment categories + AI-output validator forbid it |
| Report verified / inconsistent / not visible / what to ask next | 🟡 | All present as observation statuses + retake requests, but not as one fast summary for impulse decisions |
| Guidance-not-guarantee disclaimer in-app and every report | 🟡 | In every report and PDF; not in onboarding, home or capture screens |

### §2 Checks
| Check | Status | Notes |
|---|---|---|
| Cert format + official lookup cross-check (grade, item, year, set) | 🟡 | Format patterns unverified; PSA only; label-vs-record compares grade/year/subject/number, **not set** |
| Label layout, typography, spacing, logo, color | ❌ | Only OCR text + QR. Needs verified label templates per generation |
| Microprinting / fine dots | ❌ | Close-up captured, not analyzed |
| UV-reactive features | ❌ | Marked "not supported"; no blacklight capture role |
| Holograms / angle-dependent | ✅ | Tilt photos/video, conservative hue-change check |
| Slab/case construction | 🟡 | Edge straightness + seam review; no case/label/well proportion checks per generation |
| Card-swap detection | ✅ | Design match + fingerprint v2 vs official (PSA) or user reference |
| Image manipulation (metadata, editing signs) | ❌ | None. Live capture exists on web but isn't recorded as higher-confidence evidence |
| Cloned certs across uploads | ❌ | No cross-upload tracking |

### §3 Era-aware verification
| Requirement | Status | Notes |
|---|---|---|
| Era = grading date, never item year | 🟡 | Item year is **not** used (good), but grading date isn't used either |
| Grading date from cert lookup | ❌ | Not extracted; whether PSA's API exposes it must be confirmed |
| Reholder/regrade: current slab governs | ❌ | |
| Fallback: infer generation visually, say so, lower confidence | ❌ | Generation is listed as "not determined" |
| Era mismatch as a risk signal | ❌ | |
| Older slabs not flagged for missing newer features | ✅ | Generation-aware feature applicability |

### §4 Multi-category foundation
| Requirement | Status | Notes |
|---|---|---|
| Categories (cards, TCG, sealed games, comics, figures, future) | ❌ | Cards only. Vision geometry hard-codes card/slab aspect ratios |
| Hierarchy category → grader → generation → date range → features | 🟡 | Grader → generation → features exists; no category level, dates are text |
| Data-driven, patchable without code | 🟡 | Seeded into DB but **read from TS constants**; changes need a deploy (not an app-store release) |
| WATA, VGA, others | ❌ | |
| Category-specific capture guidance | ❌ | Guidance strings hard-coded for card slabs |

### §5 Capture quality gate
| Requirement | Status | Notes |
|---|---|---|
| Front **and** back required | 🟡 | Only front is required; back is requested as a retake |
| Real-time checks: focus, glare, lighting | 🟡 | Web live camera only; mobile uses the system camera with server-side checks after capture |
| Real-time framing/edges, skew, motion blur, zoomed label/microprint sharpness | ❌ | Server-side only (framing, angle); not live; no region-level sharpness |
| On-screen guidance + auto-capture | 🟡 | Hints + capture enabled when steady (manual tap); no auto-capture |
| Reject with specific reason | ✅ | |
| Per-image quality scores recorded and shown | 🟡 | Recorded; report shows evidence-quality reasons, not a per-image table |
| Tiered quick scan / deep check | ❌ | One long wizard with optional steps |

### §6 Live-service design
| Requirement | Status | Notes |
|---|---|---|
| Versioned library updatable without releases | 🟡 | Versioned, but code-based |
| Sample collection → retrain → model versions | ❌ | All analysis is deterministic today; no sample registry/labeling |
| Log new counterfeit techniques / grader changes → patch | ❌ | |
| Every report records versions | ✅ | rules, vision tool, holder library |
| Accuracy tracking (missed fakes vs false flags, weighted) | ❌ | Admin metrics are business-only |

### §7 Patch notes — ❌ none (no public/internal changelogs, no in-app version screen).

### §8 Data collection & consent
| Requirement | Status | Notes |
|---|---|---|
| ToS/Privacy acceptance with version + timestamp | ❌ | |
| Disclosure of what's collected | ❌ | |
| Separate training consent, opt-out keeps core features | ❌ | |
| CCPA/CPRA access, deletion, opt-out | 🟡 | Deletion ✅; data export ❌; opt-out ❌ |
| Retention policy + training-data ↔ consent audit trail | ❌ | |
| Legal-review flags | ❌ | No policy text exists yet |

### §9 Security & privacy
| Requirement | Status | Notes |
|---|---|---|
| Strip EXIF/GPS on ingest | ❌ **urgent** | Originals are stored byte-for-byte, **including GPS**. Conflicts with the earlier "preserve unmodified originals" decision — resolve by stripping metadata losslessly (pixels untouched) |
| TLS / at-rest encryption | 🟡 | Provided by host/Supabase; not documented or enforced in config |
| Secrets manager | 🟡 | Env vars, nothing in repo; no secrets-manager integration documented |
| Hashed passwords, secure sessions | ✅ | Supabase Auth |
| 2FA | ❌ | Supabase MFA available, not wired |
| RBAC least privilege | 🟡 | Single `is_admin` flag |
| Repo/deploy protection, dependency scanning | 🟡 | CI runs tests; no audit step, Dependabot, CODEOWNERS or branch-protection guidance |
| Library/model tamper protection | 🟡 | Plan edits audited; library changes are code changes |
| OWASP: validation, upload limits, rate limiting | 🟡 | Type sniffing, size limits, zod validation, rate limits; no decompression-bomb guard or file scanning |
| Logging, intrusion monitoring, incident response | ❌ | |
| Security reviews / pen test | ❌ | External; launch checklist item |

### §10 Scalability
| Requirement | Status | Notes |
|---|---|---|
| Async job queue + progress | 🟡 | Queue ✅; status polling, no progress % |
| 10k concurrent design | 🟡 | Stateless API ✅; Postgres rate-limit table and per-request queries will be hotspots; no connection pooler |
| Global third-party throttling (PSA quota) | ❌ | Rate limits are per-user; PSA's 100/day free quota is global |
| Caching, graceful degradation | 🟡 | Lookup cache ✅; provider outage → partial report + credit released ✅; no degradation matrix |
| Autoscaling, CDN | ❌ | Images streamed through the API; no IaC |
| Load / stress / spike tests | ❌ | |
| Monitoring / alerting / error tracking | ❌ | |

## 3. Phased plan

Each phase ends with tests, a versioned patch (public + internal changelog once Phase E exists) and a short results note. Order is by risk: live privacy exposure first, then the data foundation that the new checks depend on.

**Phase A — Privacy, consent, security foundations** ✅ done (2026-11-09) — see `docs/PHASE_A.md`
1. Lossless metadata stripping on ingest (JPEG/PNG/WebP/video container metadata) before storage; keep only derived non-identifying signals needed for manipulation analysis (Phase C). Backfill-strip existing stored images.
2. Consent: ToS / Privacy / training consent with versions and timestamps; onboarding gate (web + mobile); training opt-out without losing core features; per-image consent snapshot; audit trail table.
3. CCPA/CPRA: data export (access request), deletion (exists), training opt-out; request log; retention job (configurable periods for originals, derived images, reports).
4. MFA (Supabase TOTP): required for staff roles, optional for users. RBAC roles (owner, admin, analyst, support) with least-privilege route guards.
5. Upload hardening: decode-validate, pixel-count limits (decompression bombs), strict MIME/extension agreement, video duration limits.
6. Repo/deploy hygiene: CI dependency audit, Dependabot config, CODEOWNERS, `SECURITY.md`, branch-protection + 2FA checklist, incident-response plan (incl. breach-notification steps).
7. Policy/disclosure text drafts, every block marked **LEGAL REVIEW REQUIRED**.

**Phase B — Data-driven reference library + era-aware verification** ✅ done (2026-11-10) — see `docs/PHASE_B.md`
1. DB-backed library: categories → graders → label/case generations (grading-date ranges) → expected features, with draft → published versions, content hash, audit log, admin editor. Engine and vision read the published version; reports record it.
2. Category dimension. Initial records for sports cards and TCG (PSA, CGC, BGS, SGC, TAG, AGS), plus research-needed stubs for sealed games (WATA, VGA, CGC), comics (CGC, CBCS), figures (AFA/VGA and others). Category-specific geometry and capture guidance come from data.
3. Grading-date resolution: from the official lookup when the grader provides it; otherwise visual generation inference, explicitly labeled "inferred", with lower confidence. Current slab governs (reholders). Item year is never used.
4. Era-mismatch rule (cert-derived era vs observed label/features). Absence of a newer feature on an older-era slab stays non-flagging (existing behavior kept).

**Phase C — Check expansion** ✅ done (2026-11-10) — see `docs/PHASE_C.md` (incl. fair market value)
1. Cert format and record cross-check from library data, including **set**.
2. Label layout/typography/spacing/logo/color comparison against **verified label templates** per generation, plus tooling to register templates from verified-authentic samples. Without a template the result is "inconclusive".
3. Microprint: macro capture, resolvability check, comparison against template crops.
4. UV: blacklight capture role; fluorescence presence/pattern vs documented or template expectation. Conservative: absence can be lighting.
5. Slab construction proportions per generation (case, label window, inner well).
6. Image manipulation: metadata signals read before stripping (editing software, missing camera data, thumbnail mismatch), double-JPEG / recompression heuristics. These produce "inconclusive" signals, never verdicts. In-app live-capture attestation (server nonce) raises evidence quality.
7. Cloned-cert detector: keyed hash of (grader, cert) plus a perceptual item fingerprint across all uploads. Flags the same cert on visually different items without exposing other users' data.

**Phase D — Capture gate and tiered flow** ✅ done (2026-11-10) — see `docs/PHASE_D.md`
1. Quick scan by default (front + back required, label, cert lookup), ending in a one-screen summary: *Verified · Looks inconsistent · Can't see from these photos · Ask the seller / photograph next*.
2. Deep check triggered automatically by findings or opt-in, requesting only the needed media.
3. Real-time edge/framing, skew and motion-blur detection, plus region (label) sharpness and auto-capture: web in JS; mobile via a camera frame processor (feasibility check first).
4. Per-image quality table in the report; category-specific guidance from the library.

**Phase E — Live service and patch notes**
1. Release object bundling rules + library + vision/model versions; every report references it.
2. Public and internal changelogs per release (public text reviewed so it never reveals detection methods); in-app version and patch-notes screen.
3. Ground-truth program: analyst labeling UI, consent-linked sample registry, counterfeit-technique log.
4. Accuracy dashboard per category / grader / generation (missed fakes vs false flags, configurable cost weight, default 5×). Releases are gated on no accuracy regression. Model-registry scaffolding for future learned models.

**Phase F — Scale and operations**
1. Redis (or equivalent) for rate limits and a global PSA quota/throttle; connection pooling; job progress %; signed CDN URLs for images.
2. Autoscaling templates for API and workers; health checks; degradation matrix documented and tested.
3. Observability: OpenTelemetry traces, error tracking, alerts.
4. k6 load / stress / spike suites targeting 10k concurrent users; scaled-down runs here, full runs on staging; results and fixes documented, re-run after major patches.

## 4. Limits to be honest about
- A full 10k-user load test, a penetration test and legal review need staging infrastructure, a third-party firm and counsel; I can prepare scripts, checklists and drafts.
- Label templates, UV/microprint references and accuracy metrics need verified-authentic and confirmed-counterfeit samples. The code paths and tooling can be built now, but they return "inconclusive" until data exists.
- Grader data beyond PSA's public API (grading dates, imagery) needs confirmation or partnerships.

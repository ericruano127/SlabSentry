# Milestones

## Phase 1 — Functional MVP ✅ (this commit)
- [x] Monorepo: core (TS), vision service (Python/OpenCV), Next.js web, Expo mobile
- [x] Capture + upload + adaptive quality validation with specific retake guidance
- [x] PSA & CGC identification, QR/OCR cert extraction, user confirmation
- [x] Modular grader adapters (PSA API; official links for others)
- [x] Reference-image upload with provenance + Reference Image Comparison Engine (design match, cut/centering fingerprint, local differences, photo reuse, overlays)
- [x] Holder Security Inspection Engine + versioned reference library (PSA/CGC, placeholders for others)
- [x] Rule engine, explainable report, PDF, share link, scan history, assessment history
- [x] Accounts (Supabase: email+verification, Google, Apple, reset, deletion, global sign-out)
- [x] Plans in DB (seeded from config), server-side credit ledger, 3 lifetime free, monthly allowances, abuse limits
- [x] Pricing page, dashboard, account management; Stripe web billing; RevenueCat native billing; shared entitlements
- [x] Admin unit-economics dashboard and audited plan editing
- [x] Tests: core rules/entitlements, vision CV, billing integration (real Postgres), live end-to-end pipeline

## Phase 1.5 — Launch readiness (next)
1. Collect an authorized labeled dataset (see TESTING.md) and tune vision thresholds; publish measured FP/FN.
2. Request PSA commercial API access; confirm `GetImagesByCertNumber` schema against live responses.
3. Configure Stripe products/portal (downgrades at period end), App Store Connect + Play products, RevenueCat entitlements/webhook.
4. Legal: Terms, Privacy, auto-renew disclosures, data retention policy (default: originals 12 months, configurable job).
5. Observability: error tracking, job queue metrics, webhook failure alerts.

## Phase 2 — Advanced verification ✅ (implemented; accuracy still to be measured on real data)
- [x] **Exact-card fingerprint v2**: unique-mark correspondence (localized, circled in overlays), edge & corner wear profile, print colour registration, at high resolution with automatic "inconclusive" below 600 px card width
- [x] **Transparent physical-match rule**: "supported" only with ≥2 agreeing strong signals and no conflicts; identical artwork never counts; per-side matching / conflicting / inconclusive lists
- [x] **Tampering analysis**: label vs. label in the reference image (label-swap indicator, tolerant to OCR segmentation); holder edge/seam close-up review (anomalies highlighted for review, never a verdict)
- [x] **Guided tilt video**: web live recorder (MediaRecorder) and mobile video capture → server picks distinct sharp frames (pHash de-dup); static videos rejected before analysis at no cost
- [x] **Live camera with real-time framing guidance** (web): on-device focus / exposure / glare checks, capture enabled when steady
- [x] **Adaptive retake requests** tied to the specific open checks, deep-linked into the scan flow (free re-analysis); near-duplicate photos never add evidence
- [x] **Improved interpretation**: deterministic layer-by-layer summary; **AI-assisted explanation** (Pro+, Claude via Anthropic SDK) constrained to the structured report, validated (no authenticity claims, assessment restated) with rule-based fallback
- [x] **Power plan bulk queue** (multi-card scanning, one credit per slab, stops cleanly at the limit)
- [x] Versioned library recorded in every report (`holderLibraryVersion`, `rules-0.2.0`, `vision/compare@0.2.0`)

### Phase 2 items deliberately not done (need data or permissions)
- Official reference images beyond PSA — no authorized programmatic source identified for CGC/BGS/SGC/TAG/AGS
- Segmentation model, grader-logo classifier, label-typography model, card embeddings — require a labeled dataset
- Holder library entries for BGS/SGC/TAG/AGS — official documentation not yet found; kept as "research needed"
- Mobile live framing guidance (mobile uses the system camera); holofoil pattern fingerprinting
- Calibrated risk score — only after labeled evaluation (see TESTING.md)

## Phase 3 — Growth
Additional graders, trusted expert review marketplace, marketplace integrations, seller verification flows, privacy-safe suspicious-listing reporting, fraud education/alerts, portfolio integration.

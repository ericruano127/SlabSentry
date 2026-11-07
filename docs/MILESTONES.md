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

## Phase 2 — Advanced verification
- Live in-app camera with real-time framing guidance and short tilt video capture (frame extraction)
- Print-dot / holo-pattern fingerprinting at high resolution; learned embeddings for card ID
- Segmentation model for holder/label/card; grader logo classifier; label typography model per generation
- Expanded holder library (BGS, SGC, TAG, AGS) with official sources
- Bulk verification queue UI for Power plan; multimodal AI narration constrained to evidence
- Calibrated risk score only after labeled evaluation

## Phase 3 — Growth
Additional graders, trusted expert review marketplace, marketplace integrations, seller verification flows, privacy-safe suspicious-listing reporting, fraud education/alerts, portfolio integration.

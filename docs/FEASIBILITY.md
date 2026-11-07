# Capability & Integration Feasibility

| Capability | Status in this build | Feasibility / constraint |
|---|---|---|
| Camera capture, uploads, adaptive quality gate | **Implemented** (web `capture=environment`, Expo ImagePicker) | Works on any phone camera; thresholds need tuning on real slab photos |
| Cert number extraction | **Implemented**: QR/barcode (OpenCV) → OCR (RapidOCR, local ONNX) → user confirmation | OCR errors expected; confirmation step is mandatory for trust |
| Grader auto-detection | **Implemented** (QR domain + label tokens) | Logo/layout classifier is Phase 2 |
| PSA record + official images | **Implemented** (PSA Public API, token required) | 100 calls/day free tier → 24h cache; commercial volume needs a PSA agreement |
| CGC / BGS / SGC / TAG / AGS records | Official link + user-supplied reference | No documented public API found. Pursue partnerships before automation |
| Same-design match | **Implemented** (SIFT + MAGSAC homography) | Robust to perspective/lighting; fails on heavy glare (→ inconclusive) |
| Same-physical-copy fingerprint | **Implemented**: card-edge offset vs aligned artwork, border ratios, local residuals | Strongest signal = cut/centering; requires card edges visible in both images. Print-dot / holo-pattern matching needs higher resolution & labeled data (Phase 2) |
| Photo reuse / screenshot detection | **Implemented** (pHash) | Near-duplicate only; crops/edits need feature matching (Phase 2) |
| Reverse image search | **Implemented** (Google Cloud Vision Web Detection, Pro+) | ~$3.50 per 1,000 requests (verify current pricing); index coverage of marketplaces varies |
| Holder edges / tamper hints | **Implemented** (edge visibility, straightness) | Visible-light only; can't detect skilled reseals. Results stay conservative |
| Tilt / hologram, backlit LightHouse | **Implemented** (frame alignment + hue/luminance change) | Only "consistent" or "inconclusive" — absence of change is never a discrepancy |
| UV features, Proof marks | Marked *not supported by device* | Requires UV light / grader service |
| Multimodal AI explanations | Not enabled (provider-agnostic hook planned) | Must only narrate deterministic evidence; never decide |
| Billing: Stripe web | **Implemented** (Checkout, Portal, verified webhooks) | Needs Stripe products/prices + portal config |
| Billing: iOS/Android | **Implemented** via RevenueCat SDK + server reconcile | Needs App Store Connect / Play Console products and RevenueCat project |

## Store policy notes (verify before launch — rules change)
- **iOS**: digital subscriptions sold in-app must use In-App Purchase. Following the 2025 Epic v. Apple injunction, US-storefront apps may also link to web purchase; litigation over commissions continued into 2026, so confirm current guideline 3.1.1/3.1.3 text. Outside the US, no external purchase links/calls-to-action. The iOS app therefore sells via StoreKit only and shows no web-purchase links. In-app account deletion is provided (guideline 5.1.1(v)).
- **Google Play**: subscriptions use Play Billing; alternative/user-choice billing programs vary by country — not used.
- **Auto-renewal disclosures**: price, period, renewal and cancellation terms are shown on both paywalls. No automatic enrollment, no trials by default.
- A subscription bought in one store is honored everywhere (single entitlement), but can only be changed/canceled in the store where it was bought; the UI says so and blocks a second purchase elsewhere to avoid double billing.

## Unit economics guardrails
`processing_costs` records per-session estimated costs (rates in `config/costs.json`); the admin dashboard reports cost and contribution per verification. Expensive calls are cached (lookups 24h, comparisons per image pair, reverse search per photo hash) and gated by entitlement. Reconcile with real invoices before raising allowances or offering unlimited plans.

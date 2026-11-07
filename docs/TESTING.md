# Testing & Accuracy

## Automated suites
| Suite | Command | Covers |
|---|---|---|
| Core (vitest) | `pnpm --filter @slabguard/core test` | grader detection, cert extraction, rules engine (cloning, different copy, user-supplied caps, older-holder handling, UV unsupported, online-listing limits, screenshot detection), entitlement windows (month-end, annual monthly resets, cancel/refund/cross-provider) |
| Vision (pytest) | `cd services/vision && .venv/bin/python -m pytest` | same copy vs different copy vs different card, photo reuse, blur/glare/cut-off, QR + OCR, edge straightness, tilt hue shift, API |
| Web billing integration (vitest + Postgres) | `pnpm --filter @slabguard/web test` | 3 free allowed / 4th blocked (402 + upgrade), multiple photos = 1 credit, failure releases credit, job failure releases, concurrent scans at the limit, Stripe activation, duplicate webhooks, stale events, monthly reset (monthly & annual), upgrade/downgrade, cancel-until-period-end → Free with history kept, cross-device (App Store via RevenueCat), store refund via reconcile, refunds/disputes, provider outage, failed webhook retry |
| End-to-end pipeline | same command with vision running + `python -m tests.make_fixtures /tmp/claude-0/fixtures` (`FIXTURES_DIR` overrides) | upload → gate → reserve → analysis → report → consume; different copy flagged; blurry rejected without credit; retake re-analysis is free |

Synthetic fixtures (`services/vision/tests/synth.py`) generate cards sharing artwork but differing in cut and surface marks — they validate logic, **not real-world accuracy**.

## Accuracy evaluation plan (real data)
Dataset (authorized images only, independently labeled by at least two reviewers; disagreements adjudicated; AI output never used as ground truth):
genuine matched slabs · genuine with poor photos · same design/different copy · reused cert numbers · simulated wrong labels · different legitimate holder generations · official images with perspective/lighting differences · reholders · missing records · suspicious seams · photo replays and listing reuse.

Metrics per release: card-ID accuracy, OCR character/field error rate, design-match precision/recall, different-copy detection TPR at fixed FPR, holder-generation accuracy, overall false-positive and false-negative rates (by grader and by holder generation), capture completion rate, p50/p95 processing time, and a user-comprehension survey on report limitations. Thresholds live as named constants in `compare.py` / `holder.py` / `quality.py` for tuning.

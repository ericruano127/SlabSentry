# SlabGuard — graded-card slab verification

Evidence-based photographic screening of PSA/CGC (and more) graded slabs for collectors, on web, iOS and Android, with a freemium subscription system.

> Photos alone cannot guarantee authenticity. SlabGuard separates verified facts, visual inference and unresolved uncertainty, and tells you what would resolve it.

| Path | What |
|---|---|
| `packages/core` | Shared TS: grader registry, holder security library (versioned, with source status), rules engine, report model, plans & entitlements |
| `services/vision` | FastAPI + OpenCV + RapidOCR: quality gate, Reference Image Comparison Engine, Holder Security Inspection Engine |
| `apps/web` | Next.js app + REST API: auth, scan wizard, reports/PDF/share, credits ledger, Stripe & RevenueCat billing, admin metrics |
| `apps/mobile` | Expo app: guided capture, reports, StoreKit/Play Billing via RevenueCat, restore purchases |
| `config/plans.json`, `config/costs.json` | Plans/prices/allowances (seed; editable in Admin) and cost rates |
| `docs/` | [Research matrix](docs/RESEARCH_MATRIX.md) · [Feasibility](docs/FEASIBILITY.md) · [Architecture & API](docs/ARCHITECTURE.md) · [Milestones](docs/MILESTONES.md) · [Testing](docs/TESTING.md) · [Deployment](docs/DEPLOYMENT.md) · `screenshots/` |

Quick start: see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

# Local development & deployment

## Prerequisites
Node 22 + pnpm 10, Python 3.12+, PostgreSQL 14+ (or a Supabase project).

## Local development
```bash
pnpm install
cd services/vision && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && cd ../..
createdb slabguard                          # or point DATABASE_URL at Supabase
cp apps/web/.env.example apps/web/.env.local   # set AUTH_MODE=dev + NEXT_PUBLIC_AUTH_MODE=dev for local login
pnpm db:migrate                             # applies SQL migrations, seeds plans/grader/holder library
pnpm dev:vision                             # :8001
pnpm dev:web                                # :3000 (inline job worker in dev)
```
Mobile: `cd apps/mobile && EXPO_PUBLIC_API_URL=http://<LAN-IP>:3000 EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... npx expo start` (development build required for RevenueCat / Apple sign-in: `npx expo run:ios|android` or EAS).

## Tests
```bash
pnpm --filter @slabguard/core test
(cd services/vision && .venv/bin/python -m pytest -q)
createdb slabguard_test && pnpm --filter @slabguard/web test   # TEST_DATABASE_URL to override
```

## Production
| Component | Suggested host | Notes |
|---|---|---|
| Web/API | Any Node host (container, Fly, Render, Vercel) | `pnpm --filter @slabguard/web build && start`. On serverless hosts set `INLINE_WORKER=0` and run the worker separately |
| Worker | Same image, `pnpm worker` | scale horizontally (jobs use `FOR UPDATE SKIP LOCKED`); Power plan jobs get priority |
| Vision | `services/vision/Dockerfile` | private network only; set `VISION_API_KEY` on both sides; 1–2 vCPU per worker |
| DB/Auth/Storage | Supabase | run `pnpm db:migrate` with the direct connection string; create **private** bucket `slab-images`; enable "Confirm email", Google and Apple providers; add redirect URLs `https://<domain>/auth/callback`, `https://<domain>/reset-password`, `slabguard://` |

AUTH_MODE=dev is ignored when `NODE_ENV=production`.

### Stripe (web)
1. Create products/prices matching `config/plans.json` price ids; set `STRIPE_PRICE_PRO_MONTH` etc. (or edit in Admin → Plans) and re-run migrate with `PLANS_FORCE_SYNC=1` on first setup.
2. Customer Portal: allow plan switching between these prices (upgrades prorated immediately; schedule downgrades at period end) and cancellation at period end.
3. Webhook → `https://<domain>/api/webhooks/stripe`, events: `checkout.session.completed`, `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`. Set `STRIPE_WEBHOOK_SECRET`.
4. Refund runbook: refund + cancel the subscription in Stripe; access ends via `customer.subscription.deleted`.
5. Test with Stripe test mode + `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.

### App Store / Google Play via RevenueCat
1. Create auto-renewable subscriptions with ids from `config/plans.json` (`slabguard.pro.monthly`, … / Play `slabguard_pro:monthly` = subscription:base-plan).
2. RevenueCat: add both apps, products, an entitlement per plan and a current offering containing all packages. Put public SDK keys in `app.json → extra` (or EXPO_PUBLIC_RC_*).
3. Webhook → `https://<domain>/api/webhooks/revenuecat` with an Authorization header value; set `REVENUECAT_WEBHOOK_AUTH` to the same exact value, and `REVENUECAT_SECRET_API_KEY` (server reconciliation is the source of truth).
4. Sandbox: Apple sandbox testers / Play license testers. Sandbox events are ignored in production unless `ALLOW_SANDBOX_PURCHASES=1`.

### Security checklist
Private storage only; images served to owner via API · RLS enabled on all tables (no PostgREST access) · server never trusts client plan/credit values · webhook signatures/secrets verified, idempotent processing · rate limits on create/upload/analyze/checkout · upload size/type sniffing · admin actions audited · account deletion removes photos and auth user (payments kept with user unlinked for accounting).

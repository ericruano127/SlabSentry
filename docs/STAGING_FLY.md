# Staging on Fly.io

Staging runs the same images as production on Fly.io. After one-time setup, every push to `main` that passes CI deploys automatically.

```
Internet ──HTTPS──▶ slabsentry-staging-web  (Fly app)
                     ├─ process "app"    : Next.js web/API   (public, fly.dev)
                     └─ process "worker" : analysis job workers
                           │  http://slabsentry-staging-vision.flycast  (private network only)
                           ▼
                    slabsentry-staging-vision (Fly app, NO public IPs, scales to zero)
                     └─ image-analysis service (VISION_API_KEY required)

Fly Managed Postgres (PgBouncer) · Upstash Redis (via Fly) · Supabase (auth + private image storage)
```

| File | Purpose |
|---|---|
| `fly.staging.toml` | Web and worker app: process groups, health check on `/api/ready`, migrations as `release_command` |
| `services/vision/fly.staging.toml` | Private analysis app: Flycast, scale-to-zero, 2 processes × 1 thread on a 2-vCPU Machine |
| `.github/workflows/deploy-staging.yml` | After CI passes on `main`: deploys vision, then web (migrations first), then smoke tests |
| `.github/workflows/ci.yml` (`images` job) | Builds both images on every push, and checks that the vision image runs as non-root and its health check answers |
| `.github/workflows/loadtest-staging.yml` | Manual k6 run against staging |

Supabase is still needed for **sign-in and private image storage**; Fly provides the compute, Postgres and Redis. Use a **separate Supabase project for staging**, never production's.

## One-time setup (about 30 minutes)
Install flyctl and sign in (`fly auth login`). Use region `iad` (or change `primary_region` in both files). Put the Supabase staging project in the matching region, e.g. us-east-1.

### 1. Create the apps
App names are global on Fly. If these are taken, choose others and set the GitHub variables `FLY_WEB_APP` / `FLY_VISION_APP`.

```bash
fly apps create slabsentry-staging-web
```

```bash
fly apps create slabsentry-staging-vision
```

```bash
fly ips allocate-v6 --private -a slabsentry-staging-vision
```

After the first deploy, `fly ips list -a slabsentry-staging-vision` must show **only** a private address. The deploy workflow passes `--no-public-ips` and its smoke test fails if the vision app answers publicly.

### 2. Postgres (Fly Managed Postgres) and Redis

```bash
fly mpg create --name slabsentry-staging --region iad --plan basic
```

```bash
fly redis create --name slabsentry-staging-redis --region iad --no-replicas
```

**Pool mode:** in the cluster's settings, set the PgBouncer pool mode to **Transaction**. The app is compatible: its advisory locks are transaction-scoped and it doesn't use named prepared statements.

**Database URLs:** from the cluster's **Connect** tab, copy the **pooled** URL (`pgbouncer.…flympg.net`) and the **direct** URL (`direct.…flympg.net`). Then add `?sslmode=require` to both. The production startup check refuses database URLs without TLS, and Node's Postgres client only uses TLS when the URL asks for it. Set them yourself rather than with `fly mpg attach`, because attach writes a URL without `sslmode`.

### 3. Secrets
Set these with `fly secrets set NAME=value -a <app>`. Never commit them, and never paste them into chat. Use your secrets manager or a terminal.

**Web app (`slabsentry-staging-web`), used by both the app and worker processes:**

| Secret | Value |
|---|---|
| `DATABASE_URL` | Pooled MPG URL + `?sslmode=require` |
| `DIRECT_DATABASE_URL` | Direct MPG URL + `?sslmode=require` (migrations only) |
| `REDIS_URL` | Private URL from `fly redis create` / `fly redis status` |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Staging Supabase project. Also needed at runtime for the startup check |
| `SUPABASE_SERVICE_ROLE_KEY` | Staging Supabase service role key (private storage, account deletion) |
| `SUPABASE_JWT_SECRET` | Staging project JWT secret. Omit it to verify sign-ins with the project's public keys (JWKS) instead |
| `VISION_URL` | `http://slabsentry-staging-vision.flycast` |
| `VISION_API_KEY` | A long random value, **identical** on both apps |
| `CERT_HASH_SECRET` | 32+ random characters (staging-only value) |
| `METRICS_TOKEN` | Random value (for Grafana scraping in the next step) |
| `ADMIN_EMAILS` | Your email, to bootstrap the first staff owner |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Optional: Stripe **test-mode** keys only |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` | Optional: Grafana Cloud telemetry (`docs/MONITORING.md`) |

**Vision app (`slabsentry-staging-vision`):** `VISION_API_KEY` (same value as above). Optionally, the same two `OTEL_*` secrets.

`ALLOW_UNREVIEWED_LEGAL=1` is already set in `fly.staging.toml`. It allows the draft legal texts on staging only, and **production must not set it**.

### 4. GitHub
In **Settings → Environments**, create an environment named **`staging`** and add:

| Kind | Name | Value |
|---|---|---|
| Secret | `FLY_API_TOKEN` | Output of `fly tokens create org` (deploys both apps; a per-app `fly tokens create deploy` can't deploy both) |
| Variable | `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY` | Staging Supabase URL and anon key (public; compiled into the web bundle) |
| Variable | `STAGING_APP_URL` | `https://slabsentry-staging-web.fly.dev` (or your custom staging domain) |
| Variable (optional) | `FLY_WEB_APP`, `FLY_VISION_APP` | Only if you chose different app names |
| Secret (load tests) | `STAGING_SUPABASE_JWT_SECRET` | Lets k6 mint test-user sign-ins. Staging only |

Until `FLY_API_TOKEN` exists, the deploy workflow skips with a notice instead of failing.

### 5. First deploy and scaling
Push to `main`, or run **Actions → deploy-staging → Run workflow**.

Then give the vision app spare Machines that can start under load. Stopped Machines cost almost nothing.

```bash
fly scale count 3 -a slabsentry-staging-vision
```

```bash
fly scale count app=1 worker=2 -a slabsentry-staging-web
```

Then:
1. Add `https://slabsentry-staging-web.fly.dev/auth/callback` to the Supabase redirect URLs.
2. Sign in once with the `ADMIN_EMAILS` address.
3. Enable 2FA (required for staff tools).

## How a deploy works
1. **CI** passes on `main`: tests, plus a build of both images.
2. **deploy-staging** checks out exactly that commit.
3. It deploys **vision**: private, never public.
4. It deploys **web + worker**. Fly builds the image with the public Supabase values, runs **migrations** in a temporary Machine over the direct database URL (the deploy stops if they fail), then rolls Machines one at a time.
5. **Smoke test:** `/api/ready` must return 200, and the vision app must *not* answer from the internet. `/api/ready` requires the database and library; it only reports on vision, so a scaled-to-zero vision app never fails web health checks.

**Rollback:** `fly releases -a slabsentry-staging-web`, then `fly deploy --image <previous image>`. Migrations are forward-only, so write them to be backwards-compatible with the previous release.

## Load testing staging
Go to **Actions → loadtest-staging → Run workflow** and pick a scenario (`api-mix`, `stress` or `spike`) and a user count. The workflow:
- refuses to run unless the target URL looks like staging;
- uploads k6's summary as an artifact;
- is limited by one GitHub runner, which handles about 2,000 virtual users. For the full 10,000, run `loadtest/k6/*.js` from k6 Cloud or several runners.

Record results in `docs/SCALING.md`.

## Costs (staging, approximate)
- Web: one always-on shared-cpu-1x. Workers: shared-cpu-1x each.
- Vision: shared-cpu-2x, scaling to zero when idle.
- MPG basic plan and pay-as-you-go Redis.

Check current Fly pricing before scaling up. For production, use performance CPUs for vision; shared CPUs are throttled under sustained load.

## Not verified from this environment
fly.io isn't reachable from the development sandbox. These files follow Fly's current documentation (`superfly/docs`, checked 2026-11-11) but haven't been run against a real Fly account.

**Verified here:**
- TOML parses.
- The workflows pass `actionlint`.
- The Docker dependency install and production build succeed with the new `.dockerignore`, and no `.env` files reach the output.

The CI `images` job builds both images on GitHub. Expect the first real deploy to surface small fixes (app names, region, secrets).

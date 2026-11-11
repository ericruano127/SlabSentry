# Production on Fly.io

Production uses the same images and layout as staging (`docs/STAGING_FLY.md`). The differences are deliberately stricter:

| | Staging | Production |
|---|---|---|
| Config | `fly.staging.toml`, `services/vision/fly.staging.toml` | `fly.production.toml`, `services/vision/fly.production.toml` |
| Deploys | Automatically after CI on `main` | **Manual** (`deploy-production` workflow) after **approval** |
| What can deploy | Pushes to `main` in this repo | A commit **on `main`** with a **successful CI run** (checked by the workflow) |
| Strategy | Rolling | **Blue-green**: new Machines take traffic only after all pass health checks |
| Rollback | Manual | **Automatic** if the post-deploy smoke test fails (previous images redeployed) |
| Web Machines | 1 minimum, can stop when idle | **2 minimum, always on** |
| Vision Machines | Shared CPU, scales to zero | **Dedicated CPUs (performance, 2 vCPU, 4 GB)**, 2 always warm |
| Legal texts | Drafts allowed (`ALLOW_UNREVIEWED_LEGAL=1`) | **Server refuses to start until they're approved** |
| Trace sampling | 100% | 25% (metrics and logs unaffected) |
| Billing | Stripe test mode | Stripe live, RevenueCat production |

## One-time setup
Follow `docs/STAGING_FLY.md` steps 1–3 with production names and **production-only** resources:
- **Apps:**
  - `fly apps create slabsentry-web` and `fly apps create slabsentry-vision`;
  - `fly ips allocate-v6 --private -a slabsentry-vision`.

  If you use other names, set `FLY_WEB_APP` / `FLY_VISION_APP` on the GitHub `production` environment.
- **Database:**
  - `fly mpg create --name slabsentry-production --plan launch` (or larger; see `docs/SCALING.md`);
  - PgBouncer **Transaction** mode;
  - pooled and direct URLs with `?sslmode=require`.

  **Backups:** MPG includes automatic backups. Confirm the retention period in the dashboard, and **test a restore** before launch.
- **Redis:** `fly redis create --name slabsentry-production-redis`.
- **Supabase:** a **separate production project**, with email confirmation on, Google/Apple providers, a private `slab-images` bucket, and redirect URLs on your production domain.
- **Secrets:** the same names as staging, with production values. Stripe uses **live** keys and its own webhook secret. Telemetry uses `service.namespace=production`, which is already in the config.
- **Custom domain:** `fly certs add app.yourdomain.com -a slabsentry-web`, then set `PRODUCTION_APP_URL`. The Stripe, RevenueCat and Supabase callback URLs must use this domain.

### GitHub `production` environment
| Kind | Name | Value |
|---|---|---|
| **Protection** | Required reviewers | You, plus anyone else who may approve releases. **This is the manual approval.** |
| **Protection** | Deployment branches | `main` only |
| Secret | `FLY_API_TOKEN` | An org token for the production org. Don't reuse staging's |
| Variable | `PRODUCTION_APP_URL` | e.g. `https://app.yourdomain.com` |
| Variable | `PRODUCTION_SUPABASE_URL`, `PRODUCTION_SUPABASE_ANON_KEY` | Production Supabase project (public values) |

Optionally, put production in a **separate Fly organization** from staging, so a staging token can never touch production.

## Releasing
1. Merge to `main`. CI runs, and staging deploys automatically. Check staging.
2. Go to **Actions → deploy-production → Run workflow**, and enter the commit SHA (or `main`).
3. The approver gets a notification and approves in GitHub.
4. The workflow then:
   1. checks the commit is on `main` and passed CI;
   2. records the running images;
   3. deploys vision, then web and worker. Migrations run first; then blue-green: new Machines must pass `/api/ready` (web) and `/health` (vision, worker).
   4. smoke-tests `/api/ready` and `/api/plans`, and checks vision is *not* public;
   5. **on any failure, redeploys the previous images** and marks the run failed.
5. Publish patch notes for the release (Staff tools → Quality & releases). The release gate there blocks accuracy regressions.

### Database migrations must be backwards-compatible
During a blue-green deploy, and after a rollback, the **previous** release runs against the **new** schema. Use the expand → deploy → contract pattern:
1. **Expand:** add new columns or tables (nullable or with defaults), and deploy code that writes both the old and new shape.
2. **Contract:** in a *later* release, once nothing reads the old shape, remove it in a migration that starts with `-- contract: <reason>`.

CI enforces this. `scripts/check-migrations.mjs` fails on `DROP TABLE`, `DROP COLUMN`, `RENAME`, type changes and `SET NOT NULL` unless the migration is marked as a contract step. Rollbacks redeploy images only; **migrations are never reversed automatically.**

## Operations
- **Manual rollback:** run `fly releases --image -a slabsentry-web` to list images, then `fly deploy --config fly.production.toml -a slabsentry-web --image <image>`.
- **Scaling:**
  - `fly scale count app=4 worker=4 -a slabsentry-web`;
  - add vision Machines that start under load with `fly scale count 6 -a slabsentry-vision`.

  The thresholds are in `docs/SCALING.md`; watch the Grafana dashboard.
- **Health:**
  - web: `/api/ready`;
  - worker: an internal check on port 8081 (Fly restarts a worker stuck for more than 5 minutes);
  - vision: `/health`.
- **Incidents:** `docs/security/INCIDENT_RESPONSE.md`. Alerts are listed in `docs/MONITORING.md`.

## Not verified from this environment
fly.io and GitHub environments with real accounts can't be exercised from the development sandbox.

**Verified here:**
- configs parse;
- workflows pass `actionlint`;
- the migration check behaves as designed;
- the worker health endpoint and graceful shutdown were tested with a real worker process;
- both images build in CI.

**To do on first use:** run the first production deploy with someone watching, then trigger a deliberate rollback once (for example, deploy a commit with a broken `/api/ready` to a throwaway app) to confirm the rollback path end to end.

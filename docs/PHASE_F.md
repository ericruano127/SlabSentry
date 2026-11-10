# Phase F — Scale & operations (done 2026-11-10)

## What was built
| Area | Implementation |
|---|---|
| Rate limits | `lib/ratelimit.ts`: Redis (`REDIS_URL`, INCR+EXPIRE, 500 ms command timeout) shared across all instances; falls back to the Postgres `rate_limits` table when Redis is unset or unreachable. `consumeQuota()` for global quotas. |
| PSA quota / throttle | `lib/graders/lookup.ts`: deployment-wide daily quota (`PSA_DAILY_LIMIT`, 2 calls per lookup) and per-second throttle (`PSA_PER_SECOND`). Over the limit → `providerError: quota_exhausted / throttled`, never an error page. |
| Connection pooling | `lib/db.ts`: `DB_POOL_MAX`, idle/connect timeouts, `statement_timeout` (`DB_STATEMENT_TIMEOUT_MS`). PgBouncer transaction mode is safe (advisory locks are transaction-scoped). |
| Job progress | Migration `008_operations.sql` (`progress`, `stage`, job `started_at/finished_at`). The pipeline reports stages (15 → 92 %, then 100 %); the session page shows a progress bar, the stage and how many reports are ahead in the queue. |
| Images | `storage.signedUrl()`: `/api/images/:id` redirects to a 5-minute signed storage/CDN URL after the ownership check; local storage streams as before. |
| Health | `/api/health` (liveness); `/api/ready` (database + library required → 503 otherwise; vision and queue reported but non-blocking, so the API stays up for history and reports while vision is down). |
| Metrics | `/api/metrics` (Prometheus text, bearer `METRICS_TOKEN`): jobs by status, oldest queued age, analysis p50/p95, sessions completed/failed per hour, billing webhook failures, HTTP counts by status class and a latency histogram, rate-limit hits, errors. |
| Logging & errors | `lib/log.ts`: JSON log lines carrying the request id (`x-request-id` is echoed on every response); slow (>2 s) and failed requests are logged; 5xx and job failures go to `ALERT_WEBHOOK_URL` (throttled per error). |
| Deployment | Standalone Next output; `Dockerfile.web` (non-root, healthcheck); `docker-compose.yml` (postgres, redis, vision, migrate, web, 2 workers); `deploy/k8s/slabguard.yaml` (web HPA 4–60 + PDB, workers via KEDA on queue depth 2–80, vision HPA 4–120 with `VISION_THREADS`); `deploy/monitoring/alerts.yml`. |
| Load testing | k6 suites (`loadtest/k6`: mix / stress / spike, 10k users) for staging; local autocannon runner and analysis-throughput benchmark. Results and capacity model: `docs/SCALING.md`. |

## Graceful degradation matrix
| Dependency unavailable | What the user gets | Credit | Tested |
|---|---|---|---|
| PSA API down or daily quota used up | Report is still generated and marked partial: "Official record (daily lookup limit reached…)" leads the "what we couldn't check" list (`report.degraded`) | Released if no reference comparison was possible; otherwise charged (the photo checks ran) | ✅ `phaseF.test.ts` |
| Vision service down | Job retried 3× with backoff (20 s, 40 s); then fails with "temporarily unavailable" | Released | ✅ `phaseF.test.ts` |
| Redis down / unset | Rate limits fall back to Postgres (slower but correct) | n/a | ✅ unset (`phaseF.test.ts`); unreachable: code path (500 ms command timeout) |
| Market data (FMV) unavailable | Report without the market section; listed as degraded | Charged (core checks ran) | code path |
| Reverse image search unavailable | Report without that check; listed as degraded | Charged | code path |
| Postgres down | `/api/ready` returns 503 so the load balancer stops routing; no partial writes | n/a | ✅ ready route test |
| Signed URLs unavailable (local storage) | Images streamed through the app after the ownership check | n/a | code path |
| Alert webhook down | Errors still in JSON logs | n/a | — |

## Tests
`apps/web/test/phaseF.test.ts` covers:
- the Postgres limiter, and the Redis backend (counts held in Redis only);
- PSA quota exhaustion leading to a partial report with progress 5 → 100 and the credit released;
- vision outage (retry with backoff, then a clear failure message and the credit released);
- readiness and metrics token checks.

Load and benchmark results are in `docs/SCALING.md`.

## Honest limits
- **The 10k-user target isn't proven here.** Measured on one shared 4-vCPU container:
  - one Node process sustains about 850 rps and first fails at about 2,000 simultaneous connections;
  - an analysis costs about 9 vCPU-seconds.

  The 10k-user figure is an extrapolation. Run the k6 suites on staging before launch.
- **Container files weren't run.** The Docker daemon isn't available in this environment, so `Dockerfile.web`, compose and the k8s manifests were written but not built or applied. The standalone build they rely on *was* verified.
- **No OpenTelemetry tracing.** Correlation uses request ids in JSON logs plus Prometheus metrics. Add an OTel exporter when an APM vendor is chosen.
- **The PSA daily allowance (100 by default) is the practical capacity ceiling.** It has to be raised with PSA before launch; compute scaling doesn't help.

# Scaling, capacity & load testing

Target: **10,000 concurrent users** with acceptable latency and no dropped analyses.

**What was measured here, and what wasn't.** The numbers below come from reduced-scale runs on one
4-vCPU / 16 GB development container. That one machine ran Postgres, Redis, the vision service, a
second dev server *and* the load generator, all sharing the same CPUs. They are lower bounds per
process, not production figures. A full 10,000-user run needs staging infrastructure; use the k6 suites in
`loadtest/k6/` there (instructions below) and replace the extrapolations in this file with measured values.

## 1. Results (2026-11-10, production build: `next build` + `next start`, Redis limiter, 2,000 distinct users)

Each user is a separate HS256 JWT (aal2) and was onboarded first (account row + consent), as a real
first visit would be. Browse mix: `/api/me`, `/api/sessions`, `/api/plans`, `/api/releases`. One Node process.

| Scenario | Connections | Throughput | p50 | p90 | p99 | Failures |
|---|---:|---:|---:|---:|---:|---:|
| Browse | 50 | 820 rps | 64 ms | 106 ms | 144 ms | 0 % |
| Browse | 200 | 789 rps | 285 ms | 426 ms | 570 ms | 0 % |
| Browse | 500 | 770 rps | 754 ms | 1.1 s | 2.0 s | 0 % |
| Write (25 % `POST /api/sessions`) + browse | 200 | 661 rps | 352 ms | 481 ms | 645 ms | 0 % |
| Spike: baseline → **1,500** → baseline | 20 → 1,500 → 20 | 873 → 700 → 811 rps | 22 ms → 2.2 s → 23 ms | | 60 ms → 2.8 s → 61 ms | 0 % |
| Stress | 100 | 850 rps | 127 ms | 198 ms | 290 ms | 0 % |
| Stress | 250 | 899 rps | 298 ms | 419 ms | 601 ms | 0 % |
| Stress | 500 | 650 rps | 830 ms | 1.4 s | 1.8 s | 0 % |
| Stress | 1,000 | 593 rps | 2.1 s | 2.5 s | 4.2 s | 0 % |
| Stress | **2,000** | 607 rps | 3.0 s | 6.0 s | 9.7 s | **0.44 %** (20 socket errors + 20 timeouts) |

Readings:
- **One process saturates at about 800–900 rps.** Past that, extra connections queue: latency grows and throughput doesn't.
- **Breaking point:** about 2,000 simultaneous connections on a single process. That is the first point where requests fail (timeouts at 10 s).
- **Rate limits, 429s and correctness:** no non-2xx responses in any run, and no credit or ledger anomalies.
- **Spike recovery:** immediate. Latency was back to baseline in the first second after the surge, and no errors occurred during it.

Raw JSON results are in `loadtest/results/`.

### Analysis throughput (`loadtest/local/analysis-bench.ts`)

Each run used 16 fresh sessions (front + back + reference, cert confirmed) on cold caches, with real vision calls.

| Vision | Workers | Wall time | Analyses/min | Job p50 | Job p95 |
|---|---:|---:|---:|---:|---:|
| 1 process | 1 | 39.1 s | 24.6 | 2.4 s | 2.6 s |
| 1 process | 2 | 38.1 s | 25.2 | 4.7 s | 4.9 s |
| 1 process | 4 | 36.5 s | 26.3 | 8.6 s | 10.6 s |
| 4 processes | 1 / 2 / 4 / 8 | 41 / 35 / 37 / 38 s | 23–27 | 2.5–9.7 s | up to 35 s |

**The vision service is CPU-bound.** OpenCV already uses every core for a single analysis, so all 4 vCPUs
were at 93 % or more user time. Adding workers or vision processes on the same machine only adds queueing.

**Cost: about 9 vCPU-seconds per analysis** (36 s × 4 vCPU / 16), roughly 6–7 analyses per minute per vCPU.
Analysis throughput therefore scales with the **total vision CPU** across pods, not with worker count.

### After the performance pass
See `docs/PERFORMANCE.md`. In summary:
- one process now serves about 950–1,080 req/s (up from 850–900);
- the median at 1,000 connections roughly halved (2.1 s → 1.1 s);
- `/api/me` makes 3 database round-trips instead of 10;
- analysis wait is about 15% shorter with multiple analysis pods;
- analysis pods answer health checks while busy.

At overload, the slowest 1% is now limited by queueing for the process's 10 database connections. Scale out, and don't raise the pool: 25 was worse.

## 2. Capacity model for 10,000 concurrent users

Assumptions (replace with product analytics once available):
- Average think time is 10 s. That gives about **1,000 API rps steady**; peak is planned at **3,000 rps** to cover page-load bursts.
- **Normal peak:** 10 % of active users start an analysis within a 10-minute window, i.e. 100 analyses/min.
- **Worst-case burst:** half of all users submit within 10 minutes, i.e. 500 analyses/min.

| Tier | Unit capacity (planning value) | Peak need | Sizing | Manifest (`deploy/k8s/slabguard.yaml`) |
|---|---|---|---|---|
| Web/API | 400 rps per 1-vCPU pod at the 60 % HPA target (half the measured single-process value) | 3,000 rps | ≈ 8 pods | HPA 4–60 |
| Vision | 2-vCPU pod ≈ 13 analyses/min (9 vCPU-s each) | 100/min normal, 500/min burst | 8–12 pods normal, ≈ 40–60 burst | HPA 4–120, `VISION_THREADS=2` |
| Workers | I/O-bound (wait on vision); 1 job at a time | ≈ 1–2 per vision pod | KEDA on queue depth (target 4 per worker) | 2–80 |
| Postgres | Each authenticated request makes about 3 round-trips (user, entitlements, data); see `test/queryBudget.test.ts` | 3,000 rps → ≈ 6–9k qps | Managed Postgres sized for this, **behind PgBouncer** (transaction mode is safe: advisory locks are transaction-scoped); keep `DB_POOL_MAX × processes` under the pooler limit | external |
| Redis | INCR + EXPIRE per rate-limited call | ≈ 3k ops/s | A single small instance is plenty | external |
| PSA API | 100 calls/day by default (2 per lookup) | **This is the real ceiling, not compute** | Global quota (`PSA_DAILY_LIMIT`). When exhausted, users get a partial report with the credit released. **A higher API tier is needed before launch.** | n/a |

Expected bottlenecks, in order:
1. **PSA quota.** Once the daily allowance is used, every further lookup that day is degraded.
2. **Vision CPU during bursts.** The queue absorbs bursts: jobs wait rather than fail, and users see their queue position. Watch the `AnalysisQueueBacklog` alert.
3. **Postgres connections and qps** at full API load. Mitigations, if staging shows pressure:
   - cache the user/consent row per process for a few seconds;
   - add a read replica for history listings.

Caveats on extrapolation:
- Results from one container shared with every other service don't transfer linearly to dedicated pods.
- Network latency to managed Postgres and Redis adds roughly 1–3 ms per query in a real deployment, and none of that was measured here.
- Analysis cost depends on image resolution and which optional checks run: tilt video, UV, microprint, and reverse image search (which is external).

## 3. Running the suites

### Local, reduced scale (single machine)

1. Build: `pnpm --filter web build`
2. Start the server: `NODE_ENV=production SUPABASE_JWT_SECRET=… next start -p 3100`. Production startup checks also need these set (dummy values are fine locally): `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`, `VISION_API_KEY`, `CERT_HASH_SECRET` (32+ characters), `ALLOW_UNREVIEWED_LEGAL=1`.
3. Run the load scenarios:

```bash
SUPABASE_JWT_SECRET=… node loadtest/local/run.mjs all --users 2000 --base http://localhost:3100
```

Scenarios: `browse | write | spike | stress | all`. The stress ramp stops at the first step with more than 5 % failures or p99 above 5 s.

4. Run the analysis benchmark. It uses a dedicated database and resets it:

```bash
cd apps/web && INLINE_WORKER=0 DATABASE_URL=postgres://…/slabguard_bench VISION_URL=http://127.0.0.1:8001 \
  npx tsx ../../loadtest/local/analysis-bench.ts --sessions 16 --workers 1,2,4
```

### Staging, full scale (k6)

Only run these against staging, with a **staging** JWT secret. Never point them at production auth or billing.

```bash
k6 run -e BASE_URL=https://staging.example -e JWT_SECRET=$STAGING_JWT_SECRET -e USERS=10000 loadtest/k6/api-mix.js
```

```bash
k6 run -e BASE_URL=… -e JWT_SECRET=… loadtest/k6/stress.js
```

```bash
k6 run -e BASE_URL=… -e JWT_SECRET=… loadtest/k6/spike.js
```

What each script does:
- `api-mix.js`: ramps to `USERS` virtual users. Thresholds: failed requests under 1 %, read p95 under 500 ms, write p95 under 1 s.
- `stress.js`: arrival rate ramps from 100 to 6,000 rps and aborts when thresholds break. This finds the breaking point.
- `spike.js`: 50 → 10,000 VUs in 30 s, then recovery.

Run them from distributed load generators (k6 Cloud or several runners): one generator can't open 10,000 connections reliably.

Watch Grafana/Prometheus (`/api/metrics`) and the alerts in `deploy/monitoring/alerts.yml` during the run.

**Re-run after every major patch** (release gate, Phase E). Record the results in this file.

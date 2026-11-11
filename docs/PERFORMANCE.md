# Performance pass (2026-11-10)

**Goal:** lower database load per request and the cost and wait of each analysis, without changing analysis results or caching anything that would delay a purchase showing up.

All numbers come from one shared 4-vCPU container. Postgres, Redis, the analysis service and the load generator all shared the same CPUs, so the numbers are noisy. Comparisons were run back to back.

## 1. Database round-trips per request
Every API response now records how many database round-trips it made. This feeds the `slabguard_db_queries_total` metric and slow-request logs. The `x-db-queries` header appears outside production, or in production with `EXPOSE_QUERY_COUNT=1`.

`test/queryBudget.test.ts` fails if any of these counts grows:

| Endpoint | Before | After | How |
|---|---:|---:|---|
| `GET /api/me` | 10 | **3** | See the list below |
| `GET /api/sessions` | 4 | **3** | Consent checked from the user row already loaded during sign-in |
| `POST /api/sessions` | 4 | **3** | Same |
| `GET /api/releases` | 1 | **0** | Patch notes cached (30 s, cleared on publish) |
| `GET /api/plans`, `GET /api/library` | 0 | 0 | Already cached |

How `/api/me` went from 10 to 3:
- The user row is read once instead of three times.
- There is no transaction for a read-only summary.
- One query covers all credit buckets.
- The subscription-period row is written only when it's missing or out of date. It used to be upserted on every request.

**Not cached, on purpose:** a user's subscriptions and credits. A purchase or a used credit must show up on the very next request on every server.

### Cache stampedes
The legal documents, plans, library and patch-notes caches now refresh **single-flight**: when a value expires under load, one request reloads it and the rest wait for that same result. Before, every request in flight would query the database at once.

Legal documents, plans and patch notes also serve the previous value while the refresh runs. Staleness is bounded: never more than the cache lifetime plus one reload.

The library never serves a stale value, so a failed integrity check still pauses analysis immediately. Tests: `test/cache.test.ts`.

## 2. API throughput
Stress ramp, browse mix, one Node process, database pool 10, two runs each.

| Connections | Before: req/s | After: req/s | Before: median | After: median | Before: slowest 1% | After: slowest 1% |
|---:|---:|---:|---:|---:|---:|---:|
| 100 | 850 | 950–1,035 | 127 ms | 101 ms | 290 ms | 280–346 ms |
| 250 | 899 | 991–1,062 | 298 ms | 234–274 ms | 601 ms | 695–725 ms |
| 500 | 650 | 928–1,079 | 830 ms | 626–630 ms | 1.8 s | 2.1–2.5 s |
| 1,000 | 593 | 858–871 | 2.1 s | 1.04–1.09 s | 4.2 s | 6.0–6.7 s |

**Reading:**
- Throughput is up 15–60% under load, and the median at 1,000 connections roughly halved. There were no failures up to 1,000 connections.
- The slowest 1% at 500 and above got *worse*. The server's own latency histogram shows why: requests that need no database finish in under 50 ms, while requests that need it queue for one of the process's 10 database connections. The process now admits more requests per second, so that queue is longer at overload.
- **This is overload of a single process, not slow code.** In production the autoscaler adds web pods at 60% CPU, long before one pod sees 500+ simultaneous connections.

**Database pool size.** Raising `DB_POOL_MAX` from 10 to 25 made things worse here: the slowest 1% was 4.5–8.1 s, and 5.7% of requests timed out at 1,000 connections, because Postgres was competing for the same CPUs. Keep pools small per process, add processes, and put PgBouncer in front.

## 3. Analysis
| Change | Effect |
|---|---|
| Independent checks run concurrently in the pipeline: integrity and edge reviews start alongside holder inspection; front/back comparisons run together; label/UV/microprint run together | Analysis wait **4.9–5.2 s → 4.2 s (about 15%)** against 4 analysis processes, measured back to back. No change against a single process, because its requests are handled one at a time. Same work and same results; only waiting is removed |
| Analysis service: CPU work moved off the event loop onto a worker thread, one analysis at a time per process (`VISION_CONCURRENCY`, default 1) | **Health check during load: 1.05 s → 2 ms.** Before, a busy pod couldn't answer its health check (Kubernetes' default probe timeout is 1 s), so pods could be marked unhealthy and restarted under load. Throughput is unchanged |
| OCR models load at startup (`VISION_WARMUP`, default on) | A new pod's first request no longer waits for model loading (about 2.7 s). Readiness passes only once models are loaded, so autoscaled pods join warm |
| Holder inspection finds the slab once instead of three times | Small CPU saving per analysis |

### Measured but deliberately not changed
- **An analysis-sized copy of each photo.** It would avoid re-decoding a 12 MP original at every check (about 0.1 s each). A JPEG copy changed results: re-encoding moves pixels across the glare threshold, even at quality 100. A lossless PNG copy decodes no faster than the original JPEG. Since there was no gain without changing results, it was dropped.
- **OCR on the label region only (for cert extraction).** It saves 0.2 s but loses word spacing and the card name. Accuracy wins.
- **Cheaper reference comparison (SIFT at lower resolution).** This is the largest single cost (about 0.6 s of 1.8 s per comparison). It changes the feature counts the copy-matching thresholds were tuned on, so it should only be tried with labeled genuine and counterfeit photos to re-validate against. The accuracy dashboard and release gate exist for exactly this.

### Pages render per request (strict Content-Security-Policy)
Every page now renders on each request so it can carry a fresh nonce (`docs/security/CSP.md`). Measured on one production process, 20 connections:

| Page | Requests/s before → after | p50 before → after |
|---|---|---|
| `/` | 250 → 215 | 75 → 84 ms |
| `/pricing` | 289 → 262 | 63 → 73 ms |
| `/legal/terms` | 288 → 257 | 66 → 74 ms |

About 10–14% fewer page renders per process and ~10 ms more per page. Pages were never CDN-cached (they always came from the app server), and the API, which carries most of the load, is unchanged.

## Re-running
```bash
cd apps/web && npx vitest run test/queryBudget.test.ts
```

```bash
SUPABASE_JWT_SECRET=… node loadtest/local/run.mjs stress --users 2000 --base http://localhost:3100
```

```bash
cd apps/web && INLINE_WORKER=0 DATABASE_URL=…/slabguard_bench VISION_URL=… npx tsx ../../loadtest/local/analysis-bench.ts --sessions 12 --workers 1 --deep
```

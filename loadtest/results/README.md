# Load test results (raw)

Raw JSON output from `loadtest/local/run.mjs`. Summaries and interpretation are in `docs/SCALING.md` and `docs/PERFORMANCE.md`.

| Files | What they measured |
|---|---|
| `*T20-5*` | Phase F baseline (before the performance pass) |
| `*T22-3*`, `*T22-4*` | After the performance pass, database pool 10 |
| `*-pool10.json` / `*-pool25.json` | Pool-size comparison, run back to back |

All runs used one shared 4-vCPU container. Postgres, Redis, the analysis service and the load generator were all on the same machine.

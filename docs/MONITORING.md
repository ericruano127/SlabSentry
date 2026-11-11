# Monitoring with Grafana Cloud

The web app, workers and image-analysis service send **traces, metrics and logs** to Grafana Cloud over OpenTelemetry (OTLP). Telemetry is **off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set**, so local development and tests send nothing.

```
web (Next.js) ──┐   traces: requests, DB queries, Redis, outgoing fetch (vision, grader APIs, storage)
worker ─────────┼── metrics: API rate/latency/errors, DB round-trips, analysis outcome & duration, queue, billing
vision ─────────┘   logs:    JSON log lines as OTLP records, linked to the active trace
        │
        └──OTLP/HTTP (protobuf, Basic auth)──▶ Grafana Cloud: Tempo (traces) · Mimir (metrics) · Loki (logs)
```

**One analysis is one trace.** The worker's `analysis.job` span marks each pipeline stage as an event. It contains the database queries and the calls to the analysis service. The analysis service continues the same trace, so its endpoints and per-check work (`vision.compare`, `vision.inspect`, …) appear underneath.

## What is (and isn't) sent: privacy
Everything passes a redaction step **before export**: spans (including Next.js' own spans), span events, error messages and log records. The JSON log lines on stdout get the same treatment.

| Data | Treatment |
|---|---|
| Query strings (search terms, signed-URL tokens) | Replaced with `?[redacted]` |
| Runs of 6+ digits (certification numbers in grader API URLs, error messages) | `[number]` |
| Email addresses | `[email]` |
| Headers, bodies, cookies, tokens, passwords, API keys | Attribute dropped (`[redacted]`) |
| SQL | Statement text with `$n` placeholders only; parameter values are never recorded |
| Redis | Command name only (keys can contain user ids) |
| Photos / uploads | Never recorded |
| Session/user/job UUIDs | Kept: pseudonymous, and needed to follow a request |

Tests in `apps/web/test/telemetry.test.ts` run the redaction against real SDK spans and log records. It was also verified end to end against a local OTLP receiver: a full sign-in, search, upload and analysis flow, with zero occurrences of the cert number, email, signed-URL token or bearer token in anything exported.

Health, readiness and metrics probes are not traced. Fly checks every 15 seconds per Machine, which would otherwise dominate the traces.

## Setup (about 15 minutes)
1. **Create a stack.** Create a Grafana Cloud account (the free tier is fine to start) and a stack in a region near your Fly region.
2. **Find the OTLP endpoint.** In the stack, go to **Connections → Add new connection → OpenTelemetry (OTLP)**. Note the **OTLP endpoint** (like `https://otlp-gateway-prod-<region>.grafana.net/otlp`) and the **instance ID**. Create an **access policy token** with `metrics:write`, `logs:write` and `traces:write`. Grafana shows the ready-made `Authorization=Basic …` header; it is base64 of `instanceID:token`.
3. **Set the secrets on both Fly apps.** Never commit these or paste them into chat:

```bash
fly secrets set -a slabsentry-staging-web OTEL_EXPORTER_OTLP_ENDPOINT="https://otlp-gateway-prod-<region>.grafana.net/otlp" OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic <base64>"
```

```bash
fly secrets set -a slabsentry-staging-vision OTEL_EXPORTER_OTLP_ENDPOINT="https://otlp-gateway-prod-<region>.grafana.net/otlp" OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic <base64>"
```

   Service names and the environment are already configured in `fly.staging.toml`: `slabsentry-web`, `slabsentry-worker`, `slabsentry-vision`, plus `service.namespace=staging`.
4. **Import the dashboard.** In Grafana, go to **Dashboards → New → Import** and upload `deploy/monitoring/grafana-dashboard.json`. Pick your Prometheus (Mimir) data source and the `staging` environment.
5. **Load the alert rules** (`deploy/monitoring/grafana-cloud-rules.yml`) one of two ways:
   - In Grafana: **Alerting → Alert rules → Import to Grafana-managed rules**, choosing the file. This option's name can vary between Grafana versions.
   - Or with mimirtool:

```bash
mimirtool rules load deploy/monitoring/grafana-cloud-rules.yml --address=<prometheus-url> --id=<instance-id> --key=<token>
```

   Then add a **contact point** (email, Slack, PagerDuty) and route `severity=critical` to it.

For production, use the same steps with `service.namespace=production`. The dashboard's environment selector and the alerts' `job` labels keep the two apart.

## Metrics
OTLP names become Prometheus names in Grafana: dots become underscores, units become suffixes, and counters get `_total`. Each Machine reports its own series (`instance` = Fly Machine id), so values add up correctly across instances.

| Grafana name | What it is |
|---|---|
| `slabguard_api_requests_total{route,status_class}` | API requests (route ids collapsed; unknown paths grouped as `other`) |
| `slabguard_api_duration_seconds_bucket{route}` | API latency histogram |
| `slabguard_db_queries_total{route}` | DB round-trips (÷ requests = per-request budget; see `docs/PERFORMANCE.md`) |
| `slabguard_errors_total{route}`, `slabguard_rate_limited_total` | Unexpected errors; 429s |
| `slabguard_analyses_total{outcome}` | Finished jobs: `done`, `retry`, `failed`, `vision_unavailable`, `user_error`, `error` |
| `slabguard_analysis_duration_seconds_bucket{outcome}` | Time per analysis job |
| `slabguard_jobs{status}`, `slabguard_queue_oldest_age_seconds` | Queue health (reported by workers; use `max`) |
| `slabguard_billing_webhook_failures_last_hour` | Failed Stripe/RevenueCat webhooks |
| `db_client_connection_pending_requests` | Requests waiting for a pooled DB connection (first sign of DB saturation) |
| `http_server_duration_milliseconds_bucket{http_route}` (vision) | Analysis-service endpoint latency |

The exact suffixes depend on Grafana's OTLP translation settings. If a panel is empty, check the name in **Explore → Metrics**.

## Alerts (`grafana-cloud-rules.yml`)
| Alert | Fires when | Severity |
|---|---|---|
| AnalysisWorkersSilent | No worker has reported for 15 minutes (workers down) | critical |
| AnalysisFailures | More than 10% of analyses failing | critical |
| ApiErrorRate | API 5xx above 2% | critical |
| BillingWebhookFailures | Any failed billing webhook in the last hour | critical |
| AnalysisQueueBacklog | Oldest queued job older than 5 minutes | warning |
| AnalysisSlow | p95 analysis time above 60 s | warning |
| ApiLatency | API p95 above 1 s | warning |
| DatabasePoolSaturated | More than 20 requests waiting for DB connections | warning |
| DbQueriesPerRequestRegression | Average round-trips per request above 6 | info |
| RateLimitSpike | More than 5 rate-limited requests per second | info |

`ALERT_WEBHOOK_URL` (an immediate post for each new error type) still works alongside these.

## Volume and cost
- Each analysis produces about 115 spans, and each API request about 5–15.
- At high traffic, sample traces with `OTEL_TRACES_SAMPLER_ARG=0.1` (keeps 10% of traces, whole traces only; metrics and logs are unaffected).
- Metric cardinality is bounded: route labels are collapsed, and the series count grows with the number of Machines.
- Check Grafana Cloud's current free-tier limits before raising sampling or adding labels.

## Running it yourself
| Variable | Purpose |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Base OTLP URL; turns telemetry on |
| `OTEL_EXPORTER_OTLP_HEADERS` | Auth header (secret) |
| `OTEL_SERVICE_NAME` | Defaults: `slabsentry-web` / `-worker` / `-vision` |
| `OTEL_RESOURCE_ATTRIBUTES` | e.g. `service.namespace=staging,deployment.environment.name=staging` |
| `OTEL_TRACES_SAMPLER_ARG` | Trace sampling ratio (default 1) |
| `OTEL_METRIC_EXPORT_INTERVAL` | Metric push interval in ms (default 60000) |
| `OTEL_SDK_DISABLED=true` | Turns everything off |

The worker must start with the preload so ES-module code is instrumented:

```bash
node --import ./apps/web/scripts/otel-preload.mjs --import ./apps/web/node_modules/tsx/dist/loader.mjs apps/web/scripts/worker.ts
```

Docker Compose, Kubernetes and Fly already use this command, and CI checks the preload starts inside the built image.

## Verified vs. not verified
**Verified locally**, with a stand-in OTLP receiver that decodes exactly what Grafana Cloud would receive:
- all three services export (traces, metrics, logs);
- the auth header is sent;
- one analysis is one trace across worker and analysis service;
- database, Redis and fetch spans are present in the production Next.js build and in the ES-module worker;
- probes are filtered, and nothing leaks;
- all 31 PromQL expressions in the dashboard and rules parse.

**Not verified:** the connection to a real Grafana Cloud stack. Grafana isn't reachable from the development sandbox, so metric-name suffixes and the rule import should be checked on first use.

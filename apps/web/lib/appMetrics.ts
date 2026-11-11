import { metrics, type Attributes } from "@opentelemetry/api";
import { q } from "./db";

/**
 * Application metrics pushed over OTLP (Grafana Cloud names in brackets). They are no-ops unless
 * telemetry is started (lib/telemetry.mjs), so tests and local development record nothing.
 * Every process pushes its own series (service.instance.id = Fly Machine id), so counters from
 * several web/worker Machines add up correctly. That's why this replaces scraping /api/metrics
 * through a load balancer, which would hit a random instance each time.
 */
const meter = metrics.getMeter("slabsentry");

export const appMetrics = {
  dbQueries: meter.createCounter("slabguard.db.queries", { description: "Database round-trips made while serving API requests" }), // [slabguard_db_queries_total]
  requests: meter.createCounter("slabguard.api.requests", { description: "API requests handled" }), // [slabguard_api_requests_total]
  requestDuration: meter.createHistogram("slabguard.api.duration", {
    description: "API request latency (inside the app, excluding network)", unit: "s",
    advice: { explicitBucketBoundaries: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] },
  }), // [slabguard_api_duration_seconds_bucket]
  errors: meter.createCounter("slabguard.errors", { description: "Unexpected errors (5xx, failed jobs)" }), // [slabguard_errors_total]
  rateLimited: meter.createCounter("slabguard.rate_limited", { description: "Requests rejected by rate limits" }), // [slabguard_rate_limited_total]
  authFailures: meter.createCounter("slabguard.auth.failures", { description: "Rejected sign-in tokens and staff permission denials" }), // [slabguard_auth_failures_total{reason}]
  roleChanges: meter.createCounter("slabguard.admin.role_changes", { description: "Staff role assignments (also in the admin audit log)" }), // [slabguard_admin_role_changes_total{role}]
  analyses: meter.createCounter("slabguard.analyses", { description: "Analysis jobs finished, by outcome" }), // [slabguard_analyses_total{outcome}]
  analysisDuration: meter.createHistogram("slabguard.analysis.duration", {
    description: "Time to run one analysis job", unit: "s",
    advice: { explicitBucketBoundaries: [1, 2, 3, 5, 8, 13, 20, 30, 60, 120] },
  }), // [slabguard_analysis_duration_seconds_bucket]
};

/** Low-cardinality route label: ids collapsed, unknown paths grouped (404 probing can't explode series). */
export function routeLabel(pathname: string, status: number): Attributes {
  if (status === 404 || !pathname.startsWith("/api/")) return { route: "other" };
  // Share tokens are secrets and unbounded: never let them become a label value.
  return { route: pathname.replace(/[0-9a-f-]{36}/gi, ":id").replace(/\/(r|share)\/[^/]+/g, "/$1/:token").replace(/\/\d+(?=\/|$)/g, "/:n").slice(0, 80) };
}

let gaugesRegistered = false;
/**
 * Queue and billing health, observed by WORKER processes once per export interval (one small query
 * set per worker per minute). Every worker reports the same values; dashboards use max().
 */
export function registerWorkerGauges() {
  if (gaugesRegistered) return;
  gaugesRegistered = true;
  const jobs = meter.createObservableGauge("slabguard.jobs", { description: "Analysis jobs by status" }); // [slabguard_jobs{status}]
  const oldest = meter.createObservableGauge("slabguard.queue.oldest_age", { description: "Age of the oldest queued job", unit: "s" }); // [slabguard_queue_oldest_age_seconds]
  const hooks = meter.createObservableGauge("slabguard.billing.webhook_failures_last_hour", { description: "Failed billing webhooks in the last hour" });
  meter.addBatchObservableCallback(async (r) => {
    try {
      const byStatus = await q(`select status, count(*)::int n from jobs where status in ('queued','running') or finished_at > now() - interval '1 hour' group by status`);
      for (const s of ["queued", "running", "done", "failed"]) r.observe(jobs, byStatus.find((x) => x.status === s)?.n ?? 0, { status: s });
      const [age] = await q(`select coalesce(extract(epoch from now() - min(created_at)), 0)::float s from jobs where status='queued'`);
      r.observe(oldest, age.s);
      const [h] = await q(`select count(*) filter (where status='failed')::int failed from billing_events where received_at > now() - interval '1 hour'`);
      r.observe(hooks, h.failed);
    } catch { /* database unavailable: skip this interval rather than report zeros */ }
  }, [jobs, oldest, hooks]);
}

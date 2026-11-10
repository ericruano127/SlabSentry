import { timingSafeEqual } from "node:crypto";
import { q } from "@/lib/db";
import { httpStats } from "@/lib/http";
import { errorStats } from "@/lib/log";
import { limiterStats } from "@/lib/ratelimit";

/** Prometheus metrics (text format). Requires METRICS_TOKEN as a bearer token; disabled if unset. */
export async function GET(req: Request) {
  const token = process.env.METRICS_TOKEN;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!token || given.length !== token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(token))) return new Response("forbidden", { status: 403 });
  const jobs = await q(`select status, count(*)::int n from jobs group by status`);
  const [age] = await q(`select coalesce(extract(epoch from now() - min(created_at)), 0)::float s from jobs where status='queued'`);
  const durations = await q(`select extract(epoch from finished_at - started_at)::float s from jobs where finished_at > now() - interval '15 minutes' and started_at is not null and status='done'`);
  const [hooks] = await q(`select count(*) filter (where status='failed')::int failed from billing_events where received_at > now() - interval '1 hour'`);
  const [sess] = await q(`select count(*) filter (where status='failed')::int failed, count(*) filter (where status='completed')::int completed from verification_sessions where updated_at > now() - interval '1 hour'`);
  const sorted = durations.map((d) => d.s).sort((a, b) => a - b);
  const p = (x: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * x))] : 0);
  const lines = [
    "# HELP slabguard_jobs Jobs by status", "# TYPE slabguard_jobs gauge",
    ...jobs.map((j) => `slabguard_jobs{status="${j.status}"} ${j.n}`),
    "# TYPE slabguard_queue_oldest_seconds gauge", `slabguard_queue_oldest_seconds ${age.s.toFixed(1)}`,
    "# TYPE slabguard_analysis_seconds summary",
    `slabguard_analysis_seconds{quantile="0.5"} ${p(0.5).toFixed(2)}`, `slabguard_analysis_seconds{quantile="0.95"} ${p(0.95).toFixed(2)}`, `slabguard_analysis_seconds_count ${sorted.length}`,
    "# TYPE slabguard_sessions_last_hour gauge", `slabguard_sessions_last_hour{status="completed"} ${sess.completed}`, `slabguard_sessions_last_hour{status="failed"} ${sess.failed}`,
    "# TYPE slabguard_billing_webhook_failures_last_hour gauge", `slabguard_billing_webhook_failures_last_hour ${hooks.failed}`,
    "# TYPE slabguard_http_requests_total counter", ...[...httpStats.byStatus].map(([k, v]) => `slabguard_http_requests_total{class="${k}"} ${v}`),
    "# TYPE slabguard_http_request_seconds histogram",
    ...httpStats.latency.map((b) => `slabguard_http_request_seconds_bucket{le="${b.le}"} ${b.n}`), `slabguard_http_request_seconds_bucket{le="+Inf"} ${httpStats.count}`,
    `slabguard_http_request_seconds_sum ${httpStats.sum.toFixed(3)}`, `slabguard_http_request_seconds_count ${httpStats.count}`,
    "# TYPE slabguard_rate_limited_total counter", `slabguard_rate_limited_total ${limiterStats.rejected}`,
    "# TYPE slabguard_errors_total counter", `slabguard_errors_total ${errorStats.count}`,
  ];
  return new Response(lines.join("\n") + "\n", { headers: { "content-type": "text/plain; version=0.0.4" } });
}

/**
 * Structured JSON logs (one line per event) with request ids, ready for any log pipeline.
 * reportError() also forwards to ALERT_WEBHOOK_URL (e.g. Slack/PagerDuty relay), throttled per error key.
 */
import { logs, SeverityNumber } from "@opentelemetry/api";
import { redactText, traceIds } from "./telemetry.mjs";
import { appMetrics } from "./appMetrics";

type Level = "debug" | "info" | "warn" | "error";
const SEVERITY = { debug: SeverityNumber.DEBUG, info: SeverityNumber.INFO, warn: SeverityNumber.WARN, error: SeverityNumber.ERROR };

/** One JSON line to stdout (with trace_id/span_id when inside a trace) and, when telemetry is on, an OTLP
 * log record linked to the active span. Both pass through the same redaction rules before leaving. */
export function log(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV === "test" && level !== "error") return;
  const ids = traceIds();
  // Same redaction as exported telemetry: stdout ends up in the host's log system too.
  msg = redactText(msg);
  fields = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, typeof v === "string" ? redactText(v) : v]));
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, service: process.env.SERVICE_NAME ?? "slabguard-web", ...ids, ...fields });
  (level === "error" ? console.error : console.log)(line);
  logs.getLogger("slabsentry").emit({ // looked up per call: a no-op until telemetry has started
    severityNumber: SEVERITY[level], severityText: level, body: msg,
    attributes: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v == null || typeof v === "object" ? JSON.stringify(v) : (v as string | number | boolean)])),
  });
}

const lastAlert = new Map<string, number>();
export const errorStats = { count: 0 };

export function reportError(err: unknown, fields: Record<string, unknown> = {}) {
  errorStats.count++;
  appMetrics.errors.add(1, { route: String(fields.route ?? "unknown").slice(0, 80) });
  const e = err instanceof Error ? err : new Error(String(err));
  log("error", e.message, { ...fields, stack: e.stack?.split("\n").slice(0, 6).join(" | ") });
  const hook = process.env.ALERT_WEBHOOK_URL;
  if (!hook) return;
  const key = `${fields.route ?? ""}:${e.message.slice(0, 80)}`;
  if (Date.now() - (lastAlert.get(key) ?? 0) < 10 * 60_000) return; // one alert per error type per 10 min
  lastAlert.set(key, Date.now());
  fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: `[slabguard] ${e.message}`, fields }), signal: AbortSignal.timeout(5000) }).catch(() => {});
}

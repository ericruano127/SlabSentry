/**
 * Structured JSON logs (one line per event) with request ids, ready for any log pipeline.
 * reportError() also forwards to ALERT_WEBHOOK_URL (e.g. Slack/PagerDuty relay), throttled per error key.
 */
type Level = "debug" | "info" | "warn" | "error";
export function log(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV === "test" && level !== "error") return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, service: process.env.SERVICE_NAME ?? "slabguard-web", ...fields });
  (level === "error" ? console.error : console.log)(line);
}

const lastAlert = new Map<string, number>();
export const errorStats = { count: 0 };

export function reportError(err: unknown, fields: Record<string, unknown> = {}) {
  errorStats.count++;
  const e = err instanceof Error ? err : new Error(String(err));
  log("error", e.message, { ...fields, stack: e.stack?.split("\n").slice(0, 6).join(" | ") });
  const hook = process.env.ALERT_WEBHOOK_URL;
  if (!hook) return;
  const key = `${fields.route ?? ""}:${e.message.slice(0, 80)}`;
  if (Date.now() - (lastAlert.get(key) ?? 0) < 10 * 60_000) return; // one alert per error type per 10 min
  lastAlert.set(key, Date.now());
  fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: `[slabguard] ${e.message}`, fields }), signal: AbortSignal.timeout(5000) }).catch(() => {});
}

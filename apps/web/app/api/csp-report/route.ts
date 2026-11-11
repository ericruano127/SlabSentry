import { appMetrics } from "@/lib/appMetrics";
import { log } from "@/lib/log";
import { consumeQuota } from "@/lib/ratelimit";

/**
 * Content-Security-Policy violation reports (both the legacy report-uri format and the Reporting API).
 * Counted in the slabguard.csp.violations metric and logged (rate-capped) so a policy that blocks
 * something legitimate shows up in Grafana. Unauthenticated by design; bodies are capped and never echoed.
 */
const MAX_BYTES = 16_384;
const pathOnly = (u: unknown) => {
  if (typeof u !== "string" || !u) return "";
  if (!/^https?:/i.test(u)) return u.slice(0, 40); // "inline", "eval", "data", …
  try { const x = new URL(u); return x.origin + x.pathname.replace(/[0-9a-f-]{36}/g, ":id").replace(/\/(r|share)\/[^/]+/g, "/$1/:token"); } catch { return "invalid"; }
};

export async function POST(req: Request) {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) return new Response(null, { status: 413 });
  let body: unknown;
  try { body = JSON.parse((await req.text()).slice(0, MAX_BYTES)); } catch { return new Response(null, { status: 400 }); }
  const raw = Array.isArray(body) ? body.filter((r) => r?.type === "csp-violation").map((r) => r.body) : [(body as any)?.["csp-report"]];
  const reports = raw.filter(Boolean).slice(0, 10).map((r: any) => ({
    directive: String(r.effectiveDirective ?? r["effective-directive"] ?? r["violated-directive"] ?? "").split(" ")[0].slice(0, 40),
    blocked: pathOnly(r.blockedURL ?? r["blocked-uri"]),
    page: pathOnly(r.documentURL ?? r["document-uri"]),
    disposition: String(r.disposition ?? "enforce").slice(0, 10),
  }));
  for (const r of reports) appMetrics.cspViolations.add(1, { directive: r.directive || "unknown" });
  // Log at most 100 reports a minute across the app; metrics still count everything.
  if (reports.length && (await consumeQuota("csp-report-log", 100, 60).catch(() => ({ ok: false }))).ok) log("warn", "csp violation", { reports });
  return new Response(null, { status: 204 });
}

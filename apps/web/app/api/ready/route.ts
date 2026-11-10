import { one } from "@/lib/db";
import { env } from "@/lib/env";
import { loadLibrary } from "@/lib/library";

/**
 * Readiness: can this instance serve traffic? Database and reference library are required; the
 * vision service and queue depth are reported (analysis degrades/queues rather than failing reads).
 */
export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};
  const timed = async (name: string, fn: () => Promise<string | void>, required = true) => {
    const t = Date.now();
    try { checks[name] = { ok: true, detail: `${(await fn()) ?? "ok"} (${Date.now() - t}ms)` }; }
    catch (e) { checks[name] = { ok: !required, detail: `${(e as Error).message.slice(0, 120)}${required ? "" : " (non-blocking)"}` }; }
  };
  await timed("database", async () => { await one("select 1"); });
  await timed("library", async () => (await loadLibrary()).meta.version);
  await timed("vision", async () => { const r = await fetch(`${env.visionUrl}/health`, { signal: AbortSignal.timeout(2000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); }, false);
  await timed("queue", async () => `${(await one(`select count(*)::int n from jobs where status='queued'`)).n} queued`, false);
  const ok = Object.values(checks).every((c) => c.ok);
  return Response.json({ ok, checks }, { status: ok ? 200 : 503 });
}

import { hasFeature } from "@slabguard/core";
import { generateNarrative } from "@/lib/ai/narrate";
import { requireUser } from "@/lib/auth";
import { entitlementsFor } from "@/lib/credits";
import { recordCostUsd } from "@/lib/costs";
import { one } from "@/lib/db";
import { handle, HttpError, json } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { getOwnedSession } from "@/lib/sessions";

/** AI-assisted explanation of the latest report (Pro+). Generated on demand and cached per analysis run. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser(req);
  const s = await getOwnedSession(u.id, (await ctx.params).id);
  const { ent } = await entitlementsFor(u.id);
  if (!hasFeature(ent, "detailed_report")) throw new HttpError(403, "upgrade_required", "AI-assisted report explanations are included with Collector Pro and Power Collector.", { upgrade: true });
  const row = await one(`select id, analysis_run, report from verification_reports where session_id=$1 order by analysis_run desc limit 1`, [s.id]);
  if (!row) throw new HttpError(404, "no_report", "No report yet.");
  if (row.report.narrative?.analysisRun === row.analysis_run) return json({ narrative: row.report.narrative, cached: true });
  await rateLimit(`narrative:${u.id}`, 30, 3600);
  const n = await generateNarrative(row.report);
  if (n.costUsd) await recordCostUsd(s.id, u.id, "ai_narrative", n.costUsd);
  const narrative = { text: n.text, source: n.source, model: n.model, generatedAt: new Date().toISOString(), analysisRun: row.analysis_run, ...(n.rejected ? { fallbackReason: n.rejected } : {}) };
  await one(`update verification_reports set report = jsonb_set(report, '{narrative}', $2::jsonb) where id=$1`, [row.id, JSON.stringify(narrative)]);
  return json({ narrative, cached: false });
});

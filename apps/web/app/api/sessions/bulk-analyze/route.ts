import { hasFeature } from "@slabguard/core";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { entitlementsFor, reserveCredit, usageSummary } from "@/lib/credits";
import { q } from "@/lib/db";
import { env } from "@/lib/env";
import { handle, HttpError, json } from "@/lib/http";
import { enqueueAnalysis } from "@/lib/jobs";
import { rateLimit } from "@/lib/ratelimit";
import { activeImages, getOwnedSession, preflight } from "@/lib/sessions";

/**
 * Power plan: queue many slab sessions at once. Each session is still one slab and one credit,
 * reserved atomically one by one; the batch stops reserving when credits run out.
 */
export const POST = handle(async (req: Request) => {
  const u = await requireUser(req);
  const { ent } = await entitlementsFor(u.id);
  if (!hasFeature(ent, "bulk_verification")) throw new HttpError(403, "upgrade_required", "Bulk verification is included with Power Collector.", { upgrade: true });
  await rateLimit(`bulk:${u.id}`, 10, 600);
  const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1).max(50) }).parse(await req.json());
  const results: { id: string; status: string; message?: string }[] = [];
  let outOfCredits = false;
  for (const id of ids) {
    const s = await getOwnedSession(u.id, id);
    if (s.status === "queued" || s.status === "processing") { results.push({ id, status: s.status }); continue; }
    if (s.analysis_count >= env.maxAnalysesPerSession) { results.push({ id, status: "session_limit" }); continue; }
    const problems = preflight(await activeImages(id));
    if (problems.length) { results.push({ id, status: "retake_needed", message: problems.flatMap((p) => p.issues.map((i: any) => i.guidance)).join(" ") }); continue; }
    if (outOfCredits) { results.push({ id, status: "limit_reached" }); continue; }
    try {
      await reserveCredit(u.id, id);
    } catch (e) {
      if (e instanceof HttpError && e.code === "limit_reached") { outOfCredits = true; results.push({ id, status: "limit_reached", message: e.message }); continue; }
      throw e;
    }
    await q(`update verification_sessions set status='queued', error=null where id=$1`, [id]);
    await enqueueAnalysis(id, hasFeature(ent, "priority_processing") ? 10 : 0);
    results.push({ id, status: "queued" });
  }
  return json({ results, usage: await usageSummary(u.id) }, 202);
});

import { hasFeature } from "@slabguard/core";
import { requireUser } from "@/lib/auth";
import { entitlementsFor, reserveCredit, usageSummary } from "@/lib/credits";
import { q } from "@/lib/db";
import { env } from "@/lib/env";
import { handle, HttpError, json } from "@/lib/http";
import { enqueueAnalysis } from "@/lib/jobs";
import { rateLimit } from "@/lib/ratelimit";
import { activeImages, getOwnedSession, preflight } from "@/lib/sessions";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser(req);
  await rateLimit(`analyze:${u.id}`, 20, 600);
  const s = await getOwnedSession(u.id, (await ctx.params).id);
  if (s.status === "queued" || s.status === "processing") return json({ status: s.status }, 202);
  if (s.analysis_count >= env.maxAnalysesPerSession) throw new HttpError(429, "session_limit", "This session has reached its re-analysis limit. Start a new session if this is a different slab.");

  // Free quality gate: unusable photos are rejected before any credit is reserved.
  const problems = preflight(await activeImages(s.id));
  if (problems.length) throw new HttpError(422, "retake_needed", "Some photos need to be retaken before analysis.", { problems });

  const r = await reserveCredit(u.id, s.id);
  const { ent } = await entitlementsFor(u.id);
  await q(`update verification_sessions set status='queued', error=null where id=$1`, [s.id]);
  await enqueueAnalysis(s.id, hasFeature(ent, "priority_processing") ? 10 : 0);
  const usage = await usageSummary(u.id);
  return json({ status: "queued", credit: r.status, usage }, 202);
});

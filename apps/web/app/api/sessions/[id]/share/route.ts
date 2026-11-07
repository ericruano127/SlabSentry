import { randomBytes } from "node:crypto";
import { requireUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { env } from "@/lib/env";
import { handle, HttpError, json } from "@/lib/http";
import { getOwnedSession } from "@/lib/sessions";

/** Create (or revoke with DELETE) a public link to the latest report. Excludes personal data & photos. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser(req);
  const s = await getOwnedSession(u.id, (await ctx.params).id);
  const r = await one(`update verification_reports set share_token=coalesce(share_token,$2) where id=(select id from verification_reports where session_id=$1 order by analysis_run desc limit 1) returning share_token`, [s.id, randomBytes(18).toString("base64url")]);
  if (!r) throw new HttpError(404, "no_report", "No report yet.");
  return json({ url: `${env.appUrl}/r/${r.share_token}` });
});
export const DELETE = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser(req);
  const s = await getOwnedSession(u.id, (await ctx.params).id);
  await one(`update verification_reports set share_token=null where session_id=$1`, [s.id]);
  return json({ ok: true });
});

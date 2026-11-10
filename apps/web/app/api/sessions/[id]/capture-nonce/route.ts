import { randomBytes } from "node:crypto";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { getOwnedSession } from "@/lib/sessions";

/** Issue a one-time code just before an in-app camera capture (valid 2 minutes, single use). */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser(req);
  await rateLimit(`nonce:${u.id}`, 120, 3600);
  const s = await getOwnedSession(u.id, (await ctx.params).id);
  const nonce = randomBytes(18).toString("base64url");
  await q(`insert into capture_nonces (nonce,session_id,user_id) values ($1,$2,$3)`, [nonce, s.id, u.id]);
  return json({ nonce, expiresInSec: 120 });
});

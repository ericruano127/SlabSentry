import { hasFeature } from "@slabguard/core";
import { requireUser } from "@/lib/auth";
import { entitlementsFor } from "@/lib/credits";
import { one, q } from "@/lib/db";
import { handle, HttpError, json } from "@/lib/http";
import { marketValueFor, providerStatus } from "@/lib/market";
import { getOwnedSession } from "@/lib/sessions";

/** Live fair-market-value estimate (recomputed as comps are added; no credit used). */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser(req);
  const { ent } = await entitlementsFor(u.id);
  if (!hasFeature(ent, "market_value")) throw new HttpError(403, "upgrade_required", "Market value isn't included in your plan.", { upgrade: true });
  const s = await getOwnedSession(u.id, (await ctx.params).id);
  const rec = await one(`select data from verification_evidence where session_id=$1 and kind='official_record' order by created_at desc limit 1`, [s.id]);
  const value = await marketValueFor(s, rec?.data ?? null);
  const comps = await q(`select id, source, price_cents, currency, sold_at, url, title, grade_label from market_comps where session_id=$1 order by sold_at desc nulls last`, [s.id]);
  return json({ value, comps, askingPriceCents: s.asking_price_cents, providers: providerStatus().map(({ id, usable }) => ({ id, connected: usable })) });
});

import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { handle, HttpError, json } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { getOwnedSession } from "@/lib/sessions";

type Ctx = { params: Promise<{ id: string }> };
const Comp = z.object({
  priceCents: z.number().int().positive().max(1_000_000_000),
  currency: z.string().length(3).default("USD"),
  soldAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  url: z.string().url().max(500).nullable().optional(),
  title: z.string().max(200).nullable().optional(),
  gradeLabel: z.string().max(20).nullable().optional(),
});

/** Comparable sales the user found (same item, grader and grade). Used for the FMV estimate. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const u = await requireUser(req);
  await rateLimit(`comps:${u.id}`, 200, 3600);
  const s = await getOwnedSession(u.id, (await ctx.params).id);
  const c = Comp.parse(await req.json());
  const n = (await q(`select count(*)::int n from market_comps where session_id=$1`, [s.id]))[0].n;
  if (n >= 50) throw new HttpError(429, "too_many_comps", "This slab already has 50 comparable sales.");
  const row = (await q(`insert into market_comps (session_id,user_id,source,price_cents,currency,sold_at,url,title,grade_label) values ($1,$2,'user',$3,$4,$5,$6,$7,$8) returning id`,
    [s.id, u.id, c.priceCents, c.currency.toUpperCase(), c.soldAt ?? null, c.url ?? null, c.title ?? null, c.gradeLabel ?? null]))[0];
  return json(row, 201);
});

export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  const u = await requireUser(req);
  const s = await getOwnedSession(u.id, (await ctx.params).id);
  const { compId } = z.object({ compId: z.string().uuid() }).parse(await req.json());
  await q(`delete from market_comps where id=$1 and session_id=$2`, [compId, s.id]);
  return json({ ok: true });
});

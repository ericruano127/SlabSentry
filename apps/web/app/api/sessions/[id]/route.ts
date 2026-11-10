import { z } from "zod";
import { normalizeCert } from "@slabguard/core";
import { loadLibrary } from "@/lib/library";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { handle, HttpError, json } from "@/lib/http";
import { getOwnedSession } from "@/lib/sessions";
import { sessionView } from "@/lib/views";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req: Request, ctx: Ctx) => {
  const u = await requireUser(req);
  return json(await sessionView(await getOwnedSession(u.id, (await ctx.params).id)));
});

const Patch = z.object({
  grader: z.string().regex(/^[A-Z0-9_]+$/).optional(),
  category: z.string().regex(/^[a-z0-9_]+$/).optional(),
  certNumber: z.string().min(4).max(20).optional(),
  certSource: z.enum(["qr", "barcode", "ocr", "user"]).optional(),
  certConfirmed: z.boolean().optional(),
  mode: z.enum(["in_hand", "online_listing"]).optional(),
  status: z.literal("canceled").optional(),
  gradeLabel: z.string().max(20).nullable().optional(),
  itemTitle: z.string().max(200).nullable().optional(),
  askingPriceCents: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
});

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const u = await requireUser(req);
  const s = await getOwnedSession(u.id, (await ctx.params).id);
  const b = Patch.parse(await req.json());
  const cert = b.certNumber ? normalizeCert(b.certNumber) : undefined;
  // Graders and categories are validated against the published reference library (data-driven).
  const lib = await loadLibrary();
  const category = b.category ?? s.category;
  if (b.category && !lib.data.categories.some((c) => c.id === b.category)) throw new HttpError(400, "invalid_category", "Unknown category.");
  if (b.category && s.locked_cert && b.category !== s.category) throw new HttpError(409, "session_locked", "The category can't change after a report was delivered.");
  if (b.grader && !lib.gradersFor(category).some((g) => g.id === b.grader)) throw new HttpError(400, "invalid_grader", "That grading company isn't available for this category.");
  if (s.locked_cert && cert && cert !== s.locked_cert) throw new HttpError(409, "session_locked", "This session already produced a report for another slab. Start a new session for a different card.");
  if (b.status === "canceled" && s.credit_state === "reserved") throw new HttpError(409, "busy", "Analysis is in progress.");
  await q(
    `update verification_sessions set grader=coalesce($2,grader), cert_number=coalesce($3,cert_number), cert_source=coalesce($4,cert_source),
       cert_confirmed=coalesce($5,cert_confirmed), mode=coalesce($6,mode), status=coalesce($7,status), category=coalesce($8,category), updated_at=now() where id=$1`,
    [s.id, b.grader ?? null, cert ?? null, b.certSource ?? (cert ? "user" : null), b.certConfirmed ?? null, b.mode ?? null, b.status ?? null, b.category ?? null],
  );
  if (b.gradeLabel !== undefined || b.itemTitle !== undefined || b.askingPriceCents !== undefined)
    await q(`update verification_sessions set grade_label = case when $2 then $3 else grade_label end, item_title = case when $4 then $5 else item_title end,
               asking_price_cents = case when $6 then $7 else asking_price_cents end where id=$1`,
      [s.id, b.gradeLabel !== undefined, b.gradeLabel ?? null, b.itemTitle !== undefined, b.itemTitle ?? null, b.askingPriceCents !== undefined, b.askingPriceCents ?? null]);
  return json(await sessionView(await getOwnedSession(u.id, s.id)));
});

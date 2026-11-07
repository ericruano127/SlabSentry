import { z } from "zod";
import { normalizeCert, type GraderId, GRADERS } from "@slabguard/core";
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
  grader: z.enum(Object.keys(GRADERS) as [GraderId, ...GraderId[]]).optional(),
  certNumber: z.string().min(4).max(20).optional(),
  certSource: z.enum(["qr", "barcode", "ocr", "user"]).optional(),
  certConfirmed: z.boolean().optional(),
  mode: z.enum(["in_hand", "online_listing"]).optional(),
  status: z.literal("canceled").optional(),
});

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const u = await requireUser(req);
  const s = await getOwnedSession(u.id, (await ctx.params).id);
  const b = Patch.parse(await req.json());
  const cert = b.certNumber ? normalizeCert(b.certNumber) : undefined;
  if (s.locked_cert && cert && cert !== s.locked_cert) throw new HttpError(409, "session_locked", "This session already produced a report for another slab. Start a new session for a different card.");
  if (b.status === "canceled" && s.credit_state === "reserved") throw new HttpError(409, "busy", "Analysis is in progress.");
  await q(
    `update verification_sessions set grader=coalesce($2,grader), cert_number=coalesce($3,cert_number), cert_source=coalesce($4,cert_source),
       cert_confirmed=coalesce($5,cert_confirmed), mode=coalesce($6,mode), status=coalesce($7,status), updated_at=now() where id=$1`,
    [s.id, b.grader ?? null, cert ?? null, b.certSource ?? (cert ? "user" : null), b.certConfirmed ?? null, b.mode ?? null, b.status ?? null],
  );
  return json(await sessionView(await getOwnedSession(u.id, s.id)));
});

import { z } from "zod";
import { q } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { loadLibrary } from "@/lib/library";
import { requirePermission } from "@/lib/rbac";
import { registerTemplate } from "@/lib/templates";

export const GET = handle(async (req: Request) => {
  await requirePermission(req, "library:read");
  return json({ templates: await q(`select id, generation_id, kind, status, verification_note, source_session_id, created_by, created_at from verified_templates order by created_at desc limit 200`) });
});

/** Register a verified template from an uploaded image of a slab whose authenticity was established
 * outside the app (e.g. submitted to/confirmed by the grader). Audited. */
export const POST = handle(async (req: Request) => {
  const u = await requirePermission(req, "library:write");
  const b = z.object({ imageId: z.string().uuid(), generationId: z.string(), kind: z.enum(["label", "uv", "microprint"]), note: z.string().min(10) }).parse(await req.json());
  const lib = await loadLibrary();
  const gen = lib.data.generations.find((g) => g.id === b.generationId);
  if (!gen) return json({ error: "unknown_generation", message: "Unknown holder generation." }, 400);
  const cat = lib.category(gen.categories[0]);
  return json(await registerTemplate(u.id, { ...b, geometry: { itemAspect: cat.geometry.itemAspect, holderAspect: cat.geometry.holderAspect } }), 201);
});

export const DELETE = handle(async (req: Request) => {
  const u = await requirePermission(req, "library:write");
  const { id } = z.object({ id: z.string().uuid() }).parse(await req.json());
  await q(`update verified_templates set status='retired' where id=$1`, [id]);
  await q(`insert into admin_audit_log (admin_id,action,after) values ($1,'template.retire',$2)`, [u.id, JSON.stringify({ id })]);
  return json({ ok: true });
});

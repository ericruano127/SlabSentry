import { randomUUID } from "node:crypto";
import { one, q } from "./db";
import { HttpError } from "./http";
import { storage } from "./storage";
import { vision, type Geometry } from "./vision";

/** Verified reference templates per holder generation. Only staff can register them, from a slab
 * whose authenticity was established outside the app (recorded in verification_note). */
export async function activeTemplate(generationId: string | null | undefined, kind: "label" | "uv" | "microprint"): Promise<Buffer | null> {
  if (!generationId) return null;
  const t = await one(`select storage_key from verified_templates where generation_id=$1 and kind=$2 and status='active' order by created_at desc limit 1`, [generationId, kind]);
  return t ? storage.get(t.storage_key).catch(() => null) : null;
}

export async function registerTemplate(actor: string, p: { imageId: string; generationId: string; kind: "label" | "uv" | "microprint"; note: string; geometry?: Geometry }) {
  const img = await one(`select id, session_id, storage_key, role from submitted_images where id=$1 and storage_key is not null`, [p.imageId]);
  if (!img) throw new HttpError(404, "not_found", "Image not found.");
  let data = await storage.get(img.storage_key);
  if (p.kind === "label") data = Buffer.from((await vision.labelCrop(data, p.geometry)).jpeg, "base64");
  const key = `templates/${p.generationId}/${p.kind}-${randomUUID()}.jpg`;
  await storage.put(key, data, "image/jpeg");
  const row = await one(
    `insert into verified_templates (generation_id,kind,storage_key,source_session_id,source_image_id,verification_note,created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [p.generationId, p.kind, key, img.session_id, img.id, p.note, actor],
  );
  await q(`insert into admin_audit_log (admin_id,action,after) values ($1,'template.register',$2)`, [actor, JSON.stringify({ id: row.id, ...p })]);
  return row;
}

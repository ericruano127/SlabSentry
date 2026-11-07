import { createHash } from "node:crypto";
import { one, q } from "./db";
import { env } from "./env";
import { HttpError } from "./http";
import { storage } from "./storage";
import { vision, VisionUnavailable } from "./vision";

export const ROLES = ["front", "back", "label_closeup", "security_closeup", "edge", "tilt_frame", "backlit", "detail", "reference_front", "reference_back"] as const;
export type Role = (typeof ROLES)[number];
const MULTI = new Set<Role>(["security_closeup", "edge", "tilt_frame", "detail"]);

export async function getOwnedSession(userId: string, id: string) {
  const s = await one(`select * from verification_sessions where id=$1 and user_id=$2`, [id, userId]);
  if (!s) throw new HttpError(404, "not_found", "Session not found");
  return s;
}

function sniffMime(b: Buffer): string | null {
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}

export async function addImage(userId: string, sessionId: string, role: Role, data: Buffer, opts: { attestation?: string } = {}) {
  if (data.length > env.maxUploadBytes) throw new HttpError(413, "too_large", "Image is too large (max 15 MB).");
  const mime = sniffMime(data);
  if (!mime) throw new HttpError(415, "unsupported_type", "Please upload a JPEG, PNG or WebP photo.");
  const count = await one(`select count(*)::int n from submitted_images where session_id=$1 and is_original`, [sessionId]);
  if (count.n >= env.maxImagesPerSession) throw new HttpError(429, "too_many_images", "This session has reached its photo limit.");
  const isRef = role.startsWith("reference_");
  if (isRef && !opts.attestation) throw new HttpError(400, "attestation_required", "Tell us where this reference image came from.");

  let quality: any = null;
  try {
    quality = await vision.quality(data, role);
  } catch (e) {
    if ((e as any).code === "unreadable_image") throw new HttpError(422, "unreadable_image", "We couldn't read that image file. Try another photo.");
    if (!(e instanceof VisionUnavailable)) throw e;
    quality = null; // checked again before analysis
  }
  const sha = createHash("sha256").update(data).digest("hex");
  const key = `${userId}/${sessionId}/${role}-${sha.slice(0, 16)}.${mime.split("/")[1]}`;
  await storage.put(key, data, mime);
  if (!MULTI.has(role)) await q(`update submitted_images set superseded=true where session_id=$1 and role=$2 and is_original and not superseded`, [sessionId, role]);
  const provenance = isRef
    ? { source: "user_supplied_reference", retrievedAt: new Date().toISOString(), note: opts.attestation }
    : { source: "user_capture", retrievedAt: new Date().toISOString() };
  const row = await one(
    `insert into submitted_images (session_id,user_id,role,storage_key,mime,bytes,sha256,quality,provenance) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id, role, quality, created_at`,
    [sessionId, userId, role, key, mime, data.length, sha, quality && JSON.stringify(quality), JSON.stringify(provenance)],
  );
  if (isRef) {
    await q(`delete from official_reference_images where session_id=$1 and side=$2 and source='user_supplied_reference'`, [sessionId, role === "reference_front" ? "front" : "back"]);
    await q(`insert into official_reference_images (session_id,side,source,availability,image_id,attestation) values ($1,$2,'user_supplied_reference','available',$3,$4)`, [sessionId, role === "reference_front" ? "front" : "back", row.id, opts.attestation]);
  }
  await q(`update verification_sessions set updated_at=now() where id=$1`, [sessionId]);
  return row;
}

export async function activeImages(sessionId: string) {
  return q(`select * from submitted_images where session_id=$1 and is_original and not superseded order by created_at`, [sessionId]);
}

/** Free pre-analysis gate: blocks only clearly unusable sets so users aren't charged for them. */
export function preflight(images: any[]) {
  const front = images.find((i) => i.role === "front");
  const problems: { role: string; issues: any[] }[] = [];
  if (!front) problems.push({ role: "front", issues: [{ issue: "missing", severity: "major", guidance: "Add a full front photo of the slab." }] });
  else if (front.quality && !front.quality.ok) problems.push({ role: "front", issues: front.quality.issues.filter((i: any) => i.severity === "major") });
  return problems;
}

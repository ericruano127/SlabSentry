import { createHash } from "node:crypto";
import { one, q } from "./db";
import { env } from "./env";
import { HttpError } from "./http";
import { storage } from "./storage";
import { loadLibrary } from "./library";
import { MetadataError, sanitize, type MetadataSignals } from "./metadata";
import { vision, VisionUnavailable } from "./vision";

export const ROLES = ["front", "back", "label_closeup", "security_closeup", "edge", "tilt_frame", "tilt_video", "backlit", "uv", "detail", "reference_front", "reference_back"] as const;
export type Role = (typeof ROLES)[number];
const MULTI = new Set<Role>(["security_closeup", "edge", "tilt_frame", "detail"]);

export async function getOwnedSession(userId: string, id: string) {
  const s = await one(`select * from verification_sessions where id=$1 and user_id=$2`, [id, userId]);
  if (!s) throw new HttpError(404, "not_found", "Session not found");
  return s;
}

export function sniffMime(b: Buffer): string | null {
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (b.subarray(4, 8).toString() === "ftyp") return b.subarray(8, 10).toString() === "qt" ? "video/quicktime" : "video/mp4";
  if (b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "video/webm";
  return null;
}

export const MAX_VIDEO_SECONDS = 20;

export async function addImage(userId: string, sessionId: string, role: Role, raw: Buffer, opts: { attestation?: string; captureNonce?: string } = {}) {
  const mime = sniffMime(raw);
  const isVideo = !!mime?.startsWith("video/");
  if (role === "tilt_video" ? !isVideo : !mime || isVideo) throw new HttpError(415, "unsupported_type", role === "tilt_video" ? "Please upload an MP4, MOV or WebM video." : "Please upload a JPEG, PNG or WebP photo.");
  if (raw.length > (isVideo ? env.maxVideoBytes : env.maxUploadBytes)) throw new HttpError(413, "too_large", isVideo ? "Video is too large (max 60 MB, keep it under 10 seconds)." : "Image is too large (max 15 MB).");
  const count = await one(`select count(*)::int n from submitted_images where session_id=$1 and is_original`, [sessionId]);
  if (count.n >= env.maxImagesPerSession) throw new HttpError(429, "too_many_images", "This session has reached its photo limit.");
  const isRef = role.startsWith("reference_");
  if (isRef && !opts.attestation) throw new HttpError(400, "attestation_required", "Tell us where this reference image came from.");

  // Privacy: strip EXIF/GPS/XMP and other identifying metadata BEFORE anything is analyzed or stored.
  let data: Buffer;
  let metadataSignals: MetadataSignals;
  try {
    ({ data, signals: metadataSignals } = sanitize(raw, mime!));
  } catch (e) {
    if (e instanceof MetadataError)
      throw new HttpError(e.code === "too_many_pixels" ? 413 : 422, e.code === "too_many_pixels" ? "too_many_pixels" : "unreadable_image",
        e.code === "too_many_pixels" ? e.message : "That file looks damaged or incomplete. Please take or choose another photo.");
    throw e;
  }
  const consent = await one(`select training_consent, training_consent_version from app_users where id=$1`, [userId]);

  let quality: any = null;
  let frames: { t: number; jpeg: string }[] = [];
  try {
    if (isVideo) {
      const r = await vision.frames(data);
      if (r.durationSec > MAX_VIDEO_SECONDS) throw new HttpError(422, "video_too_long", `Please keep tilt videos under ${MAX_VIDEO_SECONDS} seconds.`);
      frames = r.frames;
      const ok = r.status === "ok";
      quality = { ok, score: ok ? 1 : 0.4, metrics: { durationSec: r.durationSec, distinctFrames: r.distinctFrames, sampled: r.sampled },
        issues: ok ? [] : [{ issue: "too_few_frames", severity: "major", guidance: "We found too few distinct frames. Tilt the slab slowly through a wider angle (about 30°) for 3–5 seconds under a single light." }] };
    } else {
      const cat = (await loadLibrary()).category((await one(`select category from verification_sessions where id=$1`, [sessionId]))?.category);
      quality = await vision.quality(data, role, { itemAspect: cat.geometry.itemAspect, holderAspect: cat.geometry.holderAspect });
    }
  } catch (e) {
    if ((e as any).code === "unreadable_image") throw new HttpError(422, "unreadable_image", "We couldn't read that image file. Try another photo.");
    if (!(e instanceof VisionUnavailable)) throw e;
    quality = null; // checked again before analysis
  }
  const sha = createHash("sha256").update(data).digest("hex");
  const key = `${userId}/${sessionId}/${role}-${sha.slice(0, 16)}.${mime!.split("/")[1]}`;
  await storage.put(key, data, mime!);
  if (!MULTI.has(role)) await q(`update submitted_images set superseded=true where session_id=$1 and role=$2 and is_original and not superseded`, [sessionId, role]);
  // Live-capture attestation: a one-time code issued to this session within the last 2 minutes.
  let live = false;
  if (opts.captureNonce && !isRef) {
    const n = await one(`update capture_nonces set used_at=now() where nonce=$1 and session_id=$2 and user_id=$3 and used_at is null and issued_at > now() - interval '2 minutes' returning nonce`, [opts.captureNonce, sessionId, userId]);
    live = !!n;
  }
  const provenance = isRef
    ? { source: "user_supplied_reference", retrievedAt: new Date().toISOString(), note: opts.attestation }
    : { source: "user_capture", retrievedAt: new Date().toISOString(), ...(live ? { capture: "live" } : {}) };
  const row = await one(
    `insert into submitted_images (session_id,user_id,role,storage_key,mime,bytes,sha256,quality,provenance,metadata_signals,training_consent,consent_version)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id, role, quality, created_at`,
    [sessionId, userId, role, key, mime, data.length, sha, quality && JSON.stringify(quality), JSON.stringify(provenance), JSON.stringify(metadataSignals),
     !!consent?.training_consent, consent?.training_consent ? consent.training_consent_version : null],
  );
  await storeVideoFrames(userId, sessionId, row.id, frames);
  if (isRef) {
    await q(`delete from official_reference_images where session_id=$1 and side=$2 and source='user_supplied_reference'`, [sessionId, role === "reference_front" ? "front" : "back"]);
    await q(`insert into official_reference_images (session_id,side,source,availability,image_id,attestation) values ($1,$2,'user_supplied_reference','available',$3,$4)`, [sessionId, role === "reference_front" ? "front" : "back", row.id, opts.attestation]);
  }
  await q(`update verification_sessions set updated_at=now() where id=$1`, [sessionId]);
  return row;
}

export async function activeImages(sessionId: string) {
  return q(`select * from submitted_images where session_id=$1 and is_original and not superseded and purged_at is null order by created_at`, [sessionId]);
}

/** Free pre-analysis gate: front AND back are required, and clearly unusable photos must be retaken
 * before any credit is reserved. */
export function preflight(images: any[]) {
  const problems: { role: string; issues: any[] }[] = [];
  const video = images.find((i) => i.role === "tilt_video");
  if (video?.quality && !video.quality.ok) problems.push({ role: "tilt_video", issues: video.quality.issues });
  for (const role of ["front", "back"] as const) {
    const img = images.find((i) => i.role === role);
    if (!img) problems.push({ role, issues: [{ issue: "missing", severity: "major", guidance: role === "front" ? "Add a full front photo of the slab." : "Add a full back photo of the slab (flip it over, same framing)." }] });
    else if (img.quality && !img.quality.ok) problems.push({ role, issues: img.quality.issues.filter((i: any) => i.severity === "major") });
  }
  return problems;
}

/** Video frames are stored as derived images of the video (the original video stays untouched). */
export async function storeVideoFrames(userId: string, sessionId: string, videoId: string, frames: { t: number; jpeg: string }[]) {
  for (const [i, f] of frames.entries()) {
    const fb = Buffer.from(f.jpeg, "base64");
    const fsha = createHash("sha256").update(fb).digest("hex");
    const fkey = `${userId}/${sessionId}/derived/tiltframe-${fsha.slice(0, 16)}.jpg`;
    await storage.put(fkey, fb, "image/jpeg");
    await q(`insert into submitted_images (session_id,user_id,role,is_original,derived_from,storage_key,mime,bytes,sha256,provenance,training_consent,consent_version)
             select $1,$2,'tilt_frame',false,$3,$4,'image/jpeg',$5,$6,$7, p.training_consent, p.consent_version from submitted_images p where p.id=$3`,
      [sessionId, userId, videoId, fkey, fb.length, fsha, JSON.stringify({ source: "computed", tool: "vision/video", note: `frame ${i + 1} at ${f.t}s`, retrievedAt: new Date().toISOString() })]);
  }
}

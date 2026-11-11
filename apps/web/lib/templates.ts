import { createHash, randomUUID } from "node:crypto";
import { env } from "./env";
import { one, q } from "./db";
import { HttpError } from "./http";
import { MetadataError, sanitize } from "./metadata";
import { sniffMime } from "./sessions";
import { storage } from "./storage";
import { vision, type Geometry } from "./vision";

/**
 * Verified reference templates per holder generation (label layout/colour, UV pattern, microprint).
 *
 * Workflow: staff submit a template from a slab whose authenticity was established outside the app
 * (recorded as evidence type + note) → automatic checks (quality, the photo is the right kind, and a
 * comparison with templates already approved for that generation) → a *second* staff member approves
 * or rejects (two-person rule, enforced in the database) → only approved ("active") templates are used
 * in analysis. Retiring requires a reason. Every step is audited.
 */
export type TemplateKind = "label" | "uv" | "microprint";
export const TEMPLATE_KINDS: TemplateKind[] = ["label", "uv", "microprint"];
export const EVIDENCE_TYPES = {
  grader_confirmed: "Confirmed by the grading company (e.g. reholder/review, written confirmation)",
  submitted_by_us: "Graded slab we submitted to the grader ourselves",
  grader_registry_image: "Matches the grader's own registry image for this cert",
  trusted_dealer: "Bought from an authorized/trusted dealer, cert verified on the grader's site",
  other: "Other (explain in the note)",
} as const;
export type EvidenceType = keyof typeof EVIDENCE_TYPES;

/** Validate a template id from the URL (malformed ids are a 404, not a database error). */
export function templateId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new HttpError(404, "not_found", "Template not found.");
  return id;
}

/** Max variants compared per generation and kind during analysis (best match is used). */
export const MAX_VARIANTS = 3;

const QUALITY_ROLE: Record<TemplateKind, string> = { label: "front", uv: "uv", microprint: "security_closeup" };

const audit = (actor: string, action: string, after: unknown) =>
  q(`insert into admin_audit_log (admin_id,action,after) values ($1,$2,$3)`, [actor, action, JSON.stringify(after)]);

/** Approved templates for a generation: the most recently approved per variant, up to MAX_VARIANTS. */
export async function activeTemplates(generationId: string | null | undefined, kind: TemplateKind): Promise<{ id: string; variant: string | null; data: Buffer }[]> {
  if (!generationId) return [];
  const rows = await q(
    `select * from (select distinct on (coalesce(variant,'')) id, variant, storage_key, coalesce(reviewed_at, created_at) at
       from verified_templates where generation_id=$1 and kind=$2 and status='active'
       order by coalesce(variant,''), coalesce(reviewed_at, created_at) desc) v order by at desc limit $3`,
    [generationId, kind, MAX_VARIANTS],
  );
  const out = await Promise.all(rows.map(async (r) => ({ id: r.id as string, variant: r.variant as string | null, data: await storage.get(r.storage_key).catch(() => null) })));
  return out.filter((t): t is { id: string; variant: string | null; data: Buffer } => !!t.data);
}

/** Back-compat helper: the single most recent approved template. */
export async function activeTemplate(generationId: string | null | undefined, kind: TemplateKind): Promise<Buffer | null> {
  return (await activeTemplates(generationId, kind))[0]?.data ?? null;
}

const STATUS_RANK: Record<string, number> = { consistent: 3, inconclusive: 2, potential_discrepancy: 1 };
/** Rank a comparison so the best-matching variant wins (a gold label is compared with the gold-label template). */
export function matchRank(kind: TemplateKind, r: any): number {
  if (!r) return -1;
  if (kind === "label") {
    const l = r.label;
    if (l?.status !== "measured") return 0;
    return (STATUS_RANK[l.layout?.status] ?? 0) * 10 + (STATUS_RANK[l.colour?.status] ?? 0) * 10 + (l.layout?.score ?? 0) + (l.colour?.score ?? 0);
  }
  return (STATUS_RANK[r.status] ?? 0) * 10 + (kind === "uv" ? r.patternIoU ?? 0 : Math.min(1, (r.inliers ?? 0) / 100));
}

function compare(kind: TemplateKind, img: Buffer, tpl: Buffer | null, g?: Geometry) {
  return kind === "label" ? vision.labelTemplate(img, tpl, g) : kind === "uv" ? vision.uv(img, tpl) : vision.microprint(img, tpl);
}

/** Summary of a comparison for reviewers. */
function summarize(kind: TemplateKind, r: any) {
  if (kind === "label") return r?.label?.status === "measured"
    ? { status: [r.label.layout.status, r.label.colour.status].includes("potential_discrepancy") ? "potential_discrepancy" : r.label.layout.status === "consistent" && r.label.colour.status === "consistent" ? "consistent" : "inconclusive", layout: r.label.layout.score, colour: r.label.colour.score }
    : { status: "not_visible" };
  return { status: r?.status ?? "not_visible", ...(kind === "uv" ? { patternIoU: r?.patternIoU } : { inliers: r?.inliers }) };
}

export interface SubmitInput {
  generationId: string; kind: TemplateKind; evidenceType: EvidenceType; note: string;
  grader?: string | null; certNumber?: string | null; variant?: string | null;
  source: { imageId: string } | { upload: Buffer };
  geometry?: Geometry;
}

/** Submit a template for review. Runs the automatic checks; rejects unusable photos immediately. */
export async function submitTemplate(actor: string, p: SubmitInput) {
  // 1. Source bytes (metadata stripped for uploads — session images were stripped on ingest).
  let original: Buffer, sourceSession: string | null = null, sourceImage: string | null = null;
  if ("imageId" in p.source) {
    // Only from the submitter's OWN sessions: a user's photo must never be copied into the library (where it
    // would outlive their retention/deletion rights) or be retrievable through the staff preview by id.
    const img = await one(
      `select i.id, i.session_id, i.storage_key from submitted_images i join verification_sessions s on s.id = i.session_id
        where i.id=$1 and i.storage_key is not null and s.user_id=$2`, [p.source.imageId, actor]);
    if (!img) throw new HttpError(404, "not_found", "Image not found in your own sessions. Upload the photo instead.");
    original = await storage.get(img.storage_key);
    sourceSession = img.session_id; sourceImage = img.id;
  } else {
    const mime = sniffMime(p.source.upload);
    if (!mime || mime.startsWith("video/")) throw new HttpError(415, "unsupported_type", "Please upload a JPEG, PNG or WebP photo.");
    if (p.source.upload.length > env.maxUploadBytes) throw new HttpError(413, "too_large", "Image is too large (max 15 MB).");
    try { original = sanitize(p.source.upload, mime).data; } catch (e) {
      if (e instanceof MetadataError) throw new HttpError(422, "unreadable_image", e.message);
      throw e;
    }
  }

  // 2. Automatic checks: photo quality, and that the photo is the right kind for this template.
  const quality = await vision.quality(original, QUALITY_ROLE[p.kind], p.geometry);
  const major = (quality.issues ?? []).filter((i: any) => i.severity === "major");
  if (major.length) throw new HttpError(422, "template_quality", `Photo isn't good enough for a reference: ${major.map((i: any) => i.guidance).join(" ")}`);
  const self: any = await compare(p.kind, original, null, p.geometry);
  if (p.kind === "label" && self?.proportions?.status !== "measured") throw new HttpError(422, "template_unusable", "The whole slab wasn't found in the photo. Use a straight-on photo with all four edges visible.");
  if (p.kind === "uv" && self?.status === "not_visible") throw new HttpError(422, "template_unusable", "This doesn't look like a blacklight (UV) photo.");
  if (p.kind === "microprint" && self?.status === "not_supported_by_device") throw new HttpError(422, "template_unusable", "The fine print isn't resolved in this close-up. Use a sharper, closer photo.");

  // 3. The stored template: label crops are cut from the full slab photo; UV/microprint are stored as-is.
  const tpl = p.kind === "label" ? Buffer.from((await vision.labelCrop(original, p.geometry)).jpeg, "base64") : original;
  const sha256 = createHash("sha256").update(tpl).digest("hex");
  const dupe = await one(`select id, status from verified_templates where generation_id=$1 and kind=$2 and sha256=$3 and status in ('pending','active')`, [p.generationId, p.kind, sha256]);
  if (dupe) throw new HttpError(409, "duplicate_template", `This exact image is already ${dupe.status === "active" ? "an approved" : "a pending"} template for this generation.`);

  // 4. Consistency with templates already approved for this generation (a strong mismatch can mean
  //    the wrong generation was picked — or that the "genuine" slab isn't). Shown to the reviewer.
  const existing = await activeTemplates(p.generationId, p.kind);
  const results = [];
  for (const t of existing) results.push({ templateId: t.id, variant: t.variant, ...summarize(p.kind, await compare(p.kind, original, t.data, p.geometry)) });
  const consistency = {
    compared: results.length, results,
    verdict: !results.length ? "first" : results.some((r) => r.status === "consistent") ? "matches_existing" : results.every((r) => r.status === "potential_discrepancy") ? "differs_from_all" : "unclear",
  };

  const id = randomUUID();
  const key = `templates/${p.generationId}/${p.kind}-${id}.jpg`;
  const sourceKey = `templates/${p.generationId}/${p.kind}-${id}-source.jpg`;
  await storage.put(key, tpl, "image/jpeg");
  if (p.kind === "label") await storage.put(sourceKey, original, "image/jpeg");
  const row = await one(
    `insert into verified_templates (id,generation_id,kind,storage_key,source_storage_key,source_session_id,source_image_id,source_kind,verification_note,evidence_type,grader,cert_number,variant,sha256,quality,consistency,status,created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'pending',$17) returning id, status, consistency`,
    [id, p.generationId, p.kind, key, p.kind === "label" ? sourceKey : key, sourceSession, sourceImage, "imageId" in p.source ? "session_image" : "upload", p.note, p.evidenceType,
      p.grader ?? null, p.certNumber ?? null, p.variant?.trim() || null, sha256, JSON.stringify({ ok: quality.ok, score: quality.score, issues: quality.issues }), JSON.stringify(consistency), actor],
  );
  await audit(actor, "template.submit", { id, generationId: p.generationId, kind: p.kind, evidenceType: p.evidenceType, variant: p.variant ?? null, consistency: consistency.verdict });
  return row;
}

/** Approve or reject a pending submission. The reviewer must be a different person (two-person rule). */
export async function reviewTemplate(actor: { id: string; role: string }, id: string, decision: "approve" | "reject", note: string) {
  const t = await one(`select id, status, created_by from verified_templates where id=$1`, [id]);
  if (!t) throw new HttpError(404, "not_found", "Template not found.");
  if (t.status !== "pending") throw new HttpError(409, "not_pending", `This template is already ${t.status}.`);
  const own = t.created_by === actor.id;
  const selfApproved = own && env.templateSelfApproval && actor.role === "owner";
  if (own && !selfApproved) throw new HttpError(403, "two_person_rule", "Someone other than the submitter has to review this template.");
  if (decision === "reject" && note.trim().length < 5) throw new HttpError(400, "reason_required", "Say why it's rejected so the submitter can fix it.");
  const row = await one(
    `update verified_templates set status=$2, reviewed_by=$3, reviewed_at=now(), review_note=$4, self_approved=$5 where id=$1 and status='pending' returning id, status`,
    [id, decision === "approve" ? "active" : "rejected", actor.id, note.trim() || null, selfApproved],
  );
  if (!row) throw new HttpError(409, "not_pending", "This template was reviewed by someone else just now.");
  await audit(actor.id, `template.${decision}`, { id, note: note.trim() || null, selfApproved });
  return row;
}

export async function retireTemplate(actor: string, id: string, reason: string) {
  if (reason.trim().length < 5) throw new HttpError(400, "reason_required", "Say why the template is being retired.");
  const row = await one(`update verified_templates set status='retired', retired_by=$2, retired_at=now(), retire_reason=$3 where id=$1 and status='active' returning id, status`, [id, actor, reason.trim()]);
  if (!row) throw new HttpError(409, "not_active", "Only approved templates can be retired.");
  await audit(actor, "template.retire", { id, reason: reason.trim() });
  return row;
}

/** Templates with submitter/reviewer emails, newest first. */
export async function listTemplates(filter: { status?: string; generationId?: string; kind?: string } = {}) {
  const where: string[] = [], args: unknown[] = [];
  for (const [col, v] of [["t.status", filter.status], ["t.generation_id", filter.generationId], ["t.kind", filter.kind]] as const)
    if (v) { args.push(v); where.push(`${col}=$${args.length}`); }
  return q(
    `select t.id, t.generation_id, t.kind, t.variant, t.status, t.evidence_type, t.verification_note, t.grader, t.cert_number, t.source_kind,
            t.quality, t.consistency, t.review_note, t.self_approved, t.retire_reason, t.created_by, t.created_at, t.reviewed_at, t.retired_at,
            cu.email created_by_email, ru.email reviewed_by_email
       from verified_templates t left join app_users cu on cu.id=t.created_by left join app_users ru on ru.id=t.reviewed_by
      ${where.length ? `where ${where.join(" and ")}` : ""} order by t.created_at desc limit 500`, args);
}

/** Per generation × kind: approved and pending counts (where the library still has gaps). */
export async function coverage(generations: { id: string; graderId: string; name: string }[]) {
  const counts = await q(`select generation_id, kind, status, count(*)::int n from verified_templates where status in ('active','pending') group by 1,2,3`);
  const get = (g: string, k: string, s: string) => counts.find((c) => c.generation_id === g && c.kind === k && c.status === s)?.n ?? 0;
  return generations.map((g) => ({
    generationId: g.id, grader: g.graderId, name: g.name,
    kinds: Object.fromEntries(TEMPLATE_KINDS.map((k) => [k, { active: get(g.id, k, "active"), pending: get(g.id, k, "pending") }])),
  }));
}

/** Audit trail for one template. */
export async function templateHistory(id: string) {
  return q(`select a.action, a.after, a.created_at, u.email from admin_audit_log a left join app_users u on u.id=a.admin_id
            where a.action like 'template.%' and a.after->>'id'=$1 order by a.created_at`, [id]);
}

/** Stored image for staff preview: the template itself, or the full photo it was cut from. */
export async function templateImage(id: string, which: "template" | "source") {
  const t = await one(`select storage_key, source_storage_key from verified_templates where id=$1`, [id]);
  if (!t) throw new HttpError(404, "not_found", "Template not found.");
  return storage.get(which === "source" ? t.source_storage_key ?? t.storage_key : t.storage_key);
}

/** Fingerprint of the approved template set (part of the release record: templates change results). */
export async function templateFingerprint() {
  const rows = await q(`select id from verified_templates where status='active' order by id`);
  return { active: rows.length, sha256: createHash("sha256").update(rows.map((r) => r.id).join(",")).digest("hex").slice(0, 16) };
}

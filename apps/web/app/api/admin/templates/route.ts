import { z } from "zod";
import { env } from "@/lib/env";
import { handle, HttpError, json } from "@/lib/http";
import { loadLibrary } from "@/lib/library";
import { can, requirePermission } from "@/lib/rbac";
import { coverage, EVIDENCE_TYPES, listTemplates, MAX_VARIANTS, submitTemplate, TEMPLATE_KINDS, type EvidenceType, type TemplateKind } from "@/lib/templates";

/** Reference library admin: templates, coverage per holder generation, and what the caller may do. */
export const GET = handle(async (req: Request) => {
  const u = await requirePermission(req, "library:read");
  const url = new URL(req.url);
  const lib = await loadLibrary();
  const gens = lib.data.generations.map((g) => ({ id: g.id, graderId: g.graderId, name: g.name }));
  return json({
    templates: await listTemplates({ status: url.searchParams.get("status") ?? undefined, generationId: url.searchParams.get("generation") ?? undefined, kind: url.searchParams.get("kind") ?? undefined }),
    coverage: await coverage(gens),
    generations: gens,
    kinds: TEMPLATE_KINDS,
    evidenceTypes: EVIDENCE_TYPES,
    maxVariants: MAX_VARIANTS,
    me: { id: u.id, canSubmit: can(u.role, "library:submit"), canReview: can(u.role, "library:review"), selfApproval: env.templateSelfApproval && u.role === "owner" },
  });
});

const Fields = z.object({
  generationId: z.string().min(1),
  kind: z.enum(["label", "uv", "microprint"]),
  evidenceType: z.enum(Object.keys(EVIDENCE_TYPES) as [EvidenceType, ...EvidenceType[]]).default("other"),
  note: z.string().trim().min(10, "Describe how authenticity was established (at least 10 characters)."),
  grader: z.string().trim().max(40).optional().nullable(),
  certNumber: z.string().trim().max(40).optional().nullable(),
  variant: z.string().trim().max(60).optional().nullable(),
  imageId: z.string().uuid().optional(),
});

/** Submit a template for review: JSON with an `imageId` from a session, or multipart with a `file`. */
export const POST = handle(async (req: Request) => {
  const u = await requirePermission(req, "library:submit");
  let fields: Record<string, unknown>, upload: Buffer | null = null;
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const fd = await req.formData();
    const f = fd.get("file");
    if (f && typeof f !== "string") upload = Buffer.from(await f.arrayBuffer());
    fields = Object.fromEntries([...fd.entries()].filter(([k, v]) => k !== "file" && typeof v === "string" && v !== ""));
  } else fields = await req.json();
  const b = Fields.parse(fields);
  if (!upload && !b.imageId) throw new HttpError(400, "source_required", "Upload a photo or give an image id from a session.");
  const lib = await loadLibrary();
  const gen = lib.data.generations.find((g) => g.id === b.generationId);
  if (!gen) throw new HttpError(400, "unknown_generation", "Unknown holder generation.");
  const cat = lib.category(gen.categories[0]);
  const row = await submitTemplate(u.id, {
    generationId: gen.id, kind: b.kind as TemplateKind, evidenceType: b.evidenceType, note: b.note,
    grader: b.grader ?? gen.graderId, certNumber: b.certNumber, variant: b.variant,
    source: upload ? { upload } : { imageId: b.imageId! },
    geometry: { itemAspect: cat.geometry.itemAspect, holderAspect: cat.geometry.holderAspect },
  });
  return json(row, 201);
});

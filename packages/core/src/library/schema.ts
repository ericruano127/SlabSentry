import { z } from "zod";

/**
 * Reference library — the data-driven source of truth for categories, graders, holder/label
 * generations, and expected security features. Stored as versioned, hashed releases in the
 * database and editable by admins; this schema validates every release before it can be published.
 *
 * Hierarchy: category → grader → label/case generation → grading-date range → expected features.
 * Era is decided by when the slab was GRADED/ENCAPSULATED (current holder), never by the item's year.
 */
export const ClaimStatus = z.enum(["confirmed_official", "reported_unconfirmed", "research_needed"]);
export type ClaimStatus = z.infer<typeof ClaimStatus>;

const YearMonth = z.string().regex(/^\d{4}(-\d{2})?$/, "use YYYY or YYYY-MM");
const Range = z.tuple([z.number().positive(), z.number().positive()]).nullable();

export const CategorySchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string(),
  description: z.string().default(""),
  launchStatus: z.enum(["supported", "beta", "planned"]),
  subcategories: z.array(z.string()).default([]), // e.g. Pokémon, One Piece, Magic, Yu-Gi-Oh!
  /** Shape priors for the vision service (short/long side ratio). null = any shape (generic detection). */
  geometry: z.object({ itemAspect: Range, holderAspect: Range, status: ClaimStatus }),
  captureGuidance: z.object({
    front: z.string(),
    back: z.string(),
    label: z.string(),
    extras: z.array(z.object({ role: z.string(), title: z.string(), hint: z.string() })).default([]),
  }),
  /** Which comparison checks are meaningful for this category. */
  checks: z.object({ referenceComparison: z.boolean(), physicalFingerprint: z.boolean(), labelComparison: z.boolean() }),
});

export const CertPatternSchema = z.object({ category: z.string().nullable(), pattern: z.string(), verified: z.boolean() });

export const GraderSchema = z.object({
  id: z.string().regex(/^[A-Z0-9_]+$/),
  name: z.string(),
  categories: z.array(z.string()).min(1),
  priority: z.number().int().min(1).max(5),
  status: ClaimStatus,
  lookupBaseUrl: z.string().url().nullable(),
  lookupUrlTemplate: z.string().nullable().optional(),
  lookupTemplateVerified: z.boolean(),
  certPatterns: z.array(CertPatternSchema).min(1),
  labelTokens: z.array(z.string()),
  qrDomains: z.array(z.string()),
  api: z.object({ available: z.boolean(), requiresCredential: z.string().optional(), notes: z.string() }),
  officialImagery: z.object({ status: z.enum(["api", "public_page", "unknown"]), notes: z.string() }),
  /** How a grading/encapsulation date or holder generation can be learned from official data. */
  eraSources: z.object({
    gradingDate: z.enum(["official_api", "none"]),
    labelTypeField: z.boolean(), // official record exposes the holder/label type (e.g. PSA "Label Type")
    notes: z.string(),
  }),
  specializedChecks: z.array(z.string()),
});

/** Observable evidence that a slab belongs to a generation. `exclusive` markers only exist from this
 * generation onward, so seeing one on a slab whose official era predates it is an era mismatch.
 * Absence of a marker is NEVER evidence against a generation. */
export const MarkerSchema = z.object({
  id: z.string(),
  kind: z.enum(["code_present", "qr_domain", "label_text", "tilt_change", "backlit_change"]),
  value: z.string().optional(),
  exclusive: z.boolean(),
  status: ClaimStatus,
});

export const GenerationSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  graderId: z.string(),
  categories: z.array(z.string()).min(1),
  name: z.string(),
  gradingDateRange: z.object({ from: YearMonth.nullable(), to: YearMonth.nullable(), status: ClaimStatus, source: z.string().optional() }),
  /** Values of the grader's official "label type" field that identify this generation. */
  officialLabelTypes: z.array(z.string()).default([]),
  labelStructure: z.string(),
  features: z.array(z.string()),
  visualMarkers: z.array(MarkerSchema).default([]),
  notes: z.array(z.string()).default([]),
  status: ClaimStatus,
  sources: z.array(z.string()),
});

export const FeatureSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string(),
  description: z.string(),
  methods: z.array(z.enum(["visible_photo", "tilt_sequence", "backlight", "closeup_high_res", "code_decode", "ocr_crosscheck", "uv_light", "grader_service"])),
  phoneVerifiable: z.enum(["yes", "partial", "no"]),
  status: ClaimStatus,
  sources: z.array(z.string()),
});

/** Optional, verified cert-number → grading-period data. Empty unless verified data is added. */
export const CertRangeSchema = z.object({ graderId: z.string(), from: z.string(), to: z.string(), gradedFrom: YearMonth, gradedTo: YearMonth, source: z.string(), verified: z.literal(true) });

export const LibrarySchema = z
  .object({
    schemaVersion: z.literal(1),
    categories: z.array(CategorySchema).min(1),
    graders: z.array(GraderSchema).min(1),
    generations: z.array(GenerationSchema),
    features: z.array(FeatureSchema),
    certRanges: z.array(CertRangeSchema).default([]),
  })
  .superRefine((lib, ctx) => {
    const cat = new Set(lib.categories.map((c) => c.id));
    const grd = new Set(lib.graders.map((g) => g.id));
    const fea = new Set(lib.features.map((f) => f.id));
    const dup = (xs: string[], what: string) => xs.forEach((x, i) => xs.indexOf(x) !== i && ctx.addIssue({ code: "custom", message: `duplicate ${what} id ${x}` }));
    dup(lib.categories.map((c) => c.id), "category");
    dup(lib.graders.map((g) => g.id), "grader");
    dup(lib.generations.map((g) => g.id), "generation");
    dup(lib.features.map((f) => f.id), "feature");
    for (const g of lib.graders) {
      for (const c of g.categories) if (!cat.has(c)) ctx.addIssue({ code: "custom", message: `grader ${g.id}: unknown category ${c}` });
      for (const p of g.certPatterns) {
        try { new RegExp(p.pattern); } catch { ctx.addIssue({ code: "custom", message: `grader ${g.id}: invalid cert pattern ${p.pattern}` }); }
      }
    }
    for (const gen of lib.generations) {
      if (!grd.has(gen.graderId)) ctx.addIssue({ code: "custom", message: `generation ${gen.id}: unknown grader ${gen.graderId}` });
      for (const f of gen.features) if (!fea.has(f)) ctx.addIssue({ code: "custom", message: `generation ${gen.id}: unknown feature ${f}` });
      for (const c of gen.categories) if (!cat.has(c)) ctx.addIssue({ code: "custom", message: `generation ${gen.id}: unknown category ${c}` });
      const { from, to } = gen.gradingDateRange;
      if (from && to && from > to) ctx.addIssue({ code: "custom", message: `generation ${gen.id}: date range ends before it starts` });
    }
  });

export type LibraryData = z.infer<typeof LibrarySchema>;
export type Category = z.infer<typeof CategorySchema>;
export type GraderDef = z.infer<typeof GraderSchema>;
export type Generation = z.infer<typeof GenerationSchema>;
export type Feature = z.infer<typeof FeatureSchema>;
export type Marker = z.infer<typeof MarkerSchema>;

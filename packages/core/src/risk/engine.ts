import { resolveEra, type EraResolution } from "../library/era";
import { defaultLibrary, type CompiledLibrary } from "../library/runtime";
import type { Generation as HolderGeneration } from "../library/schema";
import { distinctImages, edgeReviewRules, labelRules, physicalMatchRules, retakeRequests, tiltVideoRules } from "./phase2";
import type {
  ComparisonResult,
  EdgeReviewResult,
  PhysicalMatch,
  RetakeRequest,
  TiltVideoResult,
  EvidenceQuality,
  GraderId,
  HolderInspectionResult,
  Observation,
  OfficialCertRecord,
  OverallAssessment,
  Provenance,
  QualityReport,
  RiskFinding,
  VerificationMode,
} from "../types";

/**
 * Transparent, rule-based verification engine. No authenticity probability is
 * produced: we emit observations, findings and an overall category. A
 * statistical score should only be added after labeled calibration.
 */
export const RULES_VERSION = "rules-0.2.0";

export interface EngineInput {
  mode: VerificationMode;
  grader: GraderId | null;
  certNumber: string | null;
  certSource: "qr" | "barcode" | "ocr" | "user" | null;
  certUserConfirmed: boolean;
  record: OfficialCertRecord | null;
  labelOcrText: string[];
  images: { id: string; role: string; quality: QualityReport }[];
  /** Comparison of upload vs reference per side. Reference provenance matters. */
  comparisons: { side: "front" | "back"; referenceSource: Provenance["source"]; result: ComparisonResult }[];
  holder: HolderInspectionResult | null;
  reverseImage?: { status: "not_configured" | "not_entitled" | "done"; samePhotoUrls: string[]; similarUrls: string[] };
  edgeReviews?: EdgeReviewResult[];
  tiltVideo?: TiltVideoResult;
  /** Published reference library (data-driven). Defaults to the built-in seed (tests). */
  library?: CompiledLibrary;
  /** Item category from the library (e.g. sports_cards, tcg, sealed_video_games). */
  category?: string | null;
  now?: string;
}

export interface EngineOutput {
  observations: Observation[];
  findings: RiskFinding[];
  evidenceQuality: EvidenceQuality;
  assessment: OverallAssessment;
  nextActions: string[];
  holderGeneration: { candidates: HolderGeneration[]; note: string } | null;
  era: EraResolution | null;
  category: string;
  library: { version: string; sha256: string | null };
  physicalMatch: PhysicalMatch[];
  retakeRequests: RetakeRequest[];
  duplicates: { id: string; role: string; duplicateOf: string }[];
  rulesVersion: string;
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

export function runEngine(input: EngineInput): EngineOutput {
  const now = input.now ?? new Date().toISOString();
  const prov = (source: Provenance["source"], tool = RULES_VERSION, extra: Partial<Provenance> = {}): Provenance => ({
    source,
    tool,
    retrievedAt: now,
    ...extra,
  });
  const obs: Observation[] = [];
  const findings: RiskFinding[] = [];
  const add = (o: Observation) => (obs.push(o), o.id);
  const lib = input.library ?? defaultLibrary();
  const category = lib.category(input.category);
  const graderName = (id: string) => lib.grader(id)?.name ?? id;
  const physical: PhysicalMatch[] = [];
  // Near-identical photos never add evidence (e.g. the same shot uploaded as front and back).
  const { kept: distinct, duplicates } = distinctImages(input.images);
  input = { ...input, images: distinct };

  // ---------- 1. Certification ----------
  if (!input.grader || !input.certNumber) {
    add({ id: "cert.missing", category: "certification", title: "Certification number not established", status: "inconclusive", basis: "unknown", detail: "Grader and/or certification number could not be read or confirmed.", provenance: prov("computed") });
  } else if (!input.record || input.record.found === null) {
    add({
      id: "cert.unchecked",
      category: "certification",
      title: "Official record not retrieved automatically",
      status: "inconclusive",
      basis: "unknown",
      detail: `${graderName(input.grader)} does not offer an integration we can use${input.record?.provenance.note ? ` (${input.record.provenance.note})` : ""}. Open the official lookup to confirm the record.`,
      provenance: prov("official_link", RULES_VERSION, { url: input.record?.verificationUrl ?? undefined }),
    });
  } else if (input.record.found === false) {
    const id = add({ id: "cert.not_found", category: "certification", title: "No official record found", status: "potential_discrepancy", basis: "fact", detail: `The grader's service returned no record for cert ${input.certNumber}.`, provenance: input.record.provenance });
    findings.push({
      id: "f.cert_not_found",
      severity: "high",
      pattern: "cert_not_found",
      summary: "Certification number not found in the grader's records",
      explanation: "A slab whose certificate cannot be found is a serious concern, but OCR misreads are common — confirm the number digit-by-digit first.",
      observationIds: [id],
      legitimateExplanations: ["Cert number misread or mistyped", "Very recent grading not yet indexed"],
    });
  } else {
    add({ id: "cert.found", category: "certification", title: "Official record found", status: "consistent", basis: "fact", detail: `${input.record.description ?? "Record"}${input.record.grade ? ` — grade ${input.record.grade}` : ""}.`, provenance: input.record.provenance });
  }
  if (input.certNumber && input.certSource === "ocr" && !input.certUserConfirmed) {
    add({ id: "cert.ocr_unconfirmed", category: "evidence_quality", title: "Cert number from OCR not yet confirmed", status: "inconclusive", basis: "inference", detail: "OCR can confuse similar characters (0/O, 1/7, 5/S). Confirm the number matches the label.", provenance: prov("computed") });
  }

  // QR/barcode vs printed number
  const decoded = input.holder?.codes ?? [];
  if (input.certNumber && decoded.length) {
    const cn = norm(input.certNumber);
    const agree = decoded.some((c) => norm(c.data).includes(cn));
    const id = add({
      id: "cert.code_vs_print",
      category: "certification",
      title: "Label code vs. certification number",
      status: agree ? "consistent" : "potential_discrepancy",
      basis: "inference",
      detail: agree ? "Decoded label code contains the certification number." : "Decoded label code does not contain the confirmed certification number.",
      metrics: { decoded: decoded.map((d) => d.data).join(" | ") },
      provenance: prov("computed", input.holder?.toolVersion),
    });
    if (!agree)
      findings.push({ id: "f.code_mismatch", severity: "medium", pattern: "label_modification_possible", summary: "Label code and printed cert number disagree", explanation: "The machine-readable code on the label points to a different number than the one confirmed. This is compatible with a modified or replacement label.", observationIds: [id], legitimateExplanations: ["Code decoded from a different slab in frame", "Partial decode"] });
  }

  // ---------- 2. Description / grade vs label OCR ----------
  if (input.record?.found && input.labelOcrText.length) {
    const label = norm(input.labelOcrText.join(" "));
    const fields: [string, string | undefined][] = [["grade", input.record.grade], ["year", input.record.year], ["subject", input.record.subject], ["card number", input.record.cardNumber]];
    const checked = fields.filter(([, v]) => v && norm(v).length >= 1);
    const missing = checked.filter(([, v]) => !label.includes(norm(v!)));
    if (checked.length) {
      const id = add({
        id: "identity.label_vs_record",
        category: "identity",
        title: "Label text vs. official record",
        status: missing.length === 0 ? "consistent" : missing.length >= 2 ? "potential_discrepancy" : "inconclusive",
        basis: "inference",
        detail: missing.length === 0 ? "Grade and description fields found on the label match the record." : `Not found on label OCR: ${missing.map(([k]) => k).join(", ")}.`,
        provenance: prov("computed"),
      });
      if (missing.some(([k]) => k === "grade") && missing.length >= 2)
        findings.push({ id: "f.attribution", severity: "medium", pattern: "attribution_mismatch", summary: "Label details may not match the official record", explanation: "Several record fields (including grade) were not found in the label text. Compare the label to the official record manually.", observationIds: [id], legitimateExplanations: ["OCR misread (glare, small print)", "Label abbreviations differ from record wording"] });
    }
  }

  // ---------- 3/4. Reference comparison & physical fingerprint ----------
  for (const c of input.comparisons) {
    const r = c.result;
    const refLabel = c.referenceSource === "official_api" ? "official grader image" : "user-supplied reference image (not retrieved from the grader by this app)";
    const dId = add({ id: `ref.${c.side}.design`, category: "reference_comparison", title: `${cap(c.side)}: same card design as ${refLabel}`, status: r.designMatch.status, basis: "inference", detail: r.designMatch.status === "consistent" ? `Artwork aligned with ${r.designMatch.inliers} geometric feature matches.` : r.designMatch.status === "potential_discrepancy" ? "The card design could not be aligned to the reference — it may be a different card." : "Too few reliable features to establish the design match.", metrics: { inliers: r.designMatch.inliers, inlierRatio: round(r.designMatch.inlierRatio) }, imageRefs: compact([r.overlays.sideBySide]), provenance: prov("computed", r.toolVersion) });
    const cId = add({ id: `ref.${c.side}.centering`, category: "physical_fingerprint", title: `${cap(c.side)}: centering / cut position`, status: r.centering.status, basis: "inference", detail: r.centering.status === "consistent" ? "Card-edge position relative to the artwork matches the reference within tolerance." : r.centering.status === "potential_discrepancy" ? `Card-edge position differs from the reference by ~${round(r.centering.edgeOffsetPct ?? 0)}% of card width. Identical-design copies are cut differently, so this suggests a different physical card.` : "Card edges were not measurable in both images.", metrics: { edgeOffsetPct: r.centering.edgeOffsetPct ?? null, uploadLR: r.centering.upload?.lr ?? null, referenceLR: r.centering.reference?.lr ?? null }, imageRefs: compact([r.overlays.aligned]), provenance: prov("computed", r.toolVersion) });
    const lId = add({ id: `ref.${c.side}.local`, category: "physical_fingerprint", title: `${cap(c.side)}: surface / print details`, status: r.localDifferences.status, basis: "inference", detail: r.localDifferences.status === "potential_discrepancy" ? `${r.localDifferences.flaggedRegions.length} region(s) show structural differences after alignment (glare-masked ${round(r.localDifferences.glareMaskedPct)}% excluded).` : r.localDifferences.status === "consistent" ? `No structural differences across ${round(r.localDifferences.comparableAreaPct)}% comparable area.` : "Not enough comparable area (glare, resolution or alignment).", regions: r.localDifferences.flaggedRegions, imageRefs: compact([r.overlays.diffHeatmap]), provenance: prov("computed", r.toolVersion) });

    if (r.designMatch.status === "potential_discrepancy") {
      findings.push({ id: `f.${c.side}.design`, severity: c.referenceSource === "official_api" ? "high" : "medium", pattern: c.side === "back" ? "front_back_inconsistent" : "cert_cloning_suspected", summary: `${cap(c.side)} does not appear to be the card shown in the reference`, explanation: "A valid certification number paired with a different card is the signature of certificate cloning.", observationIds: [dId], legitimateExplanations: ["Reference image belongs to another cert (check source)", "Severe glare or partial capture"] });
    }
    if (category.checks.physicalFingerprint) physical.push(physicalMatchRules(c, { design: dId, centering: cId, local: lId }, add, findings, prov));
    if (category.checks.labelComparison) labelRules(c, add, findings, prov);
    if (r.photoReuse.nearIdentical && input.mode === "in_hand") {
      const id = add({ id: `reuse.${c.side}.screenshot`, category: "image_reuse", title: `${cap(c.side)}: capture nearly identical to reference`, status: "potential_discrepancy", basis: "inference", detail: "Your capture is pixel-similar to the reference image itself, which usually means a screenshot was photographed rather than the slab.", metrics: { hamming: r.photoReuse.hammingFull }, provenance: prov("computed", r.toolVersion) });
      findings.push({ id: `f.${c.side}.screenshot`, severity: "medium", pattern: "screenshot_of_reference", summary: "Capture appears to be the reference photo", explanation: "In-hand mode expects a fresh photo of the physical slab.", observationIds: [id], legitimateExplanations: ["Wrong file selected"] });
    }
    if (r.photoReuse.nearIdentical && input.mode === "online_listing") {
      add({ id: `reuse.${c.side}.listing_is_reference`, category: "image_reuse", title: `${cap(c.side)}: listing photo matches the reference photo`, status: "inconclusive", basis: "inference", detail: "The seller's image appears to be the grader's image. This does not show the seller possesses this slab.", provenance: prov("computed", r.toolVersion) });
    }
  }
  const hasReference = input.comparisons.length > 0;

  // ---------- 5/6/7. Holder ----------
  let holderGeneration: EngineOutput["holderGeneration"] = null;
  let era: EraResolution | null = null;
  if (input.grader) {
    // Era = when the slab was graded/encapsulated (current holder). The item's year is never used.
    era = resolveEra(lib, input.grader, category.id, {
      gradingDate: input.record?.found ? input.record.gradingDate ?? null : null,
      labelType: input.record?.found ? input.record.labelType ?? null : null,
      certNumber: input.certNumber,
      observed: {
        codes: input.holder?.codes ?? [],
        ocrText: input.labelOcrText,
        tiltChange: input.holder?.tilt?.status === "consistent",
        backlitChange: input.holder?.backlit?.status === "consistent",
      },
    });
    const official = ["official_grading_date", "official_label_type", "verified_cert_range"].includes(era.basis);
    const eraId = add({
      id: "holder.era", category: "holder", title: "Grading era / holder generation",
      status: era.mismatch ? "potential_discrepancy" : era.generation && official ? "consistent" : "inconclusive",
      basis: official ? "fact" : era.generation ? "inference" : "unknown",
      detail: `${era.generation ? `${era.generation.name}. ` : ""}${era.explanation}${era.mismatch ? ` ${era.mismatch.explanation}` : ""}`,
      metrics: { basis: era.basis, confidence: era.confidence, generation: era.generation?.id ?? null, gradedFrom: era.gradingPeriod?.from ?? null, gradedTo: era.gradingPeriod?.to ?? null },
      provenance: prov(official ? "official_api" : "computed", RULES_VERSION, { note: `library ${lib.meta.version}` }),
    });
    if (era.mismatch)
      findings.push({
        id: "f.era_mismatch", severity: "medium", pattern: "era_mismatch",
        summary: "Holder features don't match the grading era on record",
        explanation: `${era.mismatch.explanation} A label or holder from a different era than the grader's record is compatible with a replaced label or a counterfeit holder.`,
        observationIds: [eraId],
        legitimateExplanations: ["The slab was reholdered after the record was captured", "Lighting change mistaken for a label effect", "Grader record not yet updated"],
      });
    const gens = era.generation ? [era.generation] : era.candidates;
    holderGeneration = { candidates: gens, note: era.generation ? `${era.inferred ? "Inferred" : "Determined"} from ${era.basis.replace(/_/g, " ")} (confidence ${era.confidence}).` : era.explanation };
    // Features of other generations are explicitly "not applicable" once the era is known.
    if (era.generation)
      for (const fid of new Set(era.candidates.filter((g) => g !== era!.generation).flatMap((g) => g.features)))
        if (!era.generation.features.includes(fid)) {
          const f = lib.feature(fid);
          if (f) add({ id: `sec.${fid}`, category: "security_feature", title: f.name, status: "not_applicable", basis: "inference", detail: `Not part of the ${era.generation.name} design.`, provenance: prov("computed") });
        }
    const featureIds = new Set(gens.flatMap((g) => g.features));
    for (const fid of featureIds) {
      const f = lib.feature(fid);
      if (!f) continue;
      const inAllGens = gens.every((g) => g.features.includes(fid));
      let status: Observation["status"] = "inconclusive";
      let detail = f.description;
      if (f.phoneVerifiable === "no") {
        status = "not_supported_by_device";
        detail += " Requires specialized equipment or the grader's own service.";
      } else if (fid === "psa_lighthouse") {
        if (input.holder?.backlit?.status === "consistent") (status = "consistent"), (detail += " A clear illumination change was observed between normal and backlit captures.");
        else if (input.holder?.backlit) (status = inAllGens ? input.holder.backlit.status : "inconclusive"), (detail += " No clear illumination change observed; this can be lighting technique or an older (pre-2017) label.");
        else status = "not_visible";
      } else if (f.methods.includes("tilt_sequence") && input.holder?.tilt) {
        status = input.holder.tilt.status === "potential_discrepancy" && !inAllGens ? "inconclusive" : input.holder.tilt.status;
        detail += ` Hue variation across ${input.holder.tilt.frames} tilt frames: ${round(input.holder.tilt.hueVariation)}.`;
      } else if (f.methods.includes("code_decode")) {
        status = decoded.length ? (obs.find((o) => o.id === "cert.code_vs_print")?.status ?? "consistent") : "not_visible";
      } else if (fid === "generic_case_integrity" && input.holder) {
        const allEdges = Object.values(input.holder.edgesVisible).every(Boolean);
        status = !allEdges ? "not_visible" : input.holder.edgeStraightness.status;
        detail += ` Max edge deviation ${round(input.holder.edgeStraightness.maxDeviationPct)}%.`;
      } else if (f.methods.includes("closeup_high_res")) {
        status = input.images.some((i) => i.role === "security_closeup" && i.quality.ok) ? "inconclusive" : "not_visible";
        if (status === "inconclusive") detail += " Close-up captured; automated microprint verification is not yet supported — review the close-up visually.";
      } else if (f.methods.includes("grader_service")) {
        status = "inconclusive";
      }
      const id = add({ id: `sec.${fid}`, category: "security_feature", title: f.name, status, basis: f.status === "confirmed_official" ? "inference" : "unknown", detail: f.status === "confirmed_official" ? detail : `${detail} (Feature documentation unconfirmed.)`, provenance: prov("computed", input.holder?.toolVersion, { url: f.sources[0] }) });
      if (fid === "generic_case_integrity" && status === "potential_discrepancy")
        findings.push({ id: "f.case", severity: "medium", pattern: "case_alteration_possible", summary: "Holder edge geometry is irregular", explanation: "One or more holder edges deviate from a straight line more than expected. Inspect seams for gaps, cracks, or glue.", observationIds: [id], legitimateExplanations: ["Lens distortion", "Photo taken at an angle", "Normal wear"] });
    }
  }

  // ---------- 8. Reverse image ----------
  if (input.reverseImage?.status === "done") {
    const n = input.reverseImage.samePhotoUrls.length;
    const id = add({ id: "reuse.web", category: "image_reuse", title: "Same photograph found online", status: n ? "inconclusive" : "consistent", basis: "fact", detail: n ? `${n} page(s) contain the same photograph. Reuse alone is not evidence of fraud.` : "No exact copies of this photo found by the search provider.", metrics: { samePhoto: n, similar: input.reverseImage.similarUrls.length }, provenance: prov("third_party_search", "google-vision-web-detection") });
    if (n && input.mode === "online_listing")
      findings.push({ id: "f.listing_reuse", severity: "low", pattern: "listing_photo_reuse", summary: "Listing photo appears elsewhere online", explanation: "The seller's photo appears on other pages. Ask the seller for a new photo with a handwritten note or specific angle.", observationIds: [id], legitimateExplanations: ["Seller cross-listed on multiple marketplaces", "Previous sale of the same slab"] });
  }

  edgeReviewRules(input.edgeReviews, add, prov);
  tiltVideoRules(input.tiltVideo, add, prov);

  // ---------- 9. Evidence quality ----------
  const evidenceQuality = assessEvidence(input, hasReference);
  if (evidenceQuality.level === "insufficient")
    findings.push({ id: "f.insufficient", severity: "info", pattern: "insufficient_evidence", summary: "Evidence is insufficient for a reliable assessment", explanation: evidenceQuality.reasons.join(" "), observationIds: [], legitimateExplanations: [] });

  const assessment = overall(findings, evidenceQuality);
  if (duplicates.length) evidenceQuality.reasons.push(`${duplicates.length} photo(s) were near-duplicates of another photo and were not counted.`);
  const retakes = retakeRequests({ grader: input.grader, obs, findings, roles: new Set(input.images.map((i) => i.role)), hasReference, comparisons: input.comparisons, mode: input.mode, duplicates });
  return { observations: obs, findings, evidenceQuality, assessment, nextActions: nextActions(input, findings, evidenceQuality, hasReference), holderGeneration, era, category: category.id, library: lib.meta, physicalMatch: physical, retakeRequests: retakes, duplicates, rulesVersion: RULES_VERSION };
}

function assessEvidence(input: EngineInput, hasReference: boolean): EvidenceQuality {
  const reasons: string[] = [];
  const good = (role: string) => input.images.some((i) => i.role === role && i.quality.ok);
  let points = 0;
  if (good("front")) points += 2;
  else reasons.push("No usable front image.");
  if (good("back")) points += 1;
  else reasons.push("No usable back image.");
  if (good("label_closeup") || input.certUserConfirmed) points += 1;
  if (input.record?.found) points += 2;
  else reasons.push("Official record not confirmed automatically.");
  if (hasReference) points += 2;
  else reasons.push("No reference image to compare against.");
  if (input.comparisons.some((c) => c.result.centering.status !== "inconclusive")) points += 1;
  if (input.mode === "online_listing") reasons.push("Seller-provided images: physical possession and liveness cannot be verified.");
  const level = !good("front") ? "insufficient" : points >= 8 ? "strong" : points >= 5 ? "moderate" : points >= 3 ? "limited" : "insufficient";
  return { level: input.mode === "online_listing" && level === "strong" ? "moderate" : level, reasons };
}

function overall(findings: RiskFinding[], eq: EvidenceQuality): OverallAssessment {
  if (findings.some((f) => f.severity === "high")) return "high_risk_inconsistencies";
  if (eq.level === "insufficient") return "unable_to_assess";
  if (findings.some((f) => f.severity === "medium" || f.severity === "low") || eq.level === "limited") return "additional_verification_recommended";
  return eq.level === "strong" ? "no_major_conflicts" : "additional_verification_recommended";
}

function nextActions(input: EngineInput, findings: RiskFinding[], eq: EvidenceQuality, hasReference: boolean): string[] {
  const a: string[] = [];
  const g = input.grader ? (input.library ?? defaultLibrary()).grader(input.grader) ?? null : null;
  if (findings.some((f) => f.pattern === "cert_not_found")) a.push("Re-check the cert number digit-by-digit against the label, then look it up on the grader's official site.");
  if (g && !input.record?.found) a.push(`Open the official ${g.id} lookup and compare the record (card, grade, images) with the slab.`);
  if (!hasReference) a.push(g?.officialImagery.status === "api" ? "Official images were unavailable for this cert; if the grader's page shows images, upload one as a reference (it will be labeled user-supplied)." : "If the grader's cert page shows images, upload one as a reference image (it will be labeled user-supplied).");
  if (findings.some((f) => f.pattern === "different_physical_card" || f.pattern === "cert_cloning_suspected")) a.push("Request a new straight-on, glare-free front photo and compare edges/centering against the official image. Consider direct grader confirmation before purchasing.");
  if (findings.some((f) => f.pattern === "label_modification_possible")) a.push("Capture a sharp, glare-free label close-up so the printed number and code can be re-read.");
  if (input.mode === "online_listing") a.push("Ask the seller for a fresh photo of the slab next to a handwritten note with today's date.");
  if (g?.specializedChecks.length) a.push(...g.specializedChecks.filter((s) => /official|Proof|grader/i.test(s)));
  if (eq.level === "insufficient" || eq.level === "limited") a.push("Add the missing photos listed under Evidence Quality and re-run analysis (no extra credit is used within this session).");
  if (!a.length) a.push("No major conflicts found. For high-value purchases, still confirm on the grader's site and buy with payment protection.");
  return [...new Set(a)];
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const round = (n: number) => Math.round(n * 10) / 10;
const compact = <T>(xs: (T | undefined)[]) => xs.filter((x): x is T => x !== undefined);

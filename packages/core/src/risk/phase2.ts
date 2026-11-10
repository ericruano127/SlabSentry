import type {
  CheckStatus, ComparisonResult, EdgeReviewResult, Observation, PhysicalMatch, Provenance, RetakeRequest, RiskFinding, TiltVideoResult,
} from "../types";

type Add = (o: Observation) => string;
type Prov = (source: Provenance["source"], tool?: string, extra?: Partial<Provenance>) => Provenance;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * Copy-level signals. "strong" signals each reflect a physical property of one specific
 * card (cut position, edge wear, unique marks). "weak" ones are easily disturbed by
 * imaging (registration: lens/demosaicing; local differences: reflections, holder scratches).
 */
const SIGNALS = {
  centering: { label: "Cut position / centering", strong: true },
  edgeProfile: { label: "Edge & corner wear profile", strong: true },
  marks: { label: "Unique surface / print marks", strong: true },
  registration: { label: "Print colour registration", strong: false },
  localDifferences: { label: "Fine surface detail", strong: false },
} as const;
type SignalKey = keyof typeof SIGNALS;

export function signalStatuses(r: ComparisonResult): Record<SignalKey, CheckStatus> {
  return {
    centering: r.centering.status,
    edgeProfile: r.fingerprint?.edgeProfile.status ?? "inconclusive",
    marks: r.fingerprint?.marks.status ?? "inconclusive",
    registration: r.fingerprint?.registration.status ?? "inconclusive",
    localDifferences: r.localDifferences.status,
  };
}

/**
 * Exact-physical-card rule (transparent):
 *  - supported:   design matches AND ≥2 strong signals consistent AND no signal conflicts
 *  - conflicting: any strong signal conflicts, or ≥2 weak signals conflict
 *  - otherwise not established — identical artwork alone never counts as a match.
 */
export function physicalMatch(side: "front" | "back", r: ComparisonResult): PhysicalMatch {
  const st = signalStatuses(r);
  const matching: string[] = [], conflicting: string[] = [], inconclusive: string[] = [];
  for (const k of Object.keys(SIGNALS) as SignalKey[]) {
    const lab = SIGNALS[k].label;
    if (st[k] === "consistent") matching.push(lab);
    else if (st[k] === "potential_discrepancy") conflicting.push(lab);
    else inconclusive.push(lab);
  }
  const strongOk = (Object.keys(SIGNALS) as SignalKey[]).filter((k) => SIGNALS[k].strong && st[k] === "consistent").length;
  const strongBad = (Object.keys(SIGNALS) as SignalKey[]).filter((k) => SIGNALS[k].strong && st[k] === "potential_discrepancy").length;
  const weakBad = (Object.keys(SIGNALS) as SignalKey[]).filter((k) => !SIGNALS[k].strong && st[k] === "potential_discrepancy").length;
  let verdict: PhysicalMatch["verdict"] = "not_established";
  if (r.designMatch.status !== "consistent") verdict = "not_established";
  else if (strongBad >= 1 || weakBad >= 2) verdict = "conflicting";
  else if (strongOk >= 2 && conflicting.length === 0) verdict = "supported";
  const summary =
    r.designMatch.status !== "consistent"
      ? `${cap(side)}: the card design could not be matched to the reference, so physical-copy characteristics were not compared.`
      : verdict === "supported"
        ? `${cap(side)}: ${strongOk} independent physical characteristics match the reference copy (${matching.join(", ")}).`
        : verdict === "conflicting"
          ? `${cap(side)}: same card design, but ${conflicting.join(" and ").toLowerCase()} differ from the reference copy.`
          : `${cap(side)}: same card design; an exact physical-copy match is not established (${inconclusive.length} characteristic(s) could not be assessed).`;
  return { side, verdict, matching, conflicting, inconclusive, summary };
}

export function physicalMatchRules(
  c: { side: "front" | "back"; referenceSource: Provenance["source"]; result: ComparisonResult },
  ids: { design: string; centering: string; local: string },
  add: Add, findings: RiskFinding[], prov: Prov,
): PhysicalMatch {
  const r = c.result;
  const official = c.referenceSource === "official_api";
  const f = r.fingerprint;
  const obsIds = [ids.centering, ids.local];
  if (f) {
    const lowRes = f.lowResolution ? " Higher-resolution photos are needed for this check." : "";
    const mk = f.marks;
    obsIds.push(add({
      id: `fp.${c.side}.marks`, category: "physical_fingerprint", title: `${cap(c.side)}: unique marks`, status: mk.status, basis: "inference",
      detail: mk.status === "potential_discrepancy"
        ? `${mk.unmatched} small mark(s) appear in only one of the two images (circled). Print specks, dents and scratches are specific to one physical card.`
        : mk.status === "consistent" ? "No marks found that appear in only one image." : `Not assessable.${mk.note ? ` ${mk.note}.` : ""}${lowRes}`,
      regions: [...(mk.onlyInUpload ?? []), ...(mk.onlyInReference ?? [])], imageRefs: r.overlays.sideBySide ? [r.overlays.sideBySide] : [],
      metrics: { unmatched: mk.unmatched ?? null }, provenance: prov("computed", r.toolVersion),
    }));
    const ep = f.edgeProfile;
    obsIds.push(add({
      id: `fp.${c.side}.edges`, category: "physical_fingerprint", title: `${cap(c.side)}: edge & corner wear profile`, status: ep.status, basis: "inference",
      detail: ep.status === "consistent" ? `The micro-shape of the cut edges matches the reference (correlation ${ep.correlation}).`
        : ep.status === "potential_discrepancy" ? `The cut-edge wear pattern does not match the reference (correlation ${ep.correlation}).`
        : `Not assessable${ep.note ? `: ${ep.note}` : ""}.${lowRes}`,
      metrics: { correlation: ep.correlation ?? null }, provenance: prov("computed", r.toolVersion),
    }));
    const rg = f.registration;
    obsIds.push(add({
      id: `fp.${c.side}.registration`, category: "physical_fingerprint", title: `${cap(c.side)}: print colour registration`, status: rg.status, basis: "inference",
      detail: rg.status === "potential_discrepancy" ? `Ink-layer alignment differs from the reference by ~${rg.deltaPx}px. Can indicate a different print sheet, but camera lenses also shift colours.`
        : rg.status === "consistent" ? "Ink-layer alignment matches the reference." : `Not assessable${rg.note ? `: ${rg.note}` : ""}.${lowRes}`,
      metrics: { deltaPx: rg.deltaPx ?? null }, provenance: prov("computed", r.toolVersion),
    }));
  }
  const pm = physicalMatch(c.side, r);
  if (pm.verdict === "conflicting") {
    const st = signalStatuses(r);
    const strongBad = (["centering", "edgeProfile", "marks"] as const).filter((k) => st[k] === "potential_discrepancy");
    const severe = strongBad.length >= 2 || st.centering === "potential_discrepancy";
    findings.push({
      id: `f.${c.side}.copy`,
      severity: official ? (severe ? "high" : "medium") : severe ? "medium" : "low",
      pattern: "different_physical_card",
      summary: "Same card design, but possibly a different physical copy",
      explanation: `${pm.summary} A genuine slab should contain the exact copy that was imaged at grading, so a valid cert paired with a different copy is a cloning pattern.`,
      observationIds: [ids.design, ...obsIds],
      legitimateExplanations: [
        ...(st.centering === "potential_discrepancy" ? ["Perspective distortion or a cropped reference"] : []),
        ...(st.marks === "potential_discrepancy" ? ["Dust, holder scratches or reflections in one photo"] : []),
        ...(st.registration === "potential_discrepancy" ? ["Lens colour fringing or heavy image compression"] : []),
        "Reference image of the card outside the holder or before reholdering",
      ],
    });
  }
  return pm;
}

export function labelRules(c: { side: "front" | "back"; referenceSource: Provenance["source"]; result: ComparisonResult }, add: Add, findings: RiskFinding[], prov: Prov) {
  const lc = c.result.labelComparison;
  if (!lc || c.side !== "front" || lc.status === "not_applicable") return;
  const id = add({
    id: "tamper.label_vs_reference", category: "tampering", title: "Label vs. label in reference image", status: lc.status, basis: "inference",
    detail: lc.status === "consistent" ? "Label text in your photo matches the label visible in the reference image."
      : lc.status === "potential_discrepancy" ? `The certification number printed on your label differs from the one on the label in the reference image.${lc.missingFromUpload?.length ? ` Missing from your label: ${lc.missingFromUpload.slice(0, 6).join(", ")}.` : ""}`
      : `Labels could not be matched reliably${lc.note ? ` (${lc.note})` : ""}. A reholder or newer label generation can change layout.`,
    metrics: { tokenOverlap: lc.tokenOverlap ?? null }, provenance: prov("computed", c.result.toolVersion),
  });
  if (lc.status === "potential_discrepancy")
    findings.push({
      id: "f.label_swap", severity: c.referenceSource === "official_api" ? "high" : "medium", pattern: "label_modification_possible",
      summary: "Label differs from the label in the reference image",
      explanation: "The reference image shows a label with a different certification number. This is compatible with a replaced or counterfeit label. Re-read both labels before drawing conclusions.",
      observationIds: [id], legitimateExplanations: ["OCR misread on either label", "Reference image belongs to a different cert"],
    });
}

export function edgeReviewRules(reviews: EdgeReviewResult[] | undefined, add: Add, prov: Prov) {
  for (const [i, r] of (reviews ?? []).entries()) {
    add({
      id: `tamper.edge.${i}`, category: "tampering", title: `Holder edge close-up ${i + 1}`, status: r.status, basis: "inference",
      detail: r.status === "consistent" ? "Edge/seam looks continuous with no localized anomalies."
        : r.status === "inconclusive" ? `${r.anomalies} localized irregularit${r.anomalies === 1 ? "y" : "ies"} highlighted — review for gaps, cracks, glue or tool marks. Dust, scratches and reflections look similar.`
        : r.note ?? "No clear edge or seam found in this close-up.",
      regions: r.regions, imageRefs: [r.imageId], provenance: prov("computed", "vision/seam"),
    });
  }
}

export function tiltVideoRules(v: TiltVideoResult | undefined, add: Add, prov: Prov) {
  if (!v) return;
  add({
    id: "capture.tilt_video", category: "evidence_quality", title: "Tilt video", status: v.status === "ok" ? "consistent" : "inconclusive", basis: "inference",
    detail: v.status === "ok" ? `${v.distinctFrames} distinct frames selected from ${v.durationSec}s of video for holographic analysis. This does not verify liveness.`
      : `Only ${v.distinctFrames} distinct frame(s) found — tilt the slab more slowly through a wider angle.`,
    metrics: { distinctFrames: v.distinctFrames, sampled: v.sampled }, provenance: prov("computed", "vision/video"),
  });
}

/** Collapse near-identical uploads (pHash distance ≤ 4) so duplicates never add confidence. */
export function distinctImages<T extends { id: string; role: string; quality: { metrics?: Record<string, unknown> } }>(images: T[]) {
  const kept: T[] = [];
  const duplicates: { id: string; role: string; duplicateOf: string }[] = [];
  const ham = (a: string, b: string) => {
    let n = 0;
    for (let i = 0; i < a.length; i++) n += [...(parseInt(a[i], 16) ^ parseInt(b[i], 16)).toString(2)].filter((x) => x === "1").length;
    return n;
  };
  for (const img of images) {
    const h = img.quality?.metrics?.phash as string | undefined;
    const dup = h ? kept.find((k) => typeof k.quality?.metrics?.phash === "string" && ham(k.quality.metrics!.phash as string, h) <= 4) : undefined;
    if (dup) duplicates.push({ id: img.id, role: img.role, duplicateOf: dup.role });
    else kept.push(img);
  }
  return { kept, duplicates };
}

/** Adaptive retake requests: the specific capture that would resolve each open question. */
export function retakeRequests(ctx: {
  grader: string | null; obs: Observation[]; findings: RiskFinding[]; roles: Set<string>; hasReference: boolean;
  comparisons: { side: string; result: ComparisonResult }[]; mode: string; duplicates: { role: string; duplicateOf: string }[];
}): RetakeRequest[] {
  const out: RetakeRequest[] = [];
  const st = (id: string) => ctx.obs.find((o) => o.id === id)?.status;
  const push = (r: RetakeRequest) => { if (!out.some((x) => x.role === r.role && x.reason === r.reason)) out.push(r); };
  for (const d of ctx.duplicates)
    push({ role: d.role, priority: 1, reason: `Your ${d.role.replace("_", " ")} photo is nearly identical to your ${d.duplicateOf.replace("_", " ")} photo, so it adds no new evidence.`, guidance: "Take a new, separate photo for this view.", resolves: [] });
  if (!ctx.roles.has("back")) push({ role: "back", priority: 2, reason: "No back photo.", guidance: "Photograph the back of the slab, all four edges visible.", resolves: [] });
  for (const c of ctx.comparisons) {
    const r = c.result;
    const role = c.side;
    if (r.designMatch.status === "inconclusive")
      push({ role, priority: 1, reason: `The ${role} could not be aligned with the reference.`, guidance: "Retake straight-on, sharp, with the whole card visible and no glare.", resolves: [`ref.${role}.design`] });
    if (r.designMatch.status === "consistent" && r.centering.status === "inconclusive" && r.diagnostics?.cardDetected?.upload === false)
      push({ role, priority: 1, reason: "The card's edges weren't detected, so cut/centering couldn't be compared.", guidance: "Hold the phone parallel to the slab and keep all four card edges sharp and in frame.", resolves: [`ref.${role}.centering`] });
    if (r.localDifferences.status === "inconclusive" && r.localDifferences.glareMaskedPct > 8)
      push({ role, priority: 1, reason: `Glare hid ${Math.round(r.localDifferences.glareMaskedPct)}% of the card surface.`, guidance: "Tilt the slab slightly away from the light, or switch off overhead lights and use window light.", resolves: [`ref.${role}.local`] });
    if (r.fingerprint?.lowResolution)
      push({ role, priority: 2, reason: "The card is too small in the photo to compare fine physical details (marks, edge wear, print registration).", guidance: "Move closer so the card fills most of the frame (or use the 2× lens), keeping it sharp.", resolves: [`fp.${role}.marks`, `fp.${role}.edges`, `fp.${role}.registration`] });
  }
  if (!ctx.hasReference) push({ role: "reference_front", priority: 2, reason: "No reference image to compare against.", guidance: "If the grader's cert page shows images, add the front image (it will be labeled user-supplied).", resolves: [] });
  if (st("cert.ocr_unconfirmed") || st("cert.code_vs_print") === "potential_discrepancy" || st("tamper.label_vs_reference") === "inconclusive")
    push({ role: "label_closeup", priority: 1, reason: "The label couldn't be read with confidence.", guidance: "Fill the frame with the label, no glare, number and QR code sharp.", resolves: ["cert.code_vs_print", "tamper.label_vs_reference"] });
  if (ctx.grader === "PSA" && st("sec.psa_lighthouse") === "not_visible" && ctx.mode === "in_hand")
    push({ role: "backlit", priority: 3, reason: "PSA's LightHouse label effect wasn't checked.", guidance: "Hold a light behind the label and photograph the front with the same framing as your label close-up.", resolves: ["sec.psa_lighthouse"] });
  if (ctx.mode === "in_hand" && ctx.obs.some((o) => o.category === "security_feature" && o.status === "not_visible" && /holo|foil/i.test(o.title)) && !ctx.roles.has("tilt_frame"))
    push({ role: "tilt_video", priority: 3, reason: "Holographic elements weren't observed across angles.", guidance: "Record a 3–5 second video slowly tilting the slab under one light.", resolves: ctx.obs.filter((o) => /holo|foil/i.test(o.title)).map((o) => o.id) });
  const uvObs = ctx.obs.filter((o) => o.category === "security_feature" && o.status === "not_visible" && /blacklight/.test(o.detail));
  if (uvObs.length && ctx.mode === "in_hand" && !ctx.roles.has("uv"))
    push({ role: "uv", priority: 3, reason: "This label has UV-reactive features that need a blacklight photo.", guidance: "In a dark room, shine a 365–395 nm blacklight on the label and photograph it straight on.", resolves: uvObs.map((o) => o.id) });
  if (ctx.obs.some((o) => /microprint/i.test(o.id) && o.status === "not_supported_by_device") && ctx.mode === "in_hand")
    push({ role: "security_closeup", priority: 3, reason: "The microprint close-up wasn't sharp enough to resolve fine print.", guidance: "Move as close as the camera can focus (or use the macro/2× lens) on the microprint area, in good light.", resolves: [] });
  if (st("sec.generic_case_integrity") === "not_visible" && !ctx.roles.has("edge") && ctx.mode === "in_hand")
    push({ role: "edge", priority: 3, reason: "Holder edges and seams weren't fully visible.", guidance: "Take close-ups of each side of the holder.", resolves: ["sec.generic_case_integrity"] });
  return out.sort((a, b) => a.priority - b.priority).slice(0, 6);
}

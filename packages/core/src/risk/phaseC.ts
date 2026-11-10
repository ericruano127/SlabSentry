import type { MarketValue } from "../market/fmv";
import type { Generation } from "../library/schema";
import type { CertSightings, ImageIntegrityInput, Observation, Provenance, RiskFinding, TemplateComparisons } from "../types";

type Add = (o: Observation) => string;
type Prov = (source: Provenance["source"], tool?: string, extra?: Partial<Provenance>) => Provenance;

/** Image integrity: editing software named in the file and duplicated regions.
 * All of these have innocent causes (filters, screenshots, messaging apps), so they are review items;
 * only a duplicated region on the front produces a (low) finding. */
export function integrityRules(images: ImageIntegrityInput[] | undefined, mode: string, add: Add, findings: RiskFinding[], prov: Prov) {
  for (const img of images ?? []) {
    const label = img.role.replace("_", " ");
    const md = img.metadata;
    if (md?.editorDetected)
      add({ id: `integrity.${img.imageId}.software`, category: "image_integrity", title: `${cap(label)}: editing software named in the file`, status: "inconclusive", basis: "fact",
        detail: `The file says it was saved by "${md.software ?? "an editing app"}". Many people crop or adjust photos innocently — but ask for an unedited original if anything else looks off.`, imageRefs: [img.imageId], provenance: prov("computed", "metadata-sanitizer") });
    const f = img.forensics;
    if (f?.copyMove.status === "inconclusive" && f.copyMove.regions?.length) {
      const id = add({ id: `integrity.${img.imageId}.copy`, category: "image_integrity", title: `${cap(label)}: possibly duplicated region`, status: "inconclusive", basis: "inference",
        detail: "Part of the image appears to be repeated elsewhere with the same offset, which can indicate copy-paste editing (for example of numbers or label elements).", regions: f.copyMove.regions, imageRefs: [img.imageId], provenance: prov("computed", "vision/forensics") });
      if (img.role === "front" || img.role === "label_closeup")
        findings.push({ id: `f.${img.imageId}.copy`, severity: "low", pattern: "image_edit_indicators", summary: "Possible copy-paste editing in a photo",
          explanation: "A region of the photo appears duplicated. Ask for an unedited, new photo before relying on it.", observationIds: [id],
          legitimateExplanations: ["Repeated printed patterns on the item", "Photo-stitching or panorama features", "Heavy app filters"] });
    }
    // Recompression (error-level) analysis is NOT reported: in validation it flagged every clean test
    // image. Its raw output is still stored as evidence for future evaluation on labeled data.
  }
  const front = (images ?? []).find((i) => i.role === "front");
  if (front?.liveCapture && mode === "in_hand")
    add({ id: "capture.live", category: "evidence_quality", title: "Live in-app capture", status: "consistent", basis: "fact",
      detail: "The front photo was taken with the in-app camera during this session (one-time capture code). This shows when and where in the app it was captured — it can't rule out photographing a screen or a different slab.", provenance: prov("computed", "capture-nonce") });
  else if (front && mode === "in_hand" && front.metadata && !front.metadata.hadCameraMakeModel && !front.liveCapture)
    add({ id: "capture.no_camera_data", category: "image_integrity", title: "Front photo has no camera information", status: "inconclusive", basis: "fact",
      detail: "The file carried no camera details. That's normal for screenshots and messaging apps; for in-hand checks, use the in-app camera for stronger evidence.", provenance: prov("computed", "metadata-sanitizer") });
}

/** Label layout/colour vs a verified template of the same holder generation; slab proportions. */
export function templateRules(t: TemplateComparisons | undefined, gen: Generation | null, add: Add, findings: RiskFinding[], prov: Prov) {
  if (!gen) return;
  if (!t?.labelTemplateAvailable) {
    add({ id: "holder.label_layout", category: "holder", title: "Label layout & typography", status: "inconclusive", basis: "unknown",
      detail: `No verified label template is registered for "${gen.name}" yet, so layout, spacing, logo placement and colour can't be compared.`, provenance: prov("computed") });
  } else if (t.label?.status === "measured" && t.label.layout && t.label.colour) {
    const lid = add({ id: "holder.label_layout", category: "holder", title: "Label layout & typography vs verified template", status: t.label.layout.status, basis: "inference",
      detail: `Layout similarity to a verified ${gen.name} label: ${t.label.layout.score}.`, metrics: { score: t.label.layout.score }, provenance: prov("computed", "vision/template") });
    const cid = add({ id: "holder.label_colour", category: "holder", title: "Label colours vs verified template", status: t.label.colour.status, basis: "inference",
      detail: `Colour similarity to a verified ${gen.name} label: ${t.label.colour.score}.`, metrics: { score: t.label.colour.score }, provenance: prov("computed", "vision/template") });
    const bad = [t.label.layout.status, t.label.colour.status].filter((s) => s === "potential_discrepancy").length;
    if (bad)
      findings.push({ id: "f.label_template", severity: bad === 2 ? "medium" : "low", pattern: "label_modification_possible", summary: "Label design differs from the verified template",
        explanation: `The label's ${bad === 2 ? "layout and colours" : t.label.layout.status === "potential_discrepancy" ? "layout" : "colours"} differ from a verified ${gen.name} label.`,
        observationIds: [lid, cid], legitimateExplanations: ["Lighting or white balance (colour)", "Angle or glare on the label", "A label variant not yet in the template library"] });
  } else {
    add({ id: "holder.label_layout", category: "holder", title: "Label layout & typography", status: "not_visible", basis: "unknown", detail: "The label region wasn't found clearly enough to compare.", provenance: prov("computed") });
  }
  const p = t?.proportions;
  if (gen.proportions && p?.status === "measured" && p.holderAspect) {
    const [lo, hi] = gen.proportions.holderAspect;
    const angled = (p.angleDeviationDeg ?? 0) > 6;
    const inside = p.holderAspect >= lo && p.holderAspect <= hi;
    add({ id: "holder.proportions", category: "holder", title: "Holder proportions", status: angled ? "inconclusive" : inside ? "consistent" : "potential_discrepancy", basis: "inference",
      detail: angled ? "Photo is too angled to measure proportions reliably." : `Measured width/height ratio ${p.holderAspect}; documented range ${lo}–${hi}.`, metrics: { holderAspect: p.holderAspect }, provenance: prov("computed", "vision/template", { note: gen.proportions.source }) });
  }
}

/** Cloned certificates: the same grader+cert seen on a visually different item in other uploads. */
export function certSightingRules(s: CertSightings | undefined, add: Add, findings: RiskFinding[], prov: Prov) {
  if (!s || !s.otherSessions) return;
  const id = add({ id: "cert.sightings", category: "certification", title: "Same certificate in other uploads",
    status: s.visuallyDifferent ? "potential_discrepancy" : s.comparable ? "consistent" : "inconclusive", basis: "inference",
    detail: s.visuallyDifferent
      ? `This certification number was scanned before on ${s.visuallyDifferent} item${s.visuallyDifferent === 1 ? "" : "s"} that look clearly different. One cert should belong to one item.`
      : `This certification number appeared in ${s.otherSessions} other upload${s.otherSessions === 1 ? "" : "s"}${s.comparable ? " showing what looks like the same item" : ""}. Repeat scans of a slab that changes hands are normal.`,
    metrics: { otherSessions: s.otherSessions, visuallyDifferent: s.visuallyDifferent }, provenance: prov("computed", "cert-sightings", { note: "pseudonymous cross-upload index; no other user's data is shown" }) });
  if (s.visuallyDifferent)
    findings.push({ id: "f.cert_clone_sightings", severity: s.visuallyDifferent >= 2 ? "high" : "medium", pattern: "cert_cloning_suspected", summary: "Certificate seen on a different-looking item",
      explanation: "The same certification number has been scanned on a visually different item. Counterfeiters often copy a real cert number onto fake slabs.", observationIds: [id],
      legitimateExplanations: ["A previous upload had the cert number typed wrong", "A previous photo showed a different side or a heavily cropped item"] });
}

/** Online-listing price sanity check against FMV (FMV assumes genuine; never affects other checks). */
export function priceRules(mode: string, askingPriceCents: number | null | undefined, mv: MarketValue | null | undefined, add: Add, findings: RiskFinding[], prov: Prov) {
  if (!mv) return;
  add({ id: "market.value", category: "market", title: "Fair market value (if genuine)", status: mv.status === "estimated" || mv.status === "guide_only" ? "consistent" : "inconclusive", basis: mv.status === "insufficient_data" ? "unknown" : "fact",
    detail: mv.note, metrics: { estimateCents: mv.estimateCents, lowCents: mv.lowCents, highCents: mv.highCents, comps: mv.compsUsed }, provenance: prov("computed", "fmv", { note: mv.sources.join(", ") }) });
  if (mode !== "online_listing" || !askingPriceCents || !mv.estimateCents || mv.confidence === "none") return;
  const ratio = askingPriceCents / mv.estimateCents;
  if (ratio < 0.5) {
    const id = add({ id: "market.asking_price", category: "market", title: "Asking price vs market value", status: "potential_discrepancy", basis: "inference",
      detail: `Asking price is ${Math.round(ratio * 100)}% of the estimated market value for this grade.`, metrics: { ratio: Math.round(ratio * 100) / 100 }, provenance: prov("computed", "fmv") });
    findings.push({ id: "f.price", severity: "low", pattern: "price_anomaly", summary: "Priced far below market value",
      explanation: "Prices well below recent sales are a common pattern in counterfeit and scam listings. Be extra careful and use payment protection.", observationIds: [id],
      legitimateExplanations: ["Seller needs a quick sale", "Auction starting price", "Market value estimate based on few sales"] });
  }
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

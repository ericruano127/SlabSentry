import type { CompiledLibrary } from "./runtime";
import type { Generation, Marker } from "./schema";

/**
 * Era-aware verification: which holder/label generation should this slab match?
 *
 * The era is decided by when the slab was GRADED/ENCAPSULATED (its current holder — a reholder or
 * regrade resets it), NEVER by the item's year/set/print date. Evidence, strongest first:
 *   1. official grading date from the grader's record (only if the grader exposes one)
 *   2. official label/holder type from the grader's record (e.g. PSA "Label Type")
 *   3. verified cert-number → grading-period ranges (library data; empty unless verified)
 *   4. visual inference from observed traits (stated as inferred, low confidence)
 * Missing newer features never count against an older generation.
 */
export type EraBasis = "official_grading_date" | "official_label_type" | "verified_cert_range" | "visual_inference" | "only_known_generation" | "unknown";

export interface EraEvidence {
  gradingDate?: string | null; // YYYY-MM or YYYY-MM-DD from an official source
  labelType?: string | null; // official record's label/holder type
  certNumber?: string | null;
  observed: { codes: { type: string; data: string }[]; ocrText: string[]; tiltChange: boolean; backlitChange: boolean };
}

export interface EraResolution {
  generation: Generation | null;
  candidates: Generation[];
  basis: EraBasis;
  confidence: "high" | "medium" | "low" | "none";
  inferred: boolean;
  gradingPeriod: { from: string | null; to: string | null } | null;
  markersObserved: { generationId: string; marker: string; exclusive: boolean }[];
  explanation: string;
  mismatch: { officialGenerationId: string; observedGenerationId: string; marker: string; explanation: string } | null;
}

const ym = (d: string) => d.slice(0, 7);
const inRange = (g: Generation, d: string) => {
  const { from, to } = g.gradingDateRange;
  const v = ym(d);
  return (!from || ym(from) <= v) && (!to || v <= ym(to));
};

function markerSeen(m: Marker, ev: EraEvidence["observed"]) {
  switch (m.kind) {
    case "code_present": return ev.codes.length > 0;
    case "qr_domain": return ev.codes.some((c) => c.data.toLowerCase().includes((m.value ?? "").toLowerCase()));
    case "label_text": return ev.ocrText.join(" ").toUpperCase().includes((m.value ?? "").toUpperCase());
    case "tilt_change": return ev.tiltChange;
    case "backlit_change": return ev.backlitChange;
  }
}

const numericCompare = (a: string, b: string) => (/^\d+$/.test(a) && /^\d+$/.test(b) ? BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0 : a.localeCompare(b));

export function resolveEra(lib: CompiledLibrary, graderId: string | null, category: string | null, ev: EraEvidence): EraResolution {
  const candidates = graderId ? lib.generationsFor(graderId, category) : [];
  const base = { candidates, markersObserved: [] as EraResolution["markersObserved"], mismatch: null as EraResolution["mismatch"] };
  if (!candidates.length)
    return { ...base, generation: null, basis: "unknown", confidence: "none", inferred: false, gradingPeriod: null, explanation: graderId ? "No holder generations are documented for this grader and category yet." : "Grader not identified." };

  for (const g of candidates) for (const m of g.visualMarkers) if (markerSeen(m, ev.observed)) base.markersObserved.push({ generationId: g.id, marker: m.id, exclusive: m.exclusive });

  // ---- 1-3: official evidence
  let official: { gen: Generation; basis: EraBasis; confidence: EraResolution["confidence"]; period: EraResolution["gradingPeriod"]; why: string } | null = null;
  if (ev.gradingDate) {
    const gen = candidates.find((g) => inRange(g, ev.gradingDate!));
    if (gen) official = { gen, basis: "official_grading_date", confidence: gen.gradingDateRange.status === "confirmed_official" ? "high" : "medium", period: { from: ym(ev.gradingDate), to: ym(ev.gradingDate) }, why: `The grader's record dates the grading to ${ym(ev.gradingDate)}.` };
  }
  if (!official && ev.labelType) {
    const lt = ev.labelType.trim().toLowerCase();
    const gen = candidates.find((g) => g.officialLabelTypes.some((x) => x.toLowerCase() === lt));
    if (gen) official = { gen, basis: "official_label_type", confidence: gen.status === "confirmed_official" ? "high" : "medium", period: { from: gen.gradingDateRange.from, to: gen.gradingDateRange.to }, why: `The grader's record lists the label type "${ev.labelType}", which identifies the current holder.` };
  }
  if (!official && ev.certNumber && graderId) {
    const r = lib.data.certRanges.find((c) => c.graderId === graderId && numericCompare(ev.certNumber!, c.from) >= 0 && numericCompare(ev.certNumber!, c.to) <= 0);
    const gen = r && candidates.find((g) => inRange(g, r.gradedFrom) || inRange(g, r.gradedTo));
    if (r && gen) official = { gen, basis: "verified_cert_range", confidence: "medium", period: { from: r.gradedFrom, to: r.gradedTo }, why: `Verified cert-number data places grading between ${r.gradedFrom} and ${r.gradedTo}.` };
  }

  if (official) {
    // Era mismatch: an exclusive marker of a generation that began after the official one ended.
    for (const seen of base.markersObserved.filter((m) => m.exclusive && m.generationId !== official!.gen.id)) {
      const later = candidates.find((g) => g.id === seen.generationId)!;
      const offTo = official.gen.gradingDateRange.to, laterFrom = later.gradingDateRange.from;
      if (offTo && laterFrom && ym(offTo) <= ym(laterFrom)) {
        base.mismatch = {
          officialGenerationId: official.gen.id, observedGenerationId: later.id, marker: seen.marker,
          explanation: `Official data points to "${official.gen.name}" (graded up to ${offTo}), but the slab shows a feature that only exists from "${later.name}" (${laterFrom}) onward.`,
        };
        break;
      }
    }
    return { ...base, generation: official.gen, basis: official.basis, confidence: official.confidence, inferred: false, gradingPeriod: official.period, explanation: official.why };
  }

  // ---- 4: visual inference (stated as inferred; confidence stays low)
  const exclusiveGens = [...new Set(base.markersObserved.filter((m) => m.exclusive).map((m) => m.generationId))];
  if (exclusiveGens.length === 1) {
    const gen = candidates.find((g) => g.id === exclusiveGens[0])!;
    return { ...base, generation: gen, basis: "visual_inference", confidence: "low", inferred: true, gradingPeriod: { from: gen.gradingDateRange.from, to: gen.gradingDateRange.to },
      explanation: `No official grading date or label type was available, so the holder generation was inferred from visible features ("${gen.name}"). Treat as an estimate.` };
  }
  if (candidates.length === 1) {
    const gen = candidates[0];
    return { ...base, generation: gen, basis: "only_known_generation", confidence: "low", inferred: true, gradingPeriod: { from: gen.gradingDateRange.from, to: gen.gradingDateRange.to },
      explanation: `Only one holder generation is documented for this grader ("${gen.name}"); grading era not confirmed.` };
  }
  return { ...base, generation: null, basis: "unknown", confidence: "none", inferred: false, gradingPeriod: null,
    explanation: "The grading era could not be determined from official data or visible features. Checks that only apply to newer holders are treated as not applicable." };
}

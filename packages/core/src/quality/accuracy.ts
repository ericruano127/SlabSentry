/**
 * Accuracy tracking against independently established ground truth (never against our own output).
 *
 * Outcome per labeled slab, from the report's overall assessment:
 *   counterfeit/altered + "no major conflicts"            → MISSED FAKE (false negative, costliest)
 *   counterfeit/altered + "additional verification"       → weak catch (counted, not a miss)
 *   counterfeit/altered + "high-risk inconsistencies"     → caught
 *   genuine + "high-risk inconsistencies"                  → FALSE FLAG (false positive)
 *   genuine + "additional verification"                    → over-cautious (counted, not a false flag)
 *   genuine + "no major conflicts"                         → correct clear
 *   any + "unable to assess"                               → abstained (tracked separately)
 * Weighted cost = missedFakeWeight × missed fakes + false flags.
 */
export type GroundTruth = "genuine" | "counterfeit" | "altered";
export interface LabeledOutcome {
  sessionId: string;
  truth: GroundTruth;
  assessment: string;
  category: string;
  grader: string | null;
  generation: string | null;
}

export interface GroupMetrics {
  n: number;
  fakes: number;
  genuine: number;
  missedFakes: number;
  weakCatches: number;
  caught: number;
  falseFlags: number;
  overCautious: number;
  correctClears: number;
  abstained: number;
  missedFakeRate: number | null; // missed / fakes
  falseFlagRate: number | null; // false flags / genuine
  weightedCost: number;
  weightedCostPerSample: number | null;
}

export interface AccuracyReport {
  missedFakeWeight: number;
  overall: GroupMetrics;
  byCategory: Record<string, GroupMetrics>;
  byGrader: Record<string, GroupMetrics>;
  byGeneration: Record<string, GroupMetrics>;
  smallSampleWarning: boolean;
}

function metrics(rows: LabeledOutcome[], w: number): GroupMetrics {
  const m = { n: rows.length, fakes: 0, genuine: 0, missedFakes: 0, weakCatches: 0, caught: 0, falseFlags: 0, overCautious: 0, correctClears: 0, abstained: 0 };
  for (const r of rows) {
    const fake = r.truth !== "genuine";
    fake ? m.fakes++ : m.genuine++;
    if (r.assessment === "unable_to_assess") { m.abstained++; continue; }
    if (fake) {
      if (r.assessment === "no_major_conflicts") m.missedFakes++;
      else if (r.assessment === "high_risk_inconsistencies") m.caught++;
      else m.weakCatches++;
    } else {
      if (r.assessment === "high_risk_inconsistencies") m.falseFlags++;
      else if (r.assessment === "no_major_conflicts") m.correctClears++;
      else m.overCautious++;
    }
  }
  const cost = w * m.missedFakes + m.falseFlags;
  return { ...m, missedFakeRate: m.fakes ? m.missedFakes / m.fakes : null, falseFlagRate: m.genuine ? m.falseFlags / m.genuine : null, weightedCost: cost, weightedCostPerSample: m.n ? cost / m.n : null };
}

const groupBy = (rows: LabeledOutcome[], key: (r: LabeledOutcome) => string, w: number) => {
  const g: Record<string, LabeledOutcome[]> = {};
  for (const r of rows) (g[key(r)] ??= []).push(r);
  return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, metrics(v, w)]));
};

export function evaluateAccuracy(rows: LabeledOutcome[], missedFakeWeight = 5): AccuracyReport {
  return {
    missedFakeWeight,
    overall: metrics(rows, missedFakeWeight),
    byCategory: groupBy(rows, (r) => r.category, missedFakeWeight),
    byGrader: groupBy(rows, (r) => r.grader ?? "unknown", missedFakeWeight),
    byGeneration: groupBy(rows, (r) => r.generation ?? "undetermined", missedFakeWeight),
    smallSampleWarning: rows.length < 100,
  };
}

/** Release gate: no regression in weighted cost, and no new missed fakes. */
export function compareAccuracy(before: AccuracyReport | null, after: AccuracyReport) {
  if (!before) return { pass: true, reasons: ["No previous accuracy baseline."] };
  const reasons: string[] = [];
  if (after.overall.missedFakes > before.overall.missedFakes) reasons.push(`Missed fakes increased from ${before.overall.missedFakes} to ${after.overall.missedFakes}.`);
  if (after.overall.weightedCost > before.overall.weightedCost) reasons.push(`Weighted cost increased from ${before.overall.weightedCost} to ${after.overall.weightedCost}.`);
  return { pass: reasons.length === 0, reasons: reasons.length ? reasons : ["No regression on the labeled set."] };
}

/**
 * Public patch notes must stay general ("improved detection for older PSA labels") and never reveal how
 * detection works. Flags technical terms, thresholds and measurements.
 */
const FORBIDDEN_PUBLIC = [
  /\bthreshold/i, /\bhamming\b/i, /\bp?hash\b/i, /\bsift\b/i, /\borb\b/i, /\bransac\b/i, /\bmagsac\b/i, /\bhomograph/i, /\banisotropy\b/i,
  /\bssim\b/i, /\bncc\b/i, /\bfft\b/i, /\blaplacian\b/i, /\bocr\b/i, /\bela\b|error[- ]level/i, /\bdescriptor/i, /\binlier/i, /\bmarker/i,
  /\bexclusive\b/i, /\bfingerprint/i, /\d+(\.\d+)?\s?(px|pixels?|%|°|degrees?)\b/i, /\b0\.\d+\b/, /\bregex|pattern\b/i, /\bweight(ed|s)?\b/i,
];
export function lintPublicNotes(text: string): string[] {
  return FORBIDDEN_PUBLIC.filter((re) => re.test(text)).map((re) => `Public notes mention "${text.match(re)![0]}", which may reveal how detection works. Keep public notes general; put details in the internal changelog.`);
}

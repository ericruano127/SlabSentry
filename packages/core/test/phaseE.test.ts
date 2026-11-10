import { describe, expect, it } from "vitest";
import { compareAccuracy, evaluateAccuracy, lintPublicNotes, type LabeledOutcome } from "../src";

const row = (truth: LabeledOutcome["truth"], assessment: string, o: Partial<LabeledOutcome> = {}): LabeledOutcome =>
  ({ sessionId: Math.random().toString(36), truth, assessment, category: "tcg", grader: "PSA", generation: "psa_lighthouse_label", ...o });

describe("accuracy tracking", () => {
  it("counts missed fakes and false flags, weighting missed fakes as costlier", () => {
    const r = evaluateAccuracy([
      row("counterfeit", "no_major_conflicts"), // missed
      row("counterfeit", "high_risk_inconsistencies"), // caught
      row("altered", "additional_verification_recommended"), // weak catch
      row("genuine", "high_risk_inconsistencies"), // false flag
      row("genuine", "no_major_conflicts"),
      row("genuine", "unable_to_assess", { grader: "CGC", category: "sports_cards" }),
    ], 5);
    expect(r.overall).toMatchObject({ n: 6, fakes: 3, genuine: 3, missedFakes: 1, caught: 1, weakCatches: 1, falseFlags: 1, correctClears: 1, abstained: 1, weightedCost: 6 });
    expect(r.overall.missedFakeRate).toBeCloseTo(1 / 3);
    expect(r.byGrader.CGC.abstained).toBe(1);
    expect(r.byCategory.sports_cards.n).toBe(1);
    expect(r.smallSampleWarning).toBe(true);
  });

  it("release gate blocks new missed fakes even if total cost falls", () => {
    const before = evaluateAccuracy([row("counterfeit", "high_risk_inconsistencies"), row("genuine", "high_risk_inconsistencies"), row("genuine", "high_risk_inconsistencies"), row("genuine", "high_risk_inconsistencies"), row("genuine", "high_risk_inconsistencies"), row("genuine", "high_risk_inconsistencies"), row("genuine", "high_risk_inconsistencies")]);
    const after = evaluateAccuracy([row("counterfeit", "no_major_conflicts"), row("genuine", "no_major_conflicts"), row("genuine", "no_major_conflicts"), row("genuine", "no_major_conflicts"), row("genuine", "no_major_conflicts"), row("genuine", "no_major_conflicts"), row("genuine", "no_major_conflicts")]);
    expect(after.overall.weightedCost).toBeLessThan(before.overall.weightedCost);
    const g = compareAccuracy(before, after);
    expect(g.pass).toBe(false);
    expect(g.reasons[0]).toMatch(/Missed fakes increased/);
    expect(compareAccuracy(after, after).pass).toBe(true);
  });
});

describe("public patch notes", () => {
  it("allows general wording and flags detection details", () => {
    expect(lintPublicNotes("Improved detection for older PSA labels. Clearer photo guidance.")).toEqual([]);
    const issues = lintPublicNotes("Lowered the pHash hamming threshold to 18 and tuned SIFT inliers; label colour cutoff now 0.35.");
    expect(issues.length).toBeGreaterThanOrEqual(4);
  });
});

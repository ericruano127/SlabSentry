import { describe, expect, it } from "vitest";
import plansJson from "../../../config/plans.json";
import {
  allowanceWindow, computeEntitlements, detectGrader, extractCertCandidates, officialLookupUrl, runEngine,
  subscriptionGrantsAccess, validatePlansConfig, type ComparisonResult, type EngineInput, type SubscriptionState,
} from "../src";

const plans = validatePlansConfig(plansJson).plans;
const q = { ok: true, score: 0.9, issues: [], metrics: {} };
const baseCmp = (over: Partial<ComparisonResult> = {}): ComparisonResult => ({
  designMatch: { status: "consistent", inliers: 240, inlierRatio: 0.6 },
  photoReuse: { hammingFull: 22, hammingCard: 20, nearIdentical: false },
  centering: { status: "consistent", edgeOffsetPct: 0.3 },
  localDifferences: { status: "consistent", flaggedRegions: [], glareMaskedPct: 2, comparableAreaPct: 90 },
  overlays: {}, toolVersion: "test", ...over,
});
const base = (over: Partial<EngineInput> = {}): EngineInput => ({
  mode: "in_hand", grader: "PSA", certNumber: "12345678", certSource: "qr", certUserConfirmed: true,
  record: { grader: "PSA", certNumber: "12345678", found: true, grade: "10", year: "1999", subject: "Charizard", verificationUrl: "https://www.psacard.com/cert/12345678", provenance: { source: "official_api", retrievedAt: "x" } },
  labelOcrText: ["1999 POKEMON GAME", "CHARIZARD", "GEM MT 10", "12345678"],
  images: [{ id: "a", role: "front", quality: q }, { id: "b", role: "back", quality: q }, { id: "c", role: "label_closeup", quality: q }],
  comparisons: [{ side: "front", referenceSource: "official_api", result: baseCmp() }],
  holder: { slabDetected: true, edgesVisible: { top: true, bottom: true, left: true, right: true }, edgeStraightness: { maxDeviationPct: 0.2, status: "consistent" }, codes: [{ type: "qr", data: "https://www.psacard.com/cert/12345678" }], ocrText: [], toolVersion: "t" },
  now: "2026-01-01T00:00:00Z", ...over,
});

describe("grader detection", () => {
  it("detects PSA from QR domain and extracts cert", () => {
    const codes = ["https://www.psacard.com/cert/87654321"];
    expect(detectGrader({ codes })[0].grader).toBe("PSA");
    expect(extractCertCandidates("PSA", { codes })[0]).toEqual({ value: "87654321", source: "qr" });
  });
  it("detects CGC from label text", () => expect(detectGrader({ ocrText: ["CGC CARDS", "PRISTINE 10"] })[0].grader).toBe("CGC"));
  it("builds official links", () => expect(officialLookupUrl("PSA", " 123 ")).toBe("https://www.psacard.com/cert/123"));
});

describe("risk engine", () => {
  it("no major conflicts when all layers agree", () => {
    const out = runEngine(base());
    expect(out.findings.filter((f) => f.severity !== "info")).toHaveLength(0);
    expect(out.assessment).toBe("no_major_conflicts");
  });
  it("flags different physical card when centering differs", () => {
    const out = runEngine(base({ comparisons: [{ side: "front", referenceSource: "official_api", result: baseCmp({ centering: { status: "potential_discrepancy", edgeOffsetPct: 4 } }) }] }));
    expect(out.findings.map((f) => f.pattern)).toContain("different_physical_card");
    expect(out.assessment).toBe("high_risk_inconsistencies");
  });
  it("flags cloning when design does not match", () => {
    const out = runEngine(base({ comparisons: [{ side: "front", referenceSource: "official_api", result: baseCmp({ designMatch: { status: "potential_discrepancy", inliers: 3, inlierRatio: 0.01 } }) }] }));
    expect(out.findings[0].pattern).toBe("cert_cloning_suspected");
  });
  it("user-supplied references never produce high severity", () => {
    const out = runEngine(base({ comparisons: [{ side: "front", referenceSource: "user_supplied_reference", result: baseCmp({ designMatch: { status: "potential_discrepancy", inliers: 3, inlierRatio: 0.01 } }) }] }));
    expect(out.findings.every((f) => f.severity !== "high")).toBe(true);
  });
  it("older holder without LightHouse is not a discrepancy", () => {
    const out = runEngine(base({ holder: { ...base().holder!, backlit: { status: "potential_discrepancy", luminanceDelta: 1 } } }));
    expect(out.observations.find((o) => o.id === "sec.psa_lighthouse")?.status).toBe("inconclusive");
  });
  it("QR mismatch flags possible label modification", () => {
    const out = runEngine(base({ holder: { ...base().holder!, codes: [{ type: "qr", data: "https://www.psacard.com/cert/99999999" }] } }));
    expect(out.findings.map((f) => f.pattern)).toContain("label_modification_possible");
  });
  it("UV features need a blacklight photo; without a verified template they stay inconclusive", () => {
    const none = runEngine(base({ grader: "CGC" }));
    expect(none.observations.find((o) => o.id === "sec.cgc_uv_ink")?.status).toBe("not_visible");
    expect(none.retakeRequests.map((r) => r.role)).toContain("uv");
    const noTpl = runEngine(base({ grader: "CGC", templates: { labelTemplateAvailable: false, uv: { status: "potential_discrepancy", templateCompared: false, note: "no fluorescence observed" } } }));
    expect(noTpl.observations.find((o) => o.id === "sec.cgc_uv_ink")?.status).toBe("inconclusive");
    const tpl = runEngine(base({ grader: "CGC", templates: { labelTemplateAvailable: false, uv: { status: "consistent", templateCompared: true } } }));
    expect(tpl.observations.find((o) => o.id === "sec.cgc_uv_ink")?.status).toBe("consistent");
  });
  it("unable to assess without usable front", () => {
    const out = runEngine(base({ images: [], comparisons: [], record: null }));
    expect(out.assessment).toBe("unable_to_assess");
  });
  it("online listing never reaches strong evidence", () => {
    expect(runEngine(base({ mode: "online_listing" })).evidenceQuality.level).not.toBe("strong");
  });
  it("in-hand screenshot of reference is flagged", () => {
    const out = runEngine(base({ comparisons: [{ side: "front", referenceSource: "official_api", result: baseCmp({ photoReuse: { hammingFull: 1, hammingCard: 0, nearIdentical: true } }) }] }));
    expect(out.findings.map((f) => f.pattern)).toContain("screenshot_of_reference");
  });
});

const sub = (o: Partial<SubscriptionState>): SubscriptionState => ({ id: "s", planId: "pro", provider: "stripe", status: "active", interval: "month", startedAt: "2026-01-31T10:00:00Z", currentPeriodEnd: "2026-03-03T10:00:00Z", cancelAtPeriodEnd: false, ...o });

describe("entitlements", () => {
  it("monthly windows clamp month-end anchors", () => {
    const w = allowanceWindow("2026-01-31T10:00:00Z", new Date("2026-02-28T12:00:00Z"));
    expect(w.start.toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-03-31T10:00:00.000Z");
  });
  it("annual subscription gets monthly windows", () => {
    const w = allowanceWindow("2026-05-15T00:00:00Z", new Date("2026-11-20T00:00:00Z"));
    expect([w.start.toISOString(), w.end.toISOString()]).toEqual(["2026-11-15T00:00:00.000Z", "2026-12-15T00:00:00.000Z"]);
  });
  it("canceled keeps access until period end, then free", () => {
    const s = sub({ status: "canceled" });
    expect(subscriptionGrantsAccess(s, new Date("2026-03-01T00:00:00Z"))).toBe(true);
    expect(computeEntitlements([s], plans, new Date("2026-03-04T00:00:00Z")).planId).toBe("free");
  });
  it("highest plan wins across providers (cross-device)", () => {
    const e = computeEntitlements([sub({}), sub({ id: "t", planId: "power", provider: "app_store" })], plans, new Date("2026-02-10T00:00:00Z"));
    expect(e.planId).toBe("power");
    expect(e.monthlyAllowance).toBe(100);
  });
  it("refunded grants nothing", () => {
    expect(computeEntitlements([sub({ status: "refunded" })], plans, new Date("2026-02-10T00:00:00Z")).planId).toBe("free");
  });
});

describe("phase 2 rules", () => {
  const fp = (o: Partial<NonNullable<ComparisonResult["fingerprint"]>> = {}) => ({
    lowResolution: false,
    marks: { status: "consistent" as const, unmatched: 0 },
    edgeProfile: { status: "consistent" as const, correlation: 0.8 },
    registration: { status: "consistent" as const, deltaPx: 0.2 },
    ...o,
  });
  const run = (r: Partial<ComparisonResult>, src: "official_api" | "user_supplied_reference" = "official_api", over: Partial<EngineInput> = {}) =>
    runEngine(base({ comparisons: [{ side: "front", referenceSource: src, result: baseCmp(r) }], ...over }));

  it("supports an exact physical match only with ≥2 agreeing copy-level signals", () => {
    expect(run({ fingerprint: fp() }).physicalMatch[0].verdict).toBe("supported");
    // design + centering alone (no fingerprint) is not enough
    expect(run({}).physicalMatch[0].verdict).toBe("not_established");
  });

  it("identical artwork never implies a physical match", () => {
    const pm = run({ centering: { status: "inconclusive" }, fingerprint: fp({ marks: { status: "inconclusive" }, edgeProfile: { status: "inconclusive" } }) }).physicalMatch[0];
    expect(pm.verdict).toBe("not_established");
    expect(pm.summary).toMatch(/not established/);
  });

  it("unique marks alone: conflicting, but moderate severity", () => {
    const out = run({ fingerprint: fp({ marks: { status: "potential_discrepancy", unmatched: 5 } }) });
    expect(out.physicalMatch[0].verdict).toBe("conflicting");
    const f = out.findings.find((x) => x.pattern === "different_physical_card")!;
    expect(f.severity).toBe("medium");
    expect(f.legitimateExplanations.join()).toMatch(/Dust/);
    expect(run({ fingerprint: fp({ marks: { status: "potential_discrepancy" } }) }, "user_supplied_reference").findings.find((x) => x.pattern === "different_physical_card")!.severity).toBe("low");
  });

  it("two strong conflicts with official images are high risk", () => {
    const out = run({ fingerprint: fp({ marks: { status: "potential_discrepancy" }, edgeProfile: { status: "potential_discrepancy" } }) });
    expect(out.assessment).toBe("high_risk_inconsistencies");
  });

  it("registration alone (weak signal) does not create a conflict", () => {
    const out = run({ fingerprint: fp({ registration: { status: "potential_discrepancy", deltaPx: 3 } }) });
    expect(out.physicalMatch[0].verdict).not.toBe("conflicting");
    expect(out.findings.some((f) => f.pattern === "different_physical_card")).toBe(false);
  });

  it("label differing from the official image's label flags a label swap", () => {
    const out = run({ labelComparison: { status: "potential_discrepancy", certConflict: true } });
    const f = out.findings.find((x) => x.pattern === "label_modification_possible")!;
    expect(f.severity).toBe("high");
  });

  it("near-duplicate photos don't add evidence and trigger a retake request", () => {
    const qh = (h: string) => ({ ...q, metrics: { phash: h } });
    const out = runEngine(base({ images: [{ id: "a", role: "front", quality: qh("ffff0000ffff0000") }, { id: "b", role: "back", quality: qh("ffff0000ffff0001") }] }));
    expect(out.duplicates).toEqual([{ id: "b", role: "back", duplicateOf: "front" }]);
    expect(out.retakeRequests[0].role).toBe("back");
    expect(out.evidenceQuality.reasons.join()).toMatch(/near-duplicates/);
  });

  it("asks for specific retakes for glare and low resolution", () => {
    const out = run({ localDifferences: { status: "inconclusive", flaggedRegions: [], glareMaskedPct: 20, comparableAreaPct: 30 }, fingerprint: fp({ lowResolution: true, marks: { status: "inconclusive" } }) });
    const reasons = out.retakeRequests.map((r) => r.reason).join(" | ");
    expect(reasons).toMatch(/Glare hid 20%/);
    expect(reasons).toMatch(/too small/);
    expect(out.retakeRequests.every((r) => r.guidance.length > 10)).toBe(true);
  });

  it("edge anomalies are surfaced for review but never as a discrepancy", () => {
    const out = runEngine(base({ edgeReviews: [{ imageId: "e1", status: "inconclusive", anomalies: 2, regions: [] }] }));
    const o = out.observations.find((x) => x.id === "tamper.edge.0")!;
    expect(o.status).toBe("inconclusive");
    expect(out.findings.some((f) => f.pattern === "case_alteration_possible")).toBe(false);
  });
});

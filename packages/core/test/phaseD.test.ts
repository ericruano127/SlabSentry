import { describe, expect, it } from "vitest";
import { buildReport, runEngine, type EngineInput } from "../src";

const ok = { ok: true, score: 1, issues: [], metrics: { sharpness: 300, glareFrac: 0.01 } };
const base = (o: Partial<EngineInput> = {}): EngineInput => ({
  mode: "in_hand", grader: "PSA", certNumber: "12345678", certSource: "qr", certUserConfirmed: true,
  record: { grader: "PSA", certNumber: "12345678", found: true, grade: "10", verificationUrl: "x", provenance: { source: "official_api", retrievedAt: "x" } },
  labelOcrText: ["GEM MT 10"], images: [{ id: "f", role: "front", quality: ok }, { id: "b", role: "back", quality: ok }], comparisons: [],
  holder: { slabDetected: true, edgesVisible: { top: true, bottom: true, left: true, right: true }, edgeStraightness: { maxDeviationPct: 0.1, status: "consistent" }, codes: [{ type: "qr", data: "https://www.psacard.com/cert/12345678" }], ocrText: [], toolVersion: "t" },
  now: "2026-11-10T00:00:00Z", ...o,
});
const report = (o: Partial<EngineInput> = {}) => { const i = base(o); return buildReport("s", i, runEngine(i)); };

describe("quick summary", () => {
  it("puts official facts under 'verified' and unseen features under 'can't see'", () => {
    const r = report();
    expect(r.quickSummary.verified).toContain("Official record found");
    expect(r.quickSummary.cantSee.length).toBeGreaterThan(0);
    expect(r.quickSummary.headline).toMatch(/couldn't be checked from these photos/);
    expect(r.quickSummary.askNext.length).toBeGreaterThan(0);
  });
  it("lists findings under 'looks inconsistent', most severe first, and recommends a deep check", () => {
    const r = report({ record: { grader: "PSA", certNumber: "12345678", found: false, verificationUrl: "x", provenance: { source: "official_api", retrievedAt: "x" } },
      holder: { ...base().holder!, codes: [{ type: "qr", data: "https://www.psacard.com/cert/99999999" }] } });
    expect(r.quickSummary.inconsistent[0].severity).toBe("high");
    expect(r.quickSummary.inconsistent.length).toBeGreaterThanOrEqual(2);
    expect(r.quickSummary.deepCheckRecommended).toBe(true);
  });
  it("online listings phrase next steps as questions for the seller and note possession can't be shown", () => {
    const r = report({ mode: "online_listing", images: [{ id: "f", role: "front", quality: ok }] });
    expect(r.quickSummary.askNext[0]).toMatch(/^Ask the seller for:/);
    expect(r.quickSummary.cantSee).toContain("Whether the seller actually has this slab");
  });
});

describe("per-photo quality table", () => {
  it("shows each photo's score, issues, duplicates and the checks it limited", () => {
    const blurry = { ok: false, score: 0.4, issues: [{ issue: "motion_blur" as const, severity: "major" as const, guidance: "hold still" }], metrics: { sharpness: 30, phash: "ffff0000ffff0000" } };
    const r = report({ images: [{ id: "f", role: "front", quality: { ...ok, metrics: { ...ok.metrics, phash: "ffff0000ffff0000" } } }, { id: "b", role: "back", quality: blurry }],
      comparisons: [{ side: "front", referenceSource: "official_api", result: { designMatch: { status: "inconclusive", inliers: 3, inlierRatio: 0.01 }, photoReuse: { hammingFull: 20, hammingCard: 20, nearIdentical: false }, centering: { status: "inconclusive" }, localDifferences: { status: "inconclusive", flaggedRegions: [], glareMaskedPct: 30, comparableAreaPct: 20 }, overlays: {}, toolVersion: "t" } }] });
    const front = r.imageQuality.find((x) => x.role === "front")!;
    expect(front.limits.join()).toMatch(/same card design/);
    const back = r.imageQuality.find((x) => x.role === "back")!;
    expect(back.duplicateOf).toBe("front"); // identical hash → not counted
    expect(back.issues[0].issue).toBe("motion_blur");
    expect(Object.keys(front.metrics)).not.toContain("phash"); // only display metrics
  });
});

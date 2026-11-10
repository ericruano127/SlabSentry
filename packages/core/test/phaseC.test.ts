import { describe, expect, it } from "vitest";
import { computeMarketValue, runEngine, type Comp, type EngineInput } from "../src";

const q = { ok: true, score: 1, issues: [], metrics: {} };
const input = (o: Partial<EngineInput> = {}): EngineInput => ({
  mode: "in_hand", grader: "PSA", certNumber: "12345678", certSource: "user", certUserConfirmed: true,
  record: { grader: "PSA", certNumber: "12345678", found: true, grade: "10", year: "1999", brand: "POKEMON GAME", subject: "CHARIZARD", cardNumber: "4", verificationUrl: "x", labelType: "Hologram", provenance: { source: "official_api", retrievedAt: "x" } },
  labelOcrText: ["1999 POKEMON GAME", "CHARIZARD", "GEM MT 10", "#4", "12345678"],
  images: [{ id: "f", role: "front", quality: q }, { id: "b", role: "back", quality: q }], comparisons: [], holder: null, now: "2026-11-10T00:00:00Z", ...o,
});
const obs = (o: ReturnType<typeof runEngine>, id: string) => o.observations.find((x) => x.id === id);
const comp = (p: number, daysAgo: number, source = "user"): Comp => ({ priceCents: p, currency: "USD", soldAt: new Date(Date.parse("2026-11-10") - daysAgo * 864e5).toISOString(), source });

describe("set cross-check", () => {
  it("set name from the official record is checked against the label", () => {
    expect(obs(runEngine(input()), "identity.label_vs_record")?.status).toBe("consistent");
    const out = runEngine(input({ labelOcrText: ["1999", "CHARIZARD", "GEM MT 10", "#4"] }));
    expect(obs(out, "identity.label_vs_record")?.detail).toMatch(/set/);
  });
});

describe("image integrity", () => {
  it("editing software and duplicated regions are review items; a duplicated region on the front is a low finding", () => {
    const out = runEngine(input({ integrity: [{ imageId: "f", role: "front", metadata: { editorDetected: true, software: "Adobe Photoshop 25.0", hadCameraMakeModel: false },
      forensics: { recompression: { status: "consistent" }, copyMove: { status: "inconclusive", regions: [{ x: 0.1, y: 0.1, w: 0.1, h: 0.1 }] } } }] }));
    expect(obs(out, "integrity.f.software")?.status).toBe("inconclusive");
    const f = out.findings.find((x) => x.pattern === "image_edit_indicators")!;
    expect(f.severity).toBe("low");
    expect(out.assessment).not.toBe("high_risk_inconsistencies");
  });
  it("live in-app capture strengthens evidence quality; it is not claimed as proof", () => {
    const base = runEngine(input()).evidenceQuality;
    const live = runEngine(input({ integrity: [{ imageId: "f", role: "front", liveCapture: true }] }));
    expect(obs(live, "capture.live")?.detail).toMatch(/can't rule out/);
    const rank = ["insufficient", "limited", "moderate", "strong"];
    expect(rank.indexOf(live.evidenceQuality.level)).toBeGreaterThanOrEqual(rank.indexOf(base.level));
  });
});

describe("label templates & proportions", () => {
  it("without a verified template, layout is inconclusive (never guessed)", () => {
    expect(obs(runEngine(input()), "holder.label_layout")?.status).toBe("inconclusive");
  });
  it("template mismatch on layout and colour is a medium finding with innocent explanations", () => {
    const out = runEngine(input({ templates: { labelTemplateAvailable: true, label: { status: "measured", layout: { score: 0.1, status: "potential_discrepancy" }, colour: { score: 0.05, status: "potential_discrepancy" } } } }));
    const f = out.findings.find((x) => x.id === "f.label_template")!;
    expect(f.severity).toBe("medium");
    expect(f.legitimateExplanations.join()).toMatch(/Lighting/);
  });
});

describe("cloned certificate sightings", () => {
  it("same cert on visually different items is flagged; same item seen again is fine", () => {
    const one = runEngine(input({ certSightings: { otherSessions: 3, visuallyDifferent: 1, comparable: 3 } }));
    expect(one.findings.find((x) => x.id === "f.cert_clone_sightings")?.severity).toBe("medium");
    const two = runEngine(input({ certSightings: { otherSessions: 3, visuallyDifferent: 2, comparable: 3 } }));
    expect(two.assessment).toBe("high_risk_inconsistencies");
    const same = runEngine(input({ certSightings: { otherSessions: 2, visuallyDifferent: 0, comparable: 2 } }));
    expect(obs(same, "cert.sightings")?.status).toBe("consistent");
    expect(same.findings.some((x) => x.pattern === "cert_cloning_suspected")).toBe(false);
  });
});

describe("fair market value", () => {
  it("median of recent comps with outlier removal, range and confidence", () => {
    const mv = computeMarketValue([comp(100000, 5), comp(105000, 10), comp(98000, 20), comp(102000, 30), comp(990000, 3), comp(20000, 200)], { gradeLabel: "PSA 10", now: "2026-11-10T00:00:00Z" });
    expect(mv.status).toBe("estimated");
    expect(mv.estimateCents).toBe(101000);
    expect([mv.compsUsed, mv.compsExcluded]).toEqual([4, 1]); // 990000 outlier removed, 200-day-old sale outside window
    expect(mv.confidence).toBe("medium");
    expect(mv.note).toMatch(/Assumes the item is genuine/);
  });
  it("falls back to a price guide, then to 'insufficient data'", () => {
    expect(computeMarketValue([], { guide: { priceCents: 5000, currency: "USD", source: "pricecharting" } }).status).toBe("guide_only");
    expect(computeMarketValue([]).status).toBe("insufficient_data");
  });
  it("a listing priced far below FMV is a low-severity note; FMV never changes other findings", () => {
    const mv = computeMarketValue([comp(100000, 5), comp(100000, 6), comp(100000, 7)], { now: "2026-11-10T00:00:00Z" });
    const cheap = runEngine(input({ mode: "online_listing", market: { value: mv, askingPriceCents: 30000 } }));
    expect(cheap.findings.find((f) => f.pattern === "price_anomaly")?.severity).toBe("low");
    const fair = runEngine(input({ mode: "online_listing", market: { value: mv, askingPriceCents: 95000 } }));
    expect(fair.findings.some((f) => f.pattern === "price_anomaly")).toBe(false);
    const without = runEngine(input({ mode: "online_listing" }));
    expect(fair.assessment).toBe(without.assessment);
  });
});

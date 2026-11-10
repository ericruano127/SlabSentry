import { describe, expect, it } from "vitest";
import {
  canonicalJson, compileLibrary, DEFAULT_LIBRARY, defaultLibrary, detectGrader, LibrarySchema, resolveEra, runEngine,
  type EngineInput, type LibraryData,
} from "../src";

const q = { ok: true, score: 1, issues: [], metrics: {} };
const holder = (o: Partial<NonNullable<EngineInput["holder"]>> = {}): NonNullable<EngineInput["holder"]> => ({
  slabDetected: true, edgesVisible: { top: true, bottom: true, left: true, right: true }, edgeStraightness: { maxDeviationPct: 0.2, status: "consistent" },
  codes: [], ocrText: [], toolVersion: "t", ...o,
});
const input = (o: Partial<EngineInput> = {}, rec: Record<string, unknown> = {}): EngineInput => ({
  mode: "in_hand", grader: "PSA", certNumber: "12345678", certSource: "user", certUserConfirmed: true,
  record: { grader: "PSA", certNumber: "12345678", found: true, grade: "9", year: "1952", subject: "Mantle", verificationUrl: "x", provenance: { source: "official_api", retrievedAt: "x" }, ...rec },
  labelOcrText: [], images: [{ id: "a", role: "front", quality: q }], comparisons: [], holder: holder(), now: "2026-01-01T00:00:00Z", ...o,
});
const obs = (out: ReturnType<typeof runEngine>, id: string) => out.observations.find((x) => x.id === id);

/** Test library with verified dated generations (the seed has few confirmed dates). */
function datedLibrary(extra: Partial<LibraryData> = {}) {
  const d: LibraryData = JSON.parse(JSON.stringify(DEFAULT_LIBRARY));
  d.generations = d.generations.filter((g) => g.graderId !== "PSA");
  const gen = (id: string, from: string | null, to: string | null, features: string[], markers: any[] = []) => ({
    id, graderId: "PSA", categories: ["sports_cards", "tcg"], name: id, gradingDateRange: { from, to, status: "confirmed_official" as const },
    officialLabelTypes: [], labelStructure: "", features, visualMarkers: markers, notes: [], status: "confirmed_official" as const, sources: [],
  });
  d.generations.push(gen("psa_1990s", "1991-01", "2017-06", ["psa_sonic_weld", "generic_case_integrity"]));
  d.generations.push(gen("psa_2017", "2017-06", null, ["psa_lighthouse", "psa_sonic_weld", "generic_case_integrity"], [{ id: "lh", kind: "backlit_change", exclusive: true, status: "confirmed_official" }]));
  Object.assign(d, extra);
  return compileLibrary(d, { version: "test", sha256: null });
}

describe("era-aware verification", () => {
  it("never uses the item's year: a 1952 card and a 2021 card with the same slab evidence get the same era and checks", () => {
    const a = runEngine(input({}, { year: "1952", labelType: "Hologram" }));
    const b = runEngine(input({}, { year: "2021", labelType: "Hologram" }));
    expect(a.era?.generation?.id).toBe(b.era?.generation?.id);
    const statuses = (o: typeof a) => o.observations.filter((x) => x.category === "security_feature").map((x) => `${x.id}:${x.status}`).sort();
    expect(statuses(a)).toEqual(statuses(b));
  });

  it("a 1952 card graded in 2024 is checked against the 2024-era holder", () => {
    const out = runEngine(input({ library: datedLibrary() }, { year: "1952", gradingDate: "2024-03-10" }));
    expect([out.era?.generation?.id, out.era?.basis, out.era?.confidence]).toEqual(["psa_2017", "official_grading_date", "high"]);
    expect(obs(out, "holder.era")?.status).toBe("consistent");
  });

  it("official label type identifies the current holder (reholders included)", () => {
    const out = runEngine(input({}, { labelType: "PSA Fugitive Ink Technology" }));
    expect([out.era?.generation?.id, out.era?.basis]).toEqual(["psa_fugitive_ink_label", "official_label_type"]);
    expect(out.era?.confidence).toBe("medium"); // generation itself still 'research_needed'
  });

  it("older slabs are never flagged for lacking newer features", () => {
    const out = runEngine(input({ holder: holder({ backlit: { status: "inconclusive", luminanceDelta: 2 } }) }, { labelType: "Hologram" }));
    expect(out.era?.generation?.id).toBe("psa_pre_lighthouse");
    expect(obs(out, "sec.psa_lighthouse")?.status).toBe("not_applicable");
    expect(out.findings.some((f) => f.pattern === "era_mismatch")).toBe(false);
  });

  it("flags an era mismatch when a later-era feature appears on a slab whose official era predates it", () => {
    const out = runEngine(input({ library: datedLibrary(), holder: holder({ backlit: { status: "consistent", luminanceDelta: 40 } }) }, { gradingDate: "2010-05" }));
    expect(out.era?.generation?.id).toBe("psa_1990s");
    expect(out.era?.mismatch?.observedGenerationId).toBe("psa_2017");
    expect(obs(out, "holder.era")?.status).toBe("potential_discrepancy");
    const f = out.findings.find((x) => x.pattern === "era_mismatch")!;
    expect(f.severity).toBe("medium");
    expect(f.legitimateExplanations.join()).toMatch(/reholdered/);
  });

  it("without official data the era is inferred from visual traits, stated as inferred, low confidence", () => {
    const out = runEngine(input({ library: datedLibrary(), holder: holder({ backlit: { status: "consistent", luminanceDelta: 40 } }) }));
    expect([out.era?.generation?.id, out.era?.basis, out.era?.inferred, out.era?.confidence]).toEqual(["psa_2017", "visual_inference", true, "low"]);
    expect(obs(out, "holder.era")?.status).toBe("inconclusive");
    expect(obs(out, "holder.era")?.detail).toMatch(/inferred/);
  });

  it("unknown era: no mismatch, newer-holder checks not counted against the slab", () => {
    const out = runEngine(input({ library: datedLibrary() }));
    expect([out.era?.basis, out.era?.generation]).toEqual(["unknown", null]);
    expect(out.findings.filter((f) => f.severity !== "info").length).toBe(0);
  });

  it("uses verified cert-number ranges only when present in the library", () => {
    const lib = datedLibrary({ certRanges: [{ graderId: "PSA", from: "10000000", to: "19999999", gradedFrom: "2005-01", gradedTo: "2008-12", source: "test", verified: true }] });
    const out = runEngine(input({ library: lib }));
    expect([out.era?.basis, out.era?.generation?.id]).toEqual(["verified_cert_range", "psa_1990s"]);
    expect(resolveEra(datedLibrary(), "PSA", "sports_cards", { certNumber: "12345678", observed: { codes: [], ocrText: [], tiltChange: false, backlitChange: false } }).basis).toBe("unknown");
  });
});

describe("data-driven library", () => {
  it("seed validates and covers every category with capture guidance", () => {
    const lib = defaultLibrary();
    expect(lib.data.categories.map((c) => c.id)).toEqual(["sports_cards", "tcg", "sealed_video_games", "comics_magazines", "figures", "other_collectibles"]);
    for (const c of lib.data.categories) expect(c.captureGuidance.front.length).toBeGreaterThan(10);
    expect(lib.gradersFor("sealed_video_games").map((g) => g.id)).toEqual(expect.arrayContaining(["WATA", "VGA", "CGC_GAMES"]));
  });

  it("rejects invalid releases (unknown references, bad patterns, duplicates, reversed dates)", () => {
    const bad = (mut: (d: LibraryData) => void) => { const d = JSON.parse(JSON.stringify(DEFAULT_LIBRARY)); mut(d); return LibrarySchema.safeParse(d).success; };
    expect(bad(() => {})).toBe(true);
    expect(bad((d) => d.generations[0].features.push("nope"))).toBe(false);
    expect(bad((d) => (d.graders[0].certPatterns[0].pattern = "(["))).toBe(false);
    expect(bad((d) => d.graders.push(d.graders[0]))).toBe(false);
    expect(bad((d) => (d.generations[0].gradingDateRange = { from: "2020-01", to: "2010-01", status: "research_needed" }))).toBe(false);
    expect(bad((d) => d.graders[0].categories.push("spaceships"))).toBe(false);
  });

  it("new graders and categories work without code changes", () => {
    const d: LibraryData = JSON.parse(JSON.stringify(DEFAULT_LIBRARY));
    d.graders.push({ ...d.graders[0], id: "NEWCO", name: "NewCo Grading", categories: ["figures"], labelTokens: ["NEWCO"], qrDomains: ["newco.example"], certPatterns: [{ category: null, pattern: "^NC\\d{6}$", verified: true }] });
    const lib = compileLibrary(d, { version: "t", sha256: null });
    expect(detectGrader({ codes: ["https://newco.example/c/NC123456"] }, lib, "figures")[0].grader).toBe("NEWCO");
    expect(detectGrader({ codes: ["https://newco.example/c/NC123456"] }, lib, "tcg")).toHaveLength(0); // scoped by category
  });

  it("category checks switch off copy fingerprinting where it hasn't been validated", () => {
    const out = runEngine(input({ category: "sealed_video_games", grader: "WATA", record: null, comparisons: [{ side: "front", referenceSource: "user_supplied_reference", result: {
      designMatch: { status: "consistent", inliers: 100, inlierRatio: 0.5 }, photoReuse: { hammingFull: 20, hammingCard: 20, nearIdentical: false },
      centering: { status: "potential_discrepancy", edgeOffsetPct: 4 }, localDifferences: { status: "consistent", flaggedRegions: [], glareMaskedPct: 0, comparableAreaPct: 90 }, overlays: {}, toolVersion: "t" } }] }));
    expect(out.physicalMatch).toHaveLength(0);
    expect(out.findings.some((f) => f.pattern === "different_physical_card")).toBe(false);
    expect(out.category).toBe("sealed_video_games");
  });

  it("canonical JSON is key-order independent (stable release hashes)", () => {
    expect(canonicalJson({ b: 1, a: [{ y: 2, x: 1 }] })).toBe(canonicalJson({ a: [{ x: 1, y: 2 }], b: 1 }));
  });
});

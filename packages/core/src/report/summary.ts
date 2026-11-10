import type { EngineInput, EngineOutput } from "../risk/engine";
import type { QualityIssue } from "../types";

/**
 * One-screen summary for quick decisions (deterministic, no model involved):
 *   verified      — facts checked against official data, plus copy-level matches
 *   inconsistent  — risk findings, most severe first
 *   cantSee       — what these photos can't show
 *   askNext       — the most useful photo to take, or question to ask the seller
 */
export interface QuickSummary {
  headline: string;
  verified: string[];
  inconsistent: { text: string; severity: string }[];
  cantSee: string[];
  askNext: string[];
  deepCheckRecommended: boolean;
}

export function quickSummary(input: EngineInput, out: EngineOutput): QuickSummary {
  const o = out.observations;
  const verified = [
    ...o.filter((x) => x.status === "consistent" && x.basis === "fact" && x.category !== "market").map((x) => x.title),
    ...out.physicalMatch.filter((p) => p.verdict === "supported").map((p) => `Same physical card as the reference (${p.side}): ${p.matching.length} characteristics match`),
    ...o.filter((x) => x.status === "consistent" && x.basis === "inference" && ["cert.code_vs_print", "identity.label_vs_record"].includes(x.id)).map((x) => x.title),
  ];
  const sev = { high: 0, medium: 1, low: 2, info: 3 } as const;
  const inconsistent = out.findings.filter((f) => f.severity !== "info").sort((a, b) => sev[a.severity] - sev[b.severity]).map((f) => ({ text: f.summary, severity: f.severity }));
  const cantSee = [
    ...o.filter((x) => x.status === "not_visible").map((x) => x.title),
    ...o.filter((x) => x.status === "not_supported_by_device").map((x) => `${x.title} (needs special equipment or the grader)`),
    ...(input.mode === "online_listing" ? ["Whether the seller actually has this slab"] : []),
  ];
  const listing = input.mode === "online_listing";
  const askNext = [
    ...out.retakeRequests.slice(0, 3).map((r) => (listing ? `Ask the seller for: ${r.guidance.charAt(0).toLowerCase()}${r.guidance.slice(1)}` : r.guidance)),
    ...out.nextActions.slice(0, 1),
  ];
  const n = { bad: inconsistent.length, unseen: cantSee.length };
  const headline = `${out.assessment === "no_major_conflicts" ? "No major conflicts found" : out.assessment === "high_risk_inconsistencies" ? "High-risk inconsistencies found" : out.assessment === "unable_to_assess" ? "Not enough evidence to assess" : "Some things need a closer look"}` +
    ` — ${n.bad ? `${n.bad} thing${n.bad === 1 ? "" : "s"} look${n.bad === 1 ? "s" : ""} inconsistent` : "nothing looks inconsistent"}, ${n.unseen} couldn't be checked from these photos.`;
  return {
    headline,
    verified: dedupe(verified).slice(0, 4),
    inconsistent: inconsistent.slice(0, 4),
    cantSee: dedupe(cantSee).slice(0, 4),
    askNext: dedupe(askNext).slice(0, 3),
    deepCheckRecommended: out.assessment !== "no_major_conflicts" || out.retakeRequests.some((r) => r.priority <= 2),
  };
}

export interface ImageQualityRow {
  imageId: string;
  role: string;
  score: number;
  ok: boolean;
  issues: { issue: QualityIssue | string; severity: string; guidance: string }[];
  metrics: Record<string, number | boolean | string>;
  duplicateOf: string | null;
  limits: string[]; // checks this photo's quality left inconclusive
}

/** Per-photo quality, and which checks each photo's quality limited (via retake requests). */
export function imageQualityTable(input: EngineInput, out: EngineOutput): ImageQualityRow[] {
  const titleOf = (id: string) => out.observations.find((x) => x.id === id)?.title;
  return input.images.map((img) => {
    const dup = out.duplicates.find((d) => d.id === img.id);
    const limits = out.retakeRequests.filter((r) => r.role === img.role).flatMap((r) => r.resolves.map(titleOf)).filter((t): t is string => !!t);
    const keep = ["sharpness", "labelSharpness", "glareFrac", "width", "height", "angleDeviationDeg", "anisotropy"];
    return {
      imageId: img.id, role: img.role, score: img.quality?.score ?? 0, ok: !!img.quality?.ok,
      issues: img.quality?.issues ?? [], metrics: Object.fromEntries(Object.entries(img.quality?.metrics ?? {}).filter(([k]) => keep.includes(k))),
      duplicateOf: dup?.duplicateOf ?? null, limits: dedupe(limits),
    };
  });
}

const dedupe = (xs: string[]) => [...new Set(xs)];

import { officialLookupUrl } from "../graders/registry";
import { defaultLibrary } from "../library/runtime";
import { imageQualityTable, quickSummary, type ImageQualityRow, type QuickSummary } from "./summary";
import type { EngineInput, EngineOutput } from "../risk/engine";
import type { GraderId, OfficialCertRecord, OverallAssessment, VerificationMode } from "../types";

export const ASSESSMENT_LABELS: Record<OverallAssessment, { title: string; tone: "ok" | "warn" | "bad" | "muted" }> = {
  no_major_conflicts: { title: "No major conflicts detected", tone: "ok" },
  additional_verification_recommended: { title: "Additional verification recommended", tone: "warn" },
  high_risk_inconsistencies: { title: "High-risk inconsistencies detected", tone: "bad" },
  unable_to_assess: { title: "Unable to assess reliably", tone: "muted" },
};

export const REPORT_DISCLAIMER =
  "This report is a photographic screening based on the evidence listed. Photos alone cannot guarantee authenticity. " +
  "Findings are rule-based observations, not an authenticity probability. Confirm with the grading company for high-value decisions.";

export interface VerificationReport {
  version: 1;
  sessionId: string;
  generatedAt: string;
  mode: VerificationMode;
  identification: {
    grader: GraderId | null;
    graderName: string | null;
    certNumber: string | null;
    record: Pick<OfficialCertRecord, "year" | "brand" | "subject" | "cardNumber" | "variety" | "grade" | "description"> | null;
  };
  official: {
    recordStatus: "found" | "not_found" | "not_checked";
    lookupUrl: string | null;
    imageAvailability: "official_api" | "user_supplied" | "unavailable";
    source: string | null;
  };
  engine: EngineOutput;
  assessmentLabel: string;
  /** One-screen summary: verified / looks inconsistent / can't see / ask or photograph next. */
  quickSummary: QuickSummary;
  /** Per-photo quality and which checks it limited. */
  imageQuality: ImageQualityRow[];
  /** Deterministic plain-language interpretation of the evidence layers. */
  interpretation: string[];
  holderLibraryVersion: string;
  library: { version: string; sha256: string | null };
  category: string;
  /** Optional AI-written explanation; never changes findings or assessment. */
  narrative?: { text: string; source: "ai" | "template"; model?: string; generatedAt: string; analysisRun?: number };
  disclaimer: string;
}

/** Layer-by-layer reading of the evidence, written by rules (no model involved). */
export function interpret(input: EngineInput, out: EngineOutput): string[] {
  const lines: string[] = [];
  const r = input.record;
  if (r?.found) lines.push(`Certification: the grader's record for cert ${input.certNumber} was found${r.grade ? ` (grade ${r.grade})` : ""}. This confirms the number exists — not that this slab is the one it was issued to.`);
  else if (r?.found === false) lines.push(`Certification: no record was found for cert ${input.certNumber}.`);
  else lines.push("Certification: the official record was not checked automatically; confirm it on the grader's site.");
  for (const pm of out.physicalMatch) lines.push(pm.summary);
  if (!input.comparisons.length) lines.push("Reference comparison: no reference image was available, so the physical card could not be compared with the grader's imaging.");
  const holder = out.observations.filter((o) => o.category === "security_feature" || o.category === "tampering" || o.category === "holder");
  const bad = holder.filter((o) => o.status === "potential_discrepancy").length;
  const ok = holder.filter((o) => o.status === "consistent").length;
  lines.push(`Holder: ${ok} visible check(s) consistent with documented design, ${bad} potential discrepanc${bad === 1 ? "y" : "ies"}, ${holder.length - ok - bad} not assessable from photos.`);
  lines.push(`Evidence quality is ${out.evidenceQuality.level}${input.mode === "online_listing" ? "; seller photos cannot show possession or liveness" : ""}.`);
  return lines;
}

export function buildReport(sessionId: string, input: EngineInput, out: EngineOutput): VerificationReport {
  const r = input.record;
  return {
    version: 1,
    sessionId,
    generatedAt: input.now ?? new Date().toISOString(),
    mode: input.mode,
    identification: {
      grader: input.grader,
      graderName: input.grader ? (input.library ?? defaultLibrary()).grader(input.grader)?.name ?? input.grader : null,
      certNumber: input.certNumber,
      record: r?.found ? { year: r.year, brand: r.brand, subject: r.subject, cardNumber: r.cardNumber, variety: r.variety, grade: r.grade, description: r.description } : null,
    },
    official: {
      recordStatus: r?.found === true ? "found" : r?.found === false ? "not_found" : "not_checked",
      lookupUrl: input.grader && input.certNumber ? officialLookupUrl(input.grader, input.certNumber, input.library ?? defaultLibrary()) : null,
      imageAvailability: input.comparisons.some((c) => c.referenceSource === "official_api") ? "official_api" : input.comparisons.length ? "user_supplied" : "unavailable",
      source: r?.provenance.url ?? null,
    },
    engine: out,
    assessmentLabel: ASSESSMENT_LABELS[out.assessment].title,
    interpretation: interpret(input, out),
    quickSummary: quickSummary(input, out),
    imageQuality: imageQualityTable(input, out),
    holderLibraryVersion: out.library.version,
    library: out.library,
    category: out.category,
    disclaimer: REPORT_DISCLAIMER,
  };
}

/** Strip anything user-identifying for public share links. */
export function toShareable(report: VerificationReport): VerificationReport {
  return { ...report, sessionId: "shared" };
}

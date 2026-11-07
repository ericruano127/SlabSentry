import { GRADERS, officialLookupUrl } from "../graders/registry";
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
  disclaimer: string;
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
      graderName: input.grader ? GRADERS[input.grader].name : null,
      certNumber: input.certNumber,
      record: r?.found ? { year: r.year, brand: r.brand, subject: r.subject, cardNumber: r.cardNumber, variety: r.variety, grade: r.grade, description: r.description } : null,
    },
    official: {
      recordStatus: r?.found === true ? "found" : r?.found === false ? "not_found" : "not_checked",
      lookupUrl: input.grader && input.certNumber ? officialLookupUrl(input.grader, input.certNumber) : null,
      imageAvailability: input.comparisons.some((c) => c.referenceSource === "official_api") ? "official_api" : input.comparisons.length ? "user_supplied" : "unavailable",
      source: r?.provenance.url ?? null,
    },
    engine: out,
    assessmentLabel: ASSESSMENT_LABELS[out.assessment].title,
    disclaimer: REPORT_DISCLAIMER,
  };
}

/** Strip anything user-identifying for public share links. */
export function toShareable(report: VerificationReport): VerificationReport {
  return { ...report, sessionId: "shared" };
}

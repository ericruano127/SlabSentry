import Anthropic from "@anthropic-ai/sdk";
import type { VerificationReport } from "@slabguard/core";
import { env } from "../env";

/**
 * AI-assisted plain-language explanation of an existing report.
 *
 * Constraints (enforced in the prompt AND checked after generation):
 *  - input is the structured report only (no photos, no personal data);
 *  - the model explains; it never decides — it cannot change findings, severity or the
 *    overall assessment, and must not claim authenticity or counterfeiting;
 *  - any output that violates the rules is discarded in favour of the deterministic template.
 */
export const NARRATIVE_VERSION = "narrative-1";

const SYSTEM = `You explain graded trading-card slab verification reports to collectors in plain language.

You receive a JSON report produced by deterministic computer-vision checks and transparent rules. Your job is to explain it, not to re-judge it.

Rules:
- Use only facts present in the JSON. Do not add new observations, risks or numbers.
- Restate the overall assessment exactly as given in "assessmentLabel". Never upgrade or downgrade it.
- Never say or imply the card or slab is authentic, genuine, real, fake, counterfeit, or guaranteed. Photos cannot establish that; say what the evidence shows and what it cannot show.
- Distinguish verified facts (official record), visual inferences (photo analysis) and unresolved items.
- For each risk finding, mention the most likely innocent explanations listed with it.
- End with the single most useful next step from "nextActions".
- 120 to 220 words, short paragraphs, no headings, no markdown tables.`;

const FORBIDDEN = /\b(is|are|appears to be|looks|seems)\s+(definitely\s+|certainly\s+)?(authentic|genuine|real|legit(imate)?|fake|counterfeit|forged)\b|\bguarantee(d|s)?\b|\b100\s?%|\bdefinitely\b|\bcertainly\b/i;

export function evidenceForModel(r: VerificationReport) {
  const e = r.engine;
  return {
    mode: r.mode,
    assessmentLabel: r.assessmentLabel,
    evidenceQuality: e.evidenceQuality,
    identification: { grader: r.identification.graderName, record: r.identification.record },
    official: r.official,
    interpretation: r.interpretation,
    physicalMatch: e.physicalMatch,
    findings: e.findings.map((f) => ({ severity: f.severity, summary: f.summary, explanation: f.explanation, innocentExplanations: f.legitimateExplanations })),
    observations: e.observations.map((o) => ({ title: o.title, status: o.status, basis: o.basis, detail: o.detail })),
    nextActions: e.nextActions,
  };
}

export function templateNarrative(r: VerificationReport): string {
  const e = r.engine;
  const parts = [`Overall: ${r.assessmentLabel}. Evidence quality is ${e.evidenceQuality.level}.`, ...(r.interpretation ?? [])];
  for (const f of e.findings.filter((x) => x.severity !== "info").slice(0, 3))
    parts.push(`${f.summary}. ${f.legitimateExplanations.length ? `Possible innocent explanations: ${f.legitimateExplanations.slice(0, 2).join("; ")}.` : ""}`);
  if (e.nextActions[0]) parts.push(`Next step: ${e.nextActions[0]}`);
  return parts.join("\n\n");
}

export function validateNarrative(text: string, r: VerificationReport): string | null {
  if (!text || text.length < 80 || text.length > 3000) return "length";
  if (FORBIDDEN.test(text)) return "forbidden_claim";
  if (!text.toLowerCase().includes(r.assessmentLabel.toLowerCase().slice(0, 18))) return "assessment_not_restated";
  return null;
}

let client: Anthropic | null = null;

export async function generateNarrative(r: VerificationReport): Promise<{ text: string; source: "ai" | "template"; model?: string; costUsd: number; rejected?: string }> {
  if (!env.aiNarrativeEnabled) return { text: templateNarrative(r), source: "template", costUsd: 0 };
  client ??= new Anthropic({ maxRetries: 2, timeout: 60_000 });
  try {
    const res = await client.beta.messages.create({
      model: env.anthropicModel,
      max_tokens: 2000,
      // Server-side refusal fallback: a safety decline is retried on a fallback model in the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: [{ role: "user", content: `Explain this verification report:\n\n${JSON.stringify(evidenceForModel(r))}` }],
    });
    const costUsd = (res.usage.input_tokens * 4 + res.usage.output_tokens * 20) / 1e6;
    if (res.stop_reason === "refusal") return { text: templateNarrative(r), source: "template", costUsd, rejected: "refusal" };
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    const problem = validateNarrative(text, r);
    if (problem) return { text: templateNarrative(r), source: "template", costUsd, rejected: problem };
    return { text, source: "ai", model: res.model, costUsd };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.APIConnectionError || e instanceof Anthropic.InternalServerError) {
      return { text: templateNarrative(r), source: "template", costUsd: 0, rejected: "provider_unavailable" };
    }
    if (e instanceof Anthropic.APIError) {
      console.error("narrative API error", e.status, e.message);
      return { text: templateNarrative(r), source: "template", costUsd: 0, rejected: `api_error_${e.status}` };
    }
    throw e;
  }
}

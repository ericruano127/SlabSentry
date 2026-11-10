import { defaultLibrary, type CompiledLibrary } from "../library/runtime";
import type { GraderDef } from "../library/schema";
import type { GraderId } from "../types";

/**
 * Grader helpers over the data-driven reference library (see library/). Unverified cert patterns
 * are hints only — the user always confirms the certification number.
 */
export type GraderDefinition = GraderDef;

/** Built-in seed view, kept for code paths without a loaded library (tests, seeding). */
export const GRADERS: Record<string, GraderDef> = Object.fromEntries(defaultLibrary().data.graders.map((g) => [g.id, g]));

export function officialLookupUrl(grader: GraderId, cert: string, lib: CompiledLibrary = defaultLibrary()): string | null {
  const g = lib.grader(grader);
  if (!g) return null;
  const clean = encodeURIComponent(cert.trim());
  return g.lookupUrlTemplate ? g.lookupUrlTemplate.replace("{cert}", clean) : g.lookupBaseUrl;
}

export function normalizeCert(raw: string): string {
  return raw.replace(/[\s#]/g, "").replace(/^cert(no)?[:.]?/i, "").toUpperCase();
}

export interface GraderGuess {
  grader: GraderId;
  score: number;
  reasons: string[];
}

/** Rank graders (optionally within a category) from QR payloads and OCR text. Pure; deterministic. */
export function detectGrader(input: { codes?: string[]; ocrText?: string[] }, lib: CompiledLibrary = defaultLibrary(), category?: string | null): GraderGuess[] {
  const text = (input.ocrText ?? []).join(" ").toUpperCase();
  const words = new Set(text.split(/[^A-Z0-9]+/).filter(Boolean));
  const out: GraderGuess[] = [];
  for (const g of lib.gradersFor(category)) {
    let score = 0;
    const reasons: string[] = [];
    for (const code of input.codes ?? []) {
      const lc = code.toLowerCase();
      const d = g.qrDomains.find((d) => lc.includes(d));
      if (d) { score += 5; reasons.push(`Code links to ${d}`); }
    }
    for (const t of g.labelTokens) {
      if (words.has(t)) { score += t.length <= 3 ? 1.5 : 2.5; reasons.push(`Label text contains "${t}"`); }
    }
    if (score > 0) out.push({ grader: g.id, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Candidate cert numbers from QR payloads (preferred) and OCR text. */
export function extractCertCandidates(grader: GraderId | null, input: { codes?: string[]; ocrText?: string[] }, lib: CompiledLibrary = defaultLibrary(), category?: string | null): {
  value: string;
  source: "qr" | "barcode" | "ocr";
}[] {
  const seen = new Set<string>();
  const out: { value: string; source: "qr" | "barcode" | "ocr" }[] = [];
  const patterns = grader ? lib.certPatterns(grader, category) : [/^\d{7,13}$/];
  const push = (v: string, source: "qr" | "barcode" | "ocr") => {
    const n = normalizeCert(v);
    if ((patterns.length ? patterns : [/^\d{7,13}$/]).some((p) => p.test(n)) && !seen.has(n)) {
      seen.add(n);
      out.push({ value: n, source });
    }
  };
  for (const code of input.codes ?? []) {
    const m = code.match(/cert(?:lookup)?\/?(?:[#=/]|%2F)?\s*([A-Za-z0-9-]{5,14})/i) ?? code.match(/(\d{7,13})/);
    if (m) push(m[1], /^https?:/i.test(code) ? "qr" : "barcode");
    else push(code, "barcode");
  }
  for (const line of input.ocrText ?? []) {
    for (const tok of line.split(/\s+/)) {
      if (/\d{6,}/.test(tok)) push(tok.replace(/[^A-Za-z0-9-]/g, ""), "ocr");
    }
  }
  return out;
}

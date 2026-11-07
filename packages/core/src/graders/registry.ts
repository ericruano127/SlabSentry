import type { GraderId } from "../types";

/**
 * Grader registry. `verified` flags distinguish facts confirmed from official
 * sources (see docs/RESEARCH_MATRIX.md) from working assumptions that still
 * need confirmation. Unverified patterns are only used as hints — the user
 * always confirms the certification number.
 */
export interface GraderDefinition {
  id: GraderId;
  name: string;
  priority: 1 | 2 | 3; // implementation priority
  lookupBaseUrl: string;
  /** Deep-link template when the grader supports one; {cert} placeholder. */
  lookupUrlTemplate?: string;
  lookupTemplateVerified: boolean;
  certPattern: RegExp;
  certPatternVerified: boolean;
  /** Text tokens likely printed on the label (used for grader auto-detection). */
  labelTokens: string[];
  qrDomains: string[];
  /** Programmatic access we know is permitted. */
  api: { available: boolean; requiresCredential?: string; notes: string };
  officialImagery: { status: "api" | "public_page" | "unknown"; notes: string };
  specializedChecks: string[]; // things the user should do outside the app
}

export const GRADERS: Record<GraderId, GraderDefinition> = {
  PSA: {
    id: "PSA",
    name: "PSA (Professional Sports Authenticator)",
    priority: 1,
    lookupBaseUrl: "https://www.psacard.com/cert",
    lookupUrlTemplate: "https://www.psacard.com/cert/{cert}",
    lookupTemplateVerified: true,
    certPattern: /^\d{7,10}$/,
    certPatternVerified: false,
    labelTokens: ["PSA", "PSACARD"],
    qrDomains: ["psacard.com", "psa.cards"],
    api: {
      available: true,
      requiresCredential: "PSA_API_TOKEN",
      notes:
        "PSA Public API (https://api.psacard.com/publicapi/) — bearer token from a PSA account; cert/GetByCertNumber and cert/GetImagesByCertNumber; free tier limited to 100 calls/day.",
    },
    officialImagery: {
      status: "api",
      notes:
        "Front/back imaging expanded across service levels for submissions received from 2022-12-15; some earlier certs have images. Availability is per-cert and must be checked, never assumed.",
    },
    specializedChecks: [
      "Compare the slab in hand with the images on PSA's cert page.",
      "PSA documents a LightHouse label logo with an on/off illumination effect — backlight the label and observe.",
      "UV-dependent features cannot be validated with an ordinary phone camera.",
    ],
  },
  CGC: {
    id: "CGC",
    name: "CGC Cards",
    priority: 1,
    lookupBaseUrl: "https://www.cgccards.com/certlookup/",
    lookupUrlTemplate: "https://www.cgccards.com/certlookup/{cert}/",
    lookupTemplateVerified: false,
    certPattern: /^\d{7,13}$/,
    certPatternVerified: false,
    labelTokens: ["CGC", "CGCCARDS", "CSG"],
    qrDomains: ["cgccards.com", "cgccards.uk", "cgccards.de"],
    api: { available: false, notes: "No public, documented cert API identified. Official link + user-assisted steps only." },
    officialImagery: {
      status: "public_page",
      notes: "Cert lookup pages may display images for some certs. Not retrieved programmatically; users may upload a reference they obtained themselves.",
    },
    specializedChecks: [
      "CGC documents microprinting, UV ink, holographic foil, unique cert number and barcode on its label.",
      "UV ink cannot be verified from visible-light photos.",
    ],
  },
  BGS: {
    id: "BGS",
    name: "Beckett Grading Services",
    priority: 2,
    lookupBaseUrl: "https://www.beckett.com/grading/card-lookup",
    lookupTemplateVerified: false,
    certPattern: /^\d{7,10}$/,
    certPatternVerified: false,
    labelTokens: ["BECKETT", "BGS", "BVG", "BCCG"],
    qrDomains: ["beckett.com"],
    api: { available: false, notes: "No public cert API identified." },
    officialImagery: { status: "unknown", notes: "Requires further research." },
    specializedChecks: ["Check publicly documented Beckett label holograms / light-reactive and UV features (research pending)."],
  },
  SGC: {
    id: "SGC",
    name: "SGC",
    priority: 2,
    lookupBaseUrl: "https://gosgc.com/cert-code-lookup",
    lookupTemplateVerified: false,
    certPattern: /^[0-9-]{7,13}$/,
    certPatternVerified: false,
    labelTokens: ["SGC"],
    qrDomains: ["gosgc.com"],
    api: { available: false, notes: "No public cert API identified." },
    officialImagery: { status: "unknown", notes: "High-resolution image availability requires further research." },
    specializedChecks: [],
  },
  TAG: {
    id: "TAG",
    name: "TAG Grading",
    priority: 3,
    lookupBaseUrl: "https://taggrading.com/pages/tagd",
    lookupTemplateVerified: false,
    certPattern: /^[A-Z0-9]{6,12}$/i,
    certPatternVerified: false,
    labelTokens: ["TAG"],
    qrDomains: ["taggrading.com", "my.taggrading.com"],
    api: { available: false, notes: "Digital Imaging & Grading (DIG) report reachable via slab QR / cert lookup; no public API identified." },
    officialImagery: { status: "public_page", notes: "DIG report includes imaging; access method requires confirmation." },
    specializedChecks: ["Use TAG's official Proof authentication service/app to check the slab's Proof mark."],
  },
  AGS: {
    id: "AGS",
    name: "AGS",
    priority: 3,
    lookupBaseUrl: "https://agscard.com/",
    lookupTemplateVerified: false,
    certPattern: /^[A-Z0-9-]{5,14}$/i,
    certPatternVerified: false,
    labelTokens: ["AGS"],
    qrDomains: ["agscard.com"],
    api: { available: false, notes: "Requires research." },
    officialImagery: { status: "unknown", notes: "Requires research." },
    specializedChecks: [],
  },
};

export function officialLookupUrl(grader: GraderId, cert: string): string {
  const g = GRADERS[grader];
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

/** Rank graders from QR payloads and OCR text. Pure; deterministic. */
export function detectGrader(input: { codes?: string[]; ocrText?: string[] }): GraderGuess[] {
  const text = (input.ocrText ?? []).join(" ").toUpperCase();
  const words = new Set(text.split(/[^A-Z0-9]+/).filter(Boolean));
  const out: GraderGuess[] = [];
  for (const g of Object.values(GRADERS)) {
    let score = 0;
    const reasons: string[] = [];
    for (const code of input.codes ?? []) {
      const lc = code.toLowerCase();
      if (g.qrDomains.some((d) => lc.includes(d))) {
        score += 5;
        reasons.push(`Code links to ${g.qrDomains.find((d) => lc.includes(d))}`);
      }
    }
    for (const t of g.labelTokens) {
      if (words.has(t)) {
        score += t.length <= 3 ? 1.5 : 2.5;
        reasons.push(`Label text contains "${t}"`);
      }
    }
    if (score > 0) out.push({ grader: g.id, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Candidate cert numbers from QR payloads (preferred) and OCR text. */
export function extractCertCandidates(grader: GraderId | null, input: { codes?: string[]; ocrText?: string[] }): {
  value: string;
  source: "qr" | "barcode" | "ocr";
}[] {
  const seen = new Set<string>();
  const out: { value: string; source: "qr" | "barcode" | "ocr" }[] = [];
  const pattern = grader ? GRADERS[grader].certPattern : /^\d{7,13}$/;
  const push = (v: string, source: "qr" | "barcode" | "ocr") => {
    const n = normalizeCert(v);
    if (pattern.test(n) && !seen.has(n)) {
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

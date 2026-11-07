import type { GraderId } from "../types";

/**
 * Holder Security Reference Library (versioned).
 *
 * Rules:
 *  - Each claim carries a verification status and source. "confirmed_official"
 *    means stated on a grader-owned page; "reported_unconfirmed" means seen in
 *    third-party material only; "research_needed" is a placeholder.
 *  - Absence of a modern feature on an older holder is NEVER a discrepancy by
 *    itself: checks declare which generations they apply to.
 *  - Holder age is not inferred from cert number alone.
 */
export const HOLDER_LIBRARY_VERSION = "2026.11.0";

export type ClaimStatus = "confirmed_official" | "reported_unconfirmed" | "research_needed";

export type AnalysisMethod =
  | "visible_photo"
  | "tilt_sequence"
  | "backlight"
  | "closeup_high_res"
  | "code_decode"
  | "ocr_crosscheck"
  | "uv_light" // not possible with a standard phone camera
  | "grader_service"; // only the grader can verify

export interface SecurityFeature {
  id: string;
  name: string;
  description: string;
  methods: AnalysisMethod[];
  phoneVerifiable: "yes" | "partial" | "no";
  status: ClaimStatus;
  sources: string[];
}

export interface HolderGeneration {
  id: string;
  grader: GraderId;
  name: string;
  introduced?: { approx: string; status: ClaimStatus; source?: string };
  labelStructure: string;
  features: string[]; // SecurityFeature ids
  notes: string[];
  status: ClaimStatus;
  sources: string[];
}

export const SECURITY_FEATURES: Record<string, SecurityFeature> = {
  psa_lighthouse: {
    id: "psa_lighthouse",
    name: "PSA LightHouse label logo",
    description: "PSA describes the label front as having a LightHouse logo with an on/off illumination effect.",
    methods: ["backlight", "tilt_sequence"],
    phoneVerifiable: "partial",
    status: "confirmed_official",
    sources: ["https://www.psacard.com/security/"],
  },
  psa_sonic_weld: {
    id: "psa_sonic_weld",
    name: "Sonically welded tamper-evident holder",
    description: "PSA states the holder halves are sonically sealed; tamper-evident, not tamper-proof.",
    methods: ["visible_photo", "closeup_high_res"],
    phoneVerifiable: "partial",
    status: "confirmed_official",
    sources: ["https://www.psacard.com/security/"],
  },
  psa_cert_images: {
    id: "psa_cert_images",
    name: "Public cert imagery",
    description: "Images available via PSA cert verification for eligible certs.",
    methods: ["grader_service"],
    phoneVerifiable: "yes",
    status: "confirmed_official",
    sources: ["https://www.psacard.com/cert", "https://www.psacard.com/publicapi"],
  },
  psa_qr: {
    id: "psa_qr",
    name: "Label QR / barcode with cert number",
    description: "Machine-readable code on the label; decoded value must agree with printed cert number.",
    methods: ["code_decode", "ocr_crosscheck"],
    phoneVerifiable: "yes",
    status: "reported_unconfirmed",
    sources: [],
  },
  cgc_holo_foil: {
    id: "cgc_holo_foil",
    name: "Holographic foil",
    description: "CGC lists holographic foil among label security features.",
    methods: ["tilt_sequence", "closeup_high_res"],
    phoneVerifiable: "partial",
    status: "confirmed_official",
    sources: ["https://www.cgccards.com/card-grading/holder-label/"],
  },
  cgc_microprint: {
    id: "cgc_microprint",
    name: "Microprinting",
    description: "Fine printing on the label; only inspectable with sufficient close-up resolution.",
    methods: ["closeup_high_res"],
    phoneVerifiable: "partial",
    status: "confirmed_official",
    sources: ["https://www.cgccards.com/card-grading/holder-label/"],
  },
  cgc_uv_ink: {
    id: "cgc_uv_ink",
    name: "UV ink",
    description: "Requires UV illumination. Not verifiable from ordinary visible-light photos.",
    methods: ["uv_light"],
    phoneVerifiable: "no",
    status: "confirmed_official",
    sources: ["https://www.cgccards.com/card-grading/holder-label/"],
  },
  cgc_barcode: {
    id: "cgc_barcode",
    name: "Unique cert number and barcode",
    description: "Decoded barcode/QR must agree with printed cert number.",
    methods: ["code_decode", "ocr_crosscheck"],
    phoneVerifiable: "yes",
    status: "confirmed_official",
    sources: ["https://www.cgccards.com/card-grading/holder-label/"],
  },
  cgc_weld: {
    id: "cgc_weld",
    name: "Ultrasonically welded tamper-evident holder",
    description: "Reported in CGC help-center material for CGC holders.",
    methods: ["visible_photo", "closeup_high_res"],
    phoneVerifiable: "partial",
    status: "reported_unconfirmed",
    sources: ["https://www.cgccomics.com/about/help-center-faqs/cgc-grading/cgc-labels-and-holders"],
  },
  tag_qr_dig: {
    id: "tag_qr_dig",
    name: "QR to DIG report",
    description: "Slab QR links to TAG's digital certificate / DIG report.",
    methods: ["code_decode"],
    phoneVerifiable: "yes",
    status: "reported_unconfirmed",
    sources: ["https://taggrading.com/pages/tagd"],
  },
  tag_proof: {
    id: "tag_proof",
    name: "TAG Proof authentication",
    description: "Verified only through TAG's official Proof service/app.",
    methods: ["grader_service"],
    phoneVerifiable: "no",
    status: "reported_unconfirmed",
    sources: ["https://taggrading.com/"],
  },
  generic_case_integrity: {
    id: "generic_case_integrity",
    name: "Case edges and seams",
    description: "Visible edges should be continuous with no gaps, cracks, glue residue, or tool marks.",
    methods: ["visible_photo", "closeup_high_res"],
    phoneVerifiable: "partial",
    status: "reported_unconfirmed",
    sources: [],
  },
};

export const HOLDER_GENERATIONS: HolderGeneration[] = [
  {
    id: "psa_lighthouse_label",
    grader: "PSA",
    name: "PSA holder with LightHouse label",
    introduced: { approx: "2017-06", status: "confirmed_official", source: "PSA press release 2017-06-14 'PSA Labels Get New Look, New Technology'" },
    labelStructure: "Label at top of holder: card description left, grade right, cert number and machine-readable code.",
    features: ["psa_lighthouse", "psa_sonic_weld", "psa_cert_images", "psa_qr", "generic_case_integrity"],
    notes: ["A revised holder plastic (2024) is reported in collector forums only — unconfirmed; do not use for classification."],
    status: "confirmed_official",
    sources: ["https://www.psacard.com/security/"],
  },
  {
    id: "psa_pre_lighthouse",
    grader: "PSA",
    name: "PSA holder, pre-LightHouse label",
    introduced: { approx: "before 2017-06", status: "research_needed" },
    labelStructure: "Research needed: earlier label families.",
    features: ["psa_sonic_weld", "psa_cert_images", "generic_case_integrity"],
    notes: ["Genuine older slabs lack LightHouse; never flag its absence on this generation."],
    status: "research_needed",
    sources: [],
  },
  {
    id: "cgc_cards_current",
    grader: "CGC",
    name: "CGC Cards holder (current label)",
    introduced: { approx: "research needed", status: "research_needed" },
    labelStructure: "Label with grade, description, cert number, barcode and QR.",
    features: ["cgc_holo_foil", "cgc_microprint", "cgc_uv_ink", "cgc_barcode", "cgc_weld", "generic_case_integrity"],
    notes: ["CSG-branded legacy labels exist (CSG → CGC Cards transition); generation boundaries need research."],
    status: "confirmed_official",
    sources: ["https://www.cgccards.com/card-grading/holder-label/"],
  },
  {
    id: "tag_current",
    grader: "TAG",
    name: "TAG holder",
    labelStructure: "Label with QR linking to DIG report.",
    features: ["tag_qr_dig", "tag_proof", "generic_case_integrity"],
    notes: [],
    status: "reported_unconfirmed",
    sources: ["https://taggrading.com/pages/tagd"],
  },
  { id: "bgs_generic", grader: "BGS", name: "Beckett holder (generation unresolved)", labelStructure: "Research needed", features: ["generic_case_integrity"], notes: ["Label-generation changes and holographic/UV features need research."], status: "research_needed", sources: ["https://www.beckett.com/grading"] },
  { id: "sgc_generic", grader: "SGC", name: "SGC holder (generation unresolved)", labelStructure: "Research needed", features: ["generic_case_integrity"], notes: [], status: "research_needed", sources: ["https://gosgc.com/cert-code-lookup"] },
  { id: "ags_generic", grader: "AGS", name: "AGS holder (generation unresolved)", labelStructure: "Research needed", features: ["generic_case_integrity"], notes: [], status: "research_needed", sources: ["https://agscard.com/"] },
];

export function generationsFor(grader: GraderId): HolderGeneration[] {
  return HOLDER_GENERATIONS.filter((g) => g.grader === grader);
}

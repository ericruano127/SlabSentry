// Shared domain types. Every evidence item carries provenance so the report can
// separate verified facts, visual inference, and unresolved uncertainty.

export type GraderId = "PSA" | "CGC" | "BGS" | "SGC" | "TAG" | "AGS";
export type VerificationMode = "in_hand" | "online_listing";

export type ImageRole =
  | "front"
  | "back"
  | "label_closeup"
  | "security_closeup"
  | "edge"
  | "tilt_frame"
  | "backlit"
  | "detail"
  | "reference_front"
  | "reference_back";

/** Where a piece of information came from. Never conflate these. */
export type EvidenceSource =
  | "official_api" // retrieved programmatically from the grader under its terms
  | "official_link" // user directed to grader site; we did not read it
  | "user_supplied_reference" // user uploaded an image they say came from the grader
  | "user_capture" // photo taken / uploaded by the user
  | "computed" // deterministic CV / rules output
  | "third_party_search" // licensed reverse image search
  | "user_attested"; // user typed / confirmed a value

export interface Provenance {
  source: EvidenceSource;
  tool?: string; // e.g. "vision-service/compare@0.1.0"
  url?: string;
  retrievedAt: string; // ISO timestamp
  note?: string;
}

export type CheckStatus =
  | "consistent" // Consistent with documented design / reference
  | "potential_discrepancy"
  | "inconclusive"
  | "not_visible"
  | "not_supported_by_device"
  | "not_applicable";

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
} // normalized 0..1 coordinates on the referenced image

export interface Observation {
  id: string;
  category:
    | "certification"
    | "identity"
    | "reference_comparison"
    | "physical_fingerprint"
    | "holder"
    | "security_feature"
    | "tampering"
    | "image_reuse"
    | "evidence_quality";
  title: string;
  status: CheckStatus;
  detail: string;
  /** "fact" = verified against a source; "inference" = visual analysis; "unknown" = unresolved */
  basis: "fact" | "inference" | "unknown";
  regions?: Region[];
  imageRefs?: string[]; // ids of submitted / processed images that support the observation
  metrics?: Record<string, number | string | boolean | null>;
  provenance: Provenance;
}

export interface OfficialCertRecord {
  grader: GraderId;
  certNumber: string;
  found: boolean | null; // null = could not determine (no API access)
  description?: string;
  year?: string;
  brand?: string; // manufacturer / set
  subject?: string; // player / character
  cardNumber?: string;
  variety?: string; // parallel
  grade?: string;
  labelType?: string;
  imageUrls?: { front?: string; back?: string };
  verificationUrl: string;
  provenance: Provenance;
  raw?: unknown;
}

export type QualityIssue =
  | "blur"
  | "low_resolution"
  | "glare"
  | "underexposed"
  | "overexposed"
  | "edges_cut_off"
  | "steep_angle"
  | "occlusion"
  | "text_unreadable"
  | "subject_too_small";

export interface QualityReport {
  ok: boolean;
  score: number; // 0..1 overall usability for inspection
  issues: { issue: QualityIssue; severity: "minor" | "major"; guidance: string }[];
  metrics: Record<string, number | boolean>;
}

/** Output contract of the vision service /compare endpoint (subset used by the rules). */
export interface ComparisonResult {
  designMatch: { status: CheckStatus; inliers: number; inlierRatio: number };
  photoReuse: { hammingFull: number; hammingCard: number; nearIdentical: boolean };
  centering: {
    status: CheckStatus;
    upload?: { lr: number; tb: number };
    reference?: { lr: number; tb: number };
    edgeOffsetPct?: number; // card-edge displacement relative to aligned artwork, % of card width
  };
  localDifferences: {
    status: CheckStatus;
    flaggedRegions: Region[];
    glareMaskedPct: number;
    comparableAreaPct: number;
  };
  overlays: { sideBySide?: string; diffHeatmap?: string; aligned?: string }; // stored image ids
  toolVersion: string;
}

export interface HolderInspectionResult {
  slabDetected: boolean;
  edgesVisible: { top: boolean; bottom: boolean; left: boolean; right: boolean };
  edgeStraightness: { maxDeviationPct: number; status: CheckStatus };
  labelRegion?: Region;
  labelAspect?: number;
  codes: { type: "qr" | "barcode"; data: string }[];
  ocrText: string[];
  tilt?: { frames: number; hueVariation: number; brightnessVariation: number; status: CheckStatus };
  backlit?: { status: CheckStatus; luminanceDelta: number };
  toolVersion: string;
}

export type OverallAssessment =
  | "no_major_conflicts"
  | "additional_verification_recommended"
  | "high_risk_inconsistencies"
  | "unable_to_assess";

export interface RiskFinding {
  id: string;
  severity: "info" | "low" | "medium" | "high";
  pattern:
    | "cert_not_found"
    | "cert_cloning_suspected"
    | "different_physical_card"
    | "attribution_mismatch"
    | "front_back_inconsistent"
    | "label_modification_possible"
    | "case_alteration_possible"
    | "listing_photo_reuse"
    | "screenshot_of_reference"
    | "insufficient_evidence";
  summary: string;
  explanation: string;
  observationIds: string[];
  legitimateExplanations: string[]; // e.g. reholder, lighting
}

export interface EvidenceQuality {
  level: "strong" | "moderate" | "limited" | "insufficient";
  reasons: string[];
}

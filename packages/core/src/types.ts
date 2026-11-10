// Shared domain types. Every evidence item carries provenance so the report can
// separate verified facts, visual inference, and unresolved uncertainty.

/** Grader ids come from the reference library (data-driven), e.g. "PSA", "CGC", "WATA". */
export type GraderId = string;
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
    | "image_integrity"
    | "market"
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
  labelType?: string; // official label/holder type — identifies the current holder generation
  gradingDate?: string; // only when the grader officially exposes it (YYYY-MM[-DD])
  imageUrls?: { front?: string; back?: string };
  verificationUrl: string | null; // null when the grader's official lookup URL is not confirmed yet
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
  | "subject_too_small"
  | "motion_blur"
  | "label_blur";

export interface QualityReport {
  ok: boolean;
  score: number; // 0..1 overall usability for inspection
  issues: { issue: QualityIssue; severity: "minor" | "major"; guidance: string }[];
  metrics: Record<string, number | boolean | string>; // includes phash (hex) for near-duplicate detection
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
  /** Phase 2 copy-level signals (absent when design did not align). */
  fingerprint?: {
    lowResolution: boolean;
    cardWidthPx?: Record<string, number>;
    marks: { status: CheckStatus; unmatched?: number; onlyInUpload?: Region[]; onlyInReference?: Region[]; note?: string };
    edgeProfile: { status: CheckStatus; correlation?: number; note?: string };
    registration: { status: CheckStatus; deltaPx?: number; note?: string };
  };
  /** Label in your photo vs label visible in the reference image. */
  labelComparison?: { status: CheckStatus; certConflict?: boolean; tokenOverlap?: number; missingFromUpload?: string[]; extraInUpload?: string[]; note?: string };
  diagnostics?: { cardDetected?: { upload: boolean; reference: boolean } };
  toolVersion: string;
}

export interface EdgeReviewResult {
  imageId: string;
  status: CheckStatus;
  anomalies?: number;
  regions?: Region[];
  note?: string;
}

export interface TiltVideoResult {
  videoId: string;
  durationSec: number;
  sampled: number;
  distinctFrames: number;
  status: "ok" | "too_few_distinct_frames";
}

export interface RetakeRequest {
  role: string; // capture role to add/retake
  reason: string; // what is uncertain
  guidance: string; // how to capture it
  resolves: string[]; // observation ids this would help resolve
  priority: 1 | 2 | 3;
}

export type PhysicalMatchVerdict = "supported" | "not_established" | "conflicting";
export interface PhysicalMatch {
  side: "front" | "back";
  verdict: PhysicalMatchVerdict;
  matching: string[];
  conflicting: string[];
  inconclusive: string[];
  summary: string;
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
    | "insufficient_evidence"
    | "era_mismatch"
    | "image_edit_indicators"
    | "price_anomaly";
  summary: string;
  explanation: string;
  observationIds: string[];
  legitimateExplanations: string[]; // e.g. reholder, lighting
}

export interface EvidenceQuality {
  level: "strong" | "moderate" | "limited" | "insufficient";
  reasons: string[];
}

/** Phase C analysis inputs (all optional; absent = not captured / not configured). */
export interface ImageIntegrityInput {
  imageId: string;
  role: string;
  metadata?: { editorDetected?: boolean; software?: string | null; hadCameraMakeModel?: boolean; hadExif?: boolean; trailingBytesRemoved?: number } | null;
  forensics?: { recompression: { status: CheckStatus; regions?: Region[] }; copyMove: { status: CheckStatus; regions?: Region[] } } | null;
  liveCapture?: boolean;
}
export interface TemplateComparisons {
  label?: { status: "measured" | "not_visible"; layout?: { score: number; status: CheckStatus }; colour?: { score: number; status: CheckStatus } } | null;
  labelTemplateAvailable: boolean;
  uv?: { status: CheckStatus; templateCompared?: boolean; fluorescentPct?: number; note?: string } | null;
  microprint?: { status: CheckStatus; templateCompared?: boolean; resolvable?: boolean; note?: string } | null;
  proportions?: { status: "measured" | "not_visible"; holderAspect?: number; angleDeviationDeg?: number } | null;
}
export interface CertSightings {
  otherSessions: number; // other uploads with the same grader+cert (pseudonymous, any user)
  visuallyDifferent: number; // of those, the item looked clearly different
  comparable: number; // of those, item fingerprints were available to compare
}

import type { LibraryData } from "./schema";

/**
 * Seed for the first published library release. At runtime the server reads the PUBLISHED release
 * from the database (editable by admins, versioned, hashed); this file only seeds a fresh install
 * and backs unit tests. Every claim carries a status — unverified items are never presented as fact.
 */
const CARD_GEOMETRY = { itemAspect: [0.66, 0.77] as [number, number], holderAspect: [0.52, 0.68] as [number, number], status: "reported_unconfirmed" as const };
const CARD_GUIDANCE = {
  front: "Whole slab, all four edges visible, straight on, no glare.",
  back: "Flip the slab over. Same framing as the front.",
  label: "Fill the frame with the label; number and QR/barcode sharp.",
  extras: [],
};
const GENERIC = { itemAspect: null, holderAspect: null, status: "research_needed" as const };

export const DEFAULT_LIBRARY: LibraryData = {
  schemaVersion: 1,
  categories: [
    { id: "sports_cards", name: "Sports cards", description: "Graded sports trading cards.", launchStatus: "supported", subcategories: ["Baseball", "Basketball", "Football", "Hockey", "Soccer", "Other sports"], geometry: CARD_GEOMETRY, captureGuidance: CARD_GUIDANCE, checks: { referenceComparison: true, physicalFingerprint: true, labelComparison: true } },
    { id: "tcg", name: "Trading card games", description: "Graded TCG cards.", launchStatus: "supported", subcategories: ["Pokémon", "One Piece", "Magic: The Gathering", "Yu-Gi-Oh!", "Other IPs"], geometry: CARD_GEOMETRY, captureGuidance: CARD_GUIDANCE, checks: { referenceComparison: true, physicalFingerprint: true, labelComparison: true } },
    {
      id: "sealed_video_games", name: "Sealed video games", description: "Graded sealed games in protective cases.", launchStatus: "planned", subcategories: [], geometry: GENERIC,
      captureGuidance: { front: "Whole case straight on, all edges visible, avoid reflections on the acrylic.", back: "Back of the case, same framing.", label: "Fill the frame with the grading label.", extras: [{ role: "detail", title: "Seal / shrink-wrap close-up", hint: "Seal seams and any seal logo, as close as your camera can focus." }, { role: "edge", title: "Case edges", hint: "Each side of the case, showing seams and closures." }] },
      checks: { referenceComparison: true, physicalFingerprint: false, labelComparison: true },
    },
    {
      id: "comics_magazines", name: "Comics & magazines", description: "Graded comics and magazines.", launchStatus: "planned", subcategories: ["Comics", "Magazines"], geometry: GENERIC,
      captureGuidance: { front: "Whole holder straight on, all edges visible.", back: "Back of the holder, same framing.", label: "Fill the frame with the label.", extras: [{ role: "edge", title: "Spine and holder edges", hint: "The spine side and holder seams." }] },
      checks: { referenceComparison: true, physicalFingerprint: false, labelComparison: true },
    },
    {
      id: "figures", name: "Funko Pops & figures", description: "Graded figures and boxed collectibles in cases.", launchStatus: "planned", subcategories: ["Funko Pop!", "Action figures", "Other figures"], geometry: GENERIC,
      captureGuidance: { front: "Whole case straight on, avoid reflections.", back: "Back of the case.", label: "Fill the frame with the grading label or sticker.", extras: [{ role: "edge", title: "Case corners and closures", hint: "Each corner and any closure or seal." }] },
      checks: { referenceComparison: true, physicalFingerprint: false, labelComparison: true },
    },
    {
      id: "other_collectibles", name: "Other graded collectibles", description: "Any other slabbed or graded collectible.", launchStatus: "planned", subcategories: [], geometry: GENERIC,
      captureGuidance: { front: "Whole holder straight on, all edges visible.", back: "Back of the holder.", label: "Fill the frame with the label.", extras: [] },
      checks: { referenceComparison: true, physicalFingerprint: false, labelComparison: true },
    },
  ],
  graders: [
    {
      id: "PSA", name: "PSA (Professional Sports Authenticator)", categories: ["sports_cards", "tcg"], priority: 1, status: "confirmed_official",
      lookupBaseUrl: "https://www.psacard.com/cert", lookupUrlTemplate: "https://www.psacard.com/cert/{cert}", lookupTemplateVerified: true,
      certPatterns: [{ category: null, pattern: "^\\d{7,10}$", verified: false }], labelTokens: ["PSA", "PSACARD"], qrDomains: ["psacard.com", "psa.cards"],
      api: { available: true, requiresCredential: "PSA_API_TOKEN", notes: "PSA Public API (https://api.psacard.com/publicapi/): cert/GetByCertNumber, cert/GetImagesByCertNumber; free tier 100 calls/day." },
      officialImagery: { status: "api", notes: "Front/back imaging expanded across service levels for submissions received from 2022-12-15; availability is per cert." },
      eraSources: { gradingDate: "none", labelTypeField: true, notes: "Public cert pages show 'Label Type' (e.g. 'PSA Fugitive Ink Technology', 'Hologram'); no grading date confirmed. A PSA reholder updates the holder, so label type reflects the current slab." },
      specializedChecks: ["Compare the slab in hand with the images on PSA's cert page.", "PSA documents a LightHouse label logo with an on/off illumination effect — backlight the label and observe.", "UV-dependent features cannot be validated with an ordinary phone camera."],
    },
    {
      id: "CGC", name: "CGC Cards", categories: ["sports_cards", "tcg"], priority: 1, status: "confirmed_official",
      lookupBaseUrl: "https://www.cgccards.com/certlookup/", lookupUrlTemplate: "https://www.cgccards.com/certlookup/{cert}/", lookupTemplateVerified: false,
      certPatterns: [{ category: null, pattern: "^\\d{7,13}$", verified: false }], labelTokens: ["CGC", "CGCCARDS", "CSG"], qrDomains: ["cgccards.com", "cgccards.uk", "cgccards.de"],
      api: { available: false, notes: "No public, documented cert API identified." }, officialImagery: { status: "public_page", notes: "Cert pages may show images; not retrieved programmatically." },
      eraSources: { gradingDate: "none", labelTypeField: false, notes: "Research needed." },
      specializedChecks: ["CGC documents microprinting, UV ink, holographic foil, unique cert number and barcode on its label.", "UV ink cannot be verified from visible-light photos."],
    },
    {
      id: "BGS", name: "Beckett Grading Services", categories: ["sports_cards", "tcg"], priority: 2, status: "reported_unconfirmed",
      lookupBaseUrl: "https://www.beckett.com/grading/card-lookup", lookupTemplateVerified: false,
      certPatterns: [{ category: null, pattern: "^\\d{7,10}$", verified: false }], labelTokens: ["BECKETT", "BGS", "BVG", "BCCG"], qrDomains: ["beckett.com"],
      api: { available: false, notes: "No public cert API identified." }, officialImagery: { status: "unknown", notes: "Research needed." },
      eraSources: { gradingDate: "none", labelTypeField: false, notes: "Research needed." },
      specializedChecks: ["Check publicly documented Beckett label holograms / light-reactive and UV features (research pending)."],
    },
    {
      id: "SGC", name: "SGC", categories: ["sports_cards", "tcg"], priority: 2, status: "reported_unconfirmed",
      lookupBaseUrl: "https://gosgc.com/cert-code-lookup", lookupTemplateVerified: false,
      certPatterns: [{ category: null, pattern: "^[0-9-]{7,13}$", verified: false }], labelTokens: ["SGC"], qrDomains: ["gosgc.com"],
      api: { available: false, notes: "No public cert API identified." }, officialImagery: { status: "unknown", notes: "Research needed." },
      eraSources: { gradingDate: "none", labelTypeField: false, notes: "Research needed." }, specializedChecks: [],
    },
    {
      id: "TAG", name: "TAG Grading", categories: ["sports_cards", "tcg"], priority: 3, status: "reported_unconfirmed",
      lookupBaseUrl: "https://taggrading.com/pages/tagd", lookupTemplateVerified: false,
      certPatterns: [{ category: null, pattern: "^[A-Z0-9]{6,12}$", verified: false }], labelTokens: ["TAG"], qrDomains: ["taggrading.com", "my.taggrading.com"],
      api: { available: false, notes: "DIG report via slab QR / cert lookup; no public API identified." }, officialImagery: { status: "public_page", notes: "DIG report includes imaging." },
      eraSources: { gradingDate: "none", labelTypeField: false, notes: "Research needed." },
      specializedChecks: ["Use TAG's official Proof authentication service/app to check the slab's Proof mark."],
    },
    {
      id: "AGS", name: "AGS", categories: ["tcg", "sports_cards"], priority: 3, status: "research_needed",
      lookupBaseUrl: "https://agscard.com/", lookupTemplateVerified: false,
      certPatterns: [{ category: null, pattern: "^[A-Z0-9-]{5,14}$", verified: false }], labelTokens: ["AGS"], qrDomains: ["agscard.com"],
      api: { available: false, notes: "Research needed." }, officialImagery: { status: "unknown", notes: "Research needed." },
      eraSources: { gradingDate: "none", labelTypeField: false, notes: "Research needed." }, specializedChecks: [],
    },
    {
      id: "CGC_COMICS", name: "CGC Comics", categories: ["comics_magazines"], priority: 3, status: "research_needed",
      lookupBaseUrl: "https://www.cgccomics.com/certlookup/", lookupTemplateVerified: false,
      certPatterns: [{ category: null, pattern: "^[0-9-]{7,14}$", verified: false }], labelTokens: ["CGC"], qrDomains: ["cgccomics.com"],
      api: { available: false, notes: "Research needed." }, officialImagery: { status: "unknown", notes: "Research needed." },
      eraSources: { gradingDate: "none", labelTypeField: false, notes: "Research needed." }, specializedChecks: [],
    },
    {
      id: "CGC_GAMES", name: "CGC Video Games", categories: ["sealed_video_games"], priority: 3, status: "research_needed",
      lookupBaseUrl: "https://www.cgcvideogames.com/", lookupTemplateVerified: false,
      certPatterns: [{ category: null, pattern: "^[0-9-]{7,14}$", verified: false }], labelTokens: ["CGC"], qrDomains: ["cgcvideogames.com"],
      api: { available: false, notes: "Research needed." }, officialImagery: { status: "unknown", notes: "Research needed." },
      eraSources: { gradingDate: "none", labelTypeField: false, notes: "Research needed." }, specializedChecks: [],
    },
    ...(["WATA", "VGA", "CBCS", "AFA"] as const).map((id) => ({
      id,
      name: { WATA: "WATA Games", VGA: "VGA", CBCS: "CBCS", AFA: "AFA" }[id],
      categories: { WATA: ["sealed_video_games"], VGA: ["sealed_video_games"], CBCS: ["comics_magazines"], AFA: ["figures"] }[id],
      priority: 4, status: "research_needed" as const,
      lookupBaseUrl: null, lookupTemplateVerified: false,
      certPatterns: [{ category: null, pattern: "^[A-Z0-9-]{5,16}$", verified: false }], labelTokens: [id], qrDomains: [],
      api: { available: false, notes: "Official lookup URL and data access to be confirmed." }, officialImagery: { status: "unknown" as const, notes: "Research needed." },
      eraSources: { gradingDate: "none" as const, labelTypeField: false, notes: "Research needed." }, specializedChecks: [],
    })),
  ],
  generations: [
    {
      id: "psa_pre_lighthouse", graderId: "PSA", categories: ["sports_cards", "tcg"], name: "PSA holder, pre-LightHouse label",
      gradingDateRange: { from: null, to: "2017-06", status: "reported_unconfirmed", source: "End date from PSA's 2017-06-14 announcement of the LightHouse label" },
      officialLabelTypes: ["Hologram"], labelStructure: "Earlier PSA label families (research needed).",
      features: ["psa_sonic_weld", "psa_cert_images", "generic_case_integrity"], visualMarkers: [],
      notes: ["Genuine older slabs lack LightHouse; never flag its absence on this generation.", "Mapping of the 'Hologram' label type to this generation is reported, not confirmed."],
      status: "research_needed", sources: ["https://www.psacard.com/security/"],
    },
    {
      id: "psa_lighthouse_label", graderId: "PSA", categories: ["sports_cards", "tcg"], name: "PSA holder with LightHouse label",
      gradingDateRange: { from: "2017-06", to: null, status: "confirmed_official", source: "PSA press release 2017-06-14 'PSA Labels Get New Look, New Technology'" },
      officialLabelTypes: [], labelStructure: "Label at top of holder: description left, grade right, cert number and machine-readable code.",
      features: ["psa_lighthouse", "psa_sonic_weld", "psa_cert_images", "psa_qr", "generic_case_integrity"],
      visualMarkers: [{ id: "psa_lighthouse_backlit", kind: "backlit_change", exclusive: true, status: "confirmed_official" }],
      notes: ["A revised holder plastic (2024) is reported in collector forums only — not used for classification."],
      status: "confirmed_official", sources: ["https://www.psacard.com/security/"],
    },
    {
      id: "psa_fugitive_ink_label", graderId: "PSA", categories: ["sports_cards", "tcg"], name: "PSA label — 'Fugitive Ink Technology'",
      gradingDateRange: { from: null, to: null, status: "research_needed", source: "Label type value seen on PSA public cert pages; introduction date not confirmed" },
      officialLabelTypes: ["PSA Fugitive Ink Technology"], labelStructure: "Research needed.",
      features: ["psa_sonic_weld", "psa_cert_images", "psa_qr", "generic_case_integrity"], visualMarkers: [],
      notes: ["Feature list and relationship to the LightHouse label need confirmation from PSA."],
      status: "research_needed", sources: ["https://www.psacard.com/cert"],
    },
    {
      id: "cgc_cards_current", graderId: "CGC", categories: ["sports_cards", "tcg"], name: "CGC Cards holder (current label)",
      gradingDateRange: { from: null, to: null, status: "research_needed" }, officialLabelTypes: [],
      labelStructure: "Label with grade, description, cert number, barcode and QR.",
      features: ["cgc_holo_foil", "cgc_microprint", "cgc_uv_ink", "cgc_barcode", "cgc_weld", "generic_case_integrity"],
      visualMarkers: [{ id: "cgc_qr", kind: "qr_domain", value: "cgccards.com", exclusive: false, status: "reported_unconfirmed" }],
      notes: ["CSG-branded legacy labels exist (CSG → CGC Cards); generation boundaries need research."],
      status: "confirmed_official", sources: ["https://www.cgccards.com/card-grading/holder-label/"],
    },
    { id: "tag_current", graderId: "TAG", categories: ["sports_cards", "tcg"], name: "TAG holder", gradingDateRange: { from: null, to: null, status: "research_needed" }, officialLabelTypes: [], labelStructure: "Label with QR linking to DIG report.", features: ["tag_qr_dig", "tag_proof", "generic_case_integrity"], visualMarkers: [], notes: [], status: "reported_unconfirmed", sources: ["https://taggrading.com/pages/tagd"] },
    ...(["BGS", "SGC", "AGS", "CGC_COMICS", "CGC_GAMES", "WATA", "VGA", "CBCS", "AFA"] as const).map((g) => ({
      id: `${g.toLowerCase()}_generic`, graderId: g,
      categories: { BGS: ["sports_cards", "tcg"], SGC: ["sports_cards", "tcg"], AGS: ["tcg", "sports_cards"], CGC_COMICS: ["comics_magazines"], CGC_GAMES: ["sealed_video_games"], WATA: ["sealed_video_games"], VGA: ["sealed_video_games"], CBCS: ["comics_magazines"], AFA: ["figures"] }[g],
      name: `${g.replace("_", " ")} holder (generation unresolved)`,
      gradingDateRange: { from: null, to: null, status: "research_needed" as const }, officialLabelTypes: [], labelStructure: "Research needed",
      features: ["generic_case_integrity"], visualMarkers: [], notes: ["Holder generations and security features need research from official sources."],
      status: "research_needed" as const, sources: [],
    })),
  ],
  features: [
    { id: "psa_lighthouse", name: "PSA LightHouse label logo", description: "PSA describes the label front as having a LightHouse logo with an on/off illumination effect.", methods: ["backlight", "tilt_sequence"], phoneVerifiable: "partial", status: "confirmed_official", sources: ["https://www.psacard.com/security/"] },
    { id: "psa_sonic_weld", name: "Sonically welded tamper-evident holder", description: "PSA states the holder halves are sonically sealed; tamper-evident, not tamper-proof.", methods: ["visible_photo", "closeup_high_res"], phoneVerifiable: "partial", status: "confirmed_official", sources: ["https://www.psacard.com/security/"] },
    { id: "psa_cert_images", name: "Public cert imagery", description: "Images available via PSA cert verification for eligible certs.", methods: ["grader_service"], phoneVerifiable: "yes", status: "confirmed_official", sources: ["https://www.psacard.com/cert", "https://www.psacard.com/publicapi"] },
    { id: "psa_qr", name: "Label QR / barcode with cert number", description: "Machine-readable code on the label; decoded value must agree with printed cert number.", methods: ["code_decode", "ocr_crosscheck"], phoneVerifiable: "yes", status: "reported_unconfirmed", sources: [] },
    { id: "cgc_holo_foil", name: "Holographic foil", description: "CGC lists holographic foil among label security features.", methods: ["tilt_sequence", "closeup_high_res"], phoneVerifiable: "partial", status: "confirmed_official", sources: ["https://www.cgccards.com/card-grading/holder-label/"] },
    { id: "cgc_microprint", name: "Microprinting", description: "Fine printing on the label; only inspectable with sufficient close-up resolution.", methods: ["closeup_high_res"], phoneVerifiable: "partial", status: "confirmed_official", sources: ["https://www.cgccards.com/card-grading/holder-label/"] },
    { id: "cgc_uv_ink", name: "UV ink", description: "Requires UV illumination. Not verifiable from ordinary visible-light photos.", methods: ["uv_light"], phoneVerifiable: "no", status: "confirmed_official", sources: ["https://www.cgccards.com/card-grading/holder-label/"] },
    { id: "cgc_barcode", name: "Unique cert number and barcode", description: "Decoded barcode/QR must agree with printed cert number.", methods: ["code_decode", "ocr_crosscheck"], phoneVerifiable: "yes", status: "confirmed_official", sources: ["https://www.cgccards.com/card-grading/holder-label/"] },
    { id: "cgc_weld", name: "Ultrasonically welded tamper-evident holder", description: "Reported in CGC help-center material for CGC holders.", methods: ["visible_photo", "closeup_high_res"], phoneVerifiable: "partial", status: "reported_unconfirmed", sources: ["https://www.cgccomics.com/about/help-center-faqs/cgc-grading/cgc-labels-and-holders"] },
    { id: "tag_qr_dig", name: "QR to DIG report", description: "Slab QR links to TAG's digital certificate / DIG report.", methods: ["code_decode"], phoneVerifiable: "yes", status: "reported_unconfirmed", sources: ["https://taggrading.com/pages/tagd"] },
    { id: "tag_proof", name: "TAG Proof authentication", description: "Verified only through TAG's official Proof service/app.", methods: ["grader_service"], phoneVerifiable: "no", status: "reported_unconfirmed", sources: ["https://taggrading.com/"] },
    { id: "generic_case_integrity", name: "Case edges and seams", description: "Visible edges should be continuous with no gaps, cracks, glue residue, or tool marks.", methods: ["visible_photo", "closeup_high_res"], phoneVerifiable: "partial", status: "reported_unconfirmed", sources: [] },
  ],
  certRanges: [],
};

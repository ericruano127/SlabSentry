# Grader Research Matrix (as of 2026-11-07)

Legend: ✅ confirmed from an official grader page · ⚠️ reported by third parties only / unconfirmed · ❓ research needed.
The same statuses live in code (`packages/core/src/holders/library.ts`, `graders/registry.ts`) so the app never presents an unconfirmed claim as fact.

| | PSA (priority 1) | CGC Cards (priority 1) | Beckett BGS (2) | SGC (2) | TAG (3) | AGS (3) |
|---|---|---|---|---|---|---|
| **Cert lookup** | ✅ `psacard.com/cert/{cert}` | ✅ `cgccards.com/certlookup/` (deep-link `/{cert}/` ⚠️ unverified) | ⚠️ beckett.com/grading → Verify Cert | ✅ gosgc.com/cert-code-lookup | ⚠️ QR / cert → DIG report | ❓ agscard.com |
| **Programmatic access** | ✅ PSA Public API `api.psacard.com/publicapi` — bearer token from a PSA account; `cert/GetByCertNumber/{cert}`, `cert/GetImagesByCertNumber/{cert}`; free tier **100 calls/day** | ❓ none documented → link + user-assisted | ❓ none documented | ❓ none documented | ❓ none documented | ❓ |
| **Official reference images** | ✅ via API for eligible certs (imaging expanded to all service levels for submissions received from **2022-12-15**; some earlier certs have images). Image endpoint schema only partly documented ⚠️ | ⚠️ may appear on cert pages; not retrieved | ❓ | ❓ high-res availability unknown | ⚠️ DIG report includes imaging | ❓ |
| **Label / holder security (documented)** | ✅ LightHouse label logo with on/off illumination effect (label introduced 2017-06-14 press release); ✅ sonically welded, tamper-evident (not tamper-proof) holder; ✅ public cert images | ✅ microprinting, UV ink, holographic foil, unique cert number + barcode; ⚠️ QR; ⚠️ ultrasonically welded holder (CGC help center) | ❓ holographic / light-reactive / UV features — research | ❓ | ⚠️ QR to DIG; ⚠️ Proof mark verified by TAG's Proof service/app | ❓ |
| **Phone-verifiable** | partial: backlight on/off, code↔number, edges | partial: foil change on tilt, barcode↔number, microprint only with sharp close-ups. UV **no** | ❓ | ❓ | QR only; Proof **no** (official service) | ❓ |
| **Holder generations in library** | LightHouse (2017+) ✅; pre-LightHouse ❓; 2024 revised plastic ⚠️ forum-only (not used) | current label ✅ features; CSG→CGC transition boundaries ❓ | placeholder ❓ | placeholder ❓ | placeholder ⚠️ | placeholder ❓ |
| **Permitted integration (this build)** | API when `PSA_API_TOKEN` set; otherwise link | link + user-supplied reference | link | link | link + refer to Proof | link |

## Data-access limitations & rules we follow
- No scraping of cert pages or circumventing access controls. Graders without a documented API get an **official link** and a **user-supplied reference** option.
- A user-supplied image is always labeled *user-supplied* (`provenance.source = user_supplied_reference`) with the user's attestation; findings derived from it are capped at **medium** severity.
- PSA cert lookups are cached for 24h per cert to respect the 100/day free quota and protect margins.
- Holder age is never inferred from cert number alone; absence of a modern feature is not a discrepancy unless every candidate generation documents it.

## Open research items
1. PSA `GetImagesByCertNumber` response schema (code accepts only `{ImageURL, IsFrontImage}` HTTPS entries).
2. CGC: official deep-link format; whether post-encapsulation photos can be accessed under permitted terms.
3. Beckett label generations and documented holographic/UV features.
4. SGC holder/label generations; image availability.
5. TAG DIG report access terms; Proof service integration options.
6. AGS verification records and scans.
7. Physical holder dimensions per generation (not used until officially documented).

## Sources
- PSA Security: https://www.psacard.com/security/ · PSA Cert: https://www.psacard.com/cert · PSA Public API: https://www.psacard.com/publicapi , https://www.psacard.com/publicapi/documentation , https://api.psacard.com/publicapi/swagger.json
- CGC Holder & Label: https://www.cgccards.com/card-grading/holder-label/ · CGC cert lookup: https://www.cgccards.com/certlookup/ · CGC labels/holders FAQ: https://www.cgccomics.com/about/help-center-faqs/cgc-grading/cgc-labels-and-holders
- Beckett: https://www.beckett.com/grading · SGC: https://gosgc.com/cert-code-lookup · TAG: https://taggrading.com/pages/tagd · AGS: https://agscard.com/

# Phase A — Privacy, consent & security (done 2026-11-09)

| # | Delivered | Where |
|---|---|---|
| A1 | **Lossless metadata stripping** on every upload before analysis/storage: JPEG EXIF/GPS/XMP/IPTC/comments, PNG text/eXIf/tIME, WebP EXIF/XMP, MP4/MOV `udta`/`meta`/`uuid` (in-place, offsets unchanged), WebM Tags/Attachments; trailing data cut; only Orientation kept. Pixels verified identical. Non-identifying signals kept for manipulation checks. Official grader images stripped too. Backfill script for existing files. | `apps/web/lib/metadata.ts`, `lib/sessions.ts`, `scripts/strip-existing-metadata.ts` |
| A2 | **Consent**: versioned legal docs (drafts, flagged for legal review) loaded from `legal/`; Terms + Privacy acceptance required (re-acceptance on new versions) via a 428 gate on the API; separate unticked training opt-in; append-only `consent_events`; per-upload consent snapshot; `training_eligible_images` view | `legal/`, `lib/consent.ts`, `components/ConsentGate.tsx`, `apps/mobile/app/consent.tsx`, migration `004` |
| A3 | **Privacy rights**: data export zip (JSON + photos), training opt-out anytime, deletion logged; `privacy_requests` log; retention purge (media 365 days, ops data) run by the worker | `app/api/account/export`, `lib/retention.ts`, `scripts/worker.ts` |
| A4 | **2FA + RBAC**: Supabase TOTP enrollment and sign-in challenge (web + mobile); server rejects one-factor sessions for enrolled users; roles support / analyst / admin / owner with least-privilege permissions; all staff permissions require aal2; audited owner-only role changes | `lib/rbac.ts`, `lib/auth.ts`, `components/MfaSettings.tsx`, `app/api/admin/users/role` |
| A5 | **Upload hardening**: content sniffing, size, pixel and side limits (also in OpenCV), truncation rejection, trailing-data removal, 20 s video limit | `lib/metadata.ts`, `lib/sessions.ts`, `services/vision/app/main.py` |
| A6 | **Security groundwork**: CI `pnpm audit`, `pip-audit`, gitleaks; Dependabot; CODEOWNERS; `SECURITY.md`; incident response plan; hardening checklist; HSTS + CSP; production startup guard | `.github/`, `SECURITY.md`, `docs/security/`, `next.config.ts`, `lib/startup.ts` |
| A7 | **Legal drafts** (Terms, Privacy, Notice at Collection, Training Consent), each marked LEGAL REVIEW REQUIRED; footer disclaimer and privacy-choices links on every page | `legal/`, `app/legal/[kind]`, `app/layout.tsx` |

**Manual follow-ups (account settings, not code):** GitHub branch protection + 2FA + secret scanning (see `docs/security/HARDENING_CHECKLIST.md`), Supabase MFA enabled in Auth settings, provider 2FA, encryption-at-rest confirmation, legal review, penetration test before launch.

**Known limits:** WebM stripping is best-effort (browser recordings carry no location; Tags/Attachments are voided); CSP still allows inline scripts (nonce work pending); export caps embedded photos at 500 MB.

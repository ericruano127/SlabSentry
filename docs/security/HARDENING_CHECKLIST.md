# Security Hardening Checklist (pre-launch)

Items marked **(manual)** are account settings this repository cannot change itself.

## Source code & deployment
- [ ] **(manual)** GitHub: enable 2FA requirement for every account with access.
- [ ] **(manual)** Branch protection on `main`: require PR, ≥1 approving review, **require review from Code Owners**, require status checks (`test`, `secret-scan`), dismiss stale approvals, no force-push, no deletion, include administrators.
- [ ] **(manual)** Enable Dependabot alerts + security updates, secret scanning and push protection.
- [x] CI: tests, `pnpm audit --audit-level=high`, `pip-audit`, gitleaks secret scan (`.github/workflows/ci.yml`).
- [x] Dependabot version updates (`.github/dependabot.yml`), CODEOWNERS.
- [x] Every GitHub Action pinned to a full commit SHA (version in a comment), including the Fly.io setup step that runs with the deploy token; Dependabot updates the pins in one grouped PR. No action runs on Node 20.
- [ ] **(manual)** Production deploys only from `main` via the CI/CD pipeline, with required approval for the production environment. *Pipeline built (`deploy-production.yml` checks that the commit is on `main` and passed CI); add Required reviewers to the GitHub `production` environment.*

## Accounts & secrets
- [ ] **(manual)** 2FA on Supabase, hosting, Stripe, RevenueCat, Apple Developer, Google Play Console, Google Cloud, Anthropic, domain registrar, email.
- [ ] Secrets in the host's secret manager (e.g. Vercel/Fly secrets, AWS Secrets Manager, Doppler) — never in the repo (`.env*` is git-ignored; gitleaks scans history).
- [ ] Separate projects/keys for development, staging and production; rotate keys on staff departure and at least yearly.
- [x] Production startup refuses insecure config (`apps/web/lib/startup.ts`): dev auth, missing vision key/webhook secrets, non-TLS database, unreviewed legal text.

## Application
- [x] Metadata (EXIF/GPS/XMP/IPTC/video location) stripped losslessly before storage; existing files backfilled (`scripts/strip-existing-metadata.ts`).
- [x] Upload type sniffing, size limits, pixel limits (decompression bombs), truncated-file rejection, trailing-data removal, video length limit.
- [x] Staff RBAC (support / analyst / admin / owner) with mandatory 2FA (aal2); user 2FA optional but enforced server-side once enrolled.
- [x] Row-level security on all tables; private storage; images served only to their owner; share links exclude photos and personal data.
- [x] Rate limiting on create/upload/analyze/export/checkout; verified idempotent webhooks.
- [x] Security headers: HSTS, CSP, frame-ancestors none, nosniff, referrer policy, permissions policy.
- [x] Strict Content-Security-Policy with a fresh nonce per page view (`apps/web/proxy.ts`, `lib/csp.ts`): no `'unsafe-inline'` or `'unsafe-eval'` for scripts, `'strict-dynamic'`, `<style>` elements need the nonce, `object-src`/`frame-src` none, `base-uri` none, exact Supabase origin only (no wildcard). API responses get `default-src 'none'`. Violations are reported to `/api/csp-report` (metric + `CspViolations` alert). See `docs/security/CSP.md`.
- [ ] Malware scanning for uploads if file types beyond images/videos are ever accepted (current types are decoded and re-validated).

## Monitoring & response (Phase F completes)
- [ ] Centralized logs with alerts on auth anomalies, 5xx spikes, webhook failures, admin/role changes. *Built (`docs/MONITORING.md`: AuthFailureSpike, ApiErrorRate, BillingWebhookFailures, StaffRoleChanged); tick once Grafana Cloud is connected and a contact point is set.*
- [ ] Incident response plan reviewed with counsel (`INCIDENT_RESPONSE.md`); contacts filled in.

## Before public launch
- [ ] Third-party penetration test (web, API, mobile, storage permissions) and fix findings.
- [ ] Legal review of all `legal/` documents; set `legal_review_status = 'approved'`.
- [ ] Confirm encryption at rest for database, storage and backups in provider settings; document it.

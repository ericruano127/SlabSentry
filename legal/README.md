# Legal documents — DRAFTS, NOT LEGAL ADVICE

> ⚠️ **LEGAL REVIEW REQUIRED BEFORE LAUNCH.** Every document here is an engineering draft written to describe how the
> software actually behaves. Qualified counsel must review and approve each one (including CCPA/CPRA and other
> state/international requirements) before public launch. Production refuses to start while any published document
> is marked `legal_review_status = pending`, unless `ALLOW_UNREVIEWED_LEGAL=1` is set deliberately (e.g. for staging).

Documents are versioned: `pnpm db:migrate` loads each file below as version `VERSION` (front matter). Publishing a new
version with `requires_acceptance: true` makes every user re-accept on their next visit; acceptances are logged in the
append-only `consent_events` table with version, timestamp and source.

| File | Kind | Users must accept? |
|---|---|---|
| terms.md | terms | yes |
| privacy.md | privacy | yes |
| data-collection.md | data_collection | shown at sign-up (notice at collection) |
| training-consent.md | training_consent | optional, separate opt-in |

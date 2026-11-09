# Incident Response Plan

> **LEGAL REVIEW REQUIRED** for the notification section (obligations vary by state/country and change over time).

## Roles
| Role | Responsibility |
|---|---|
| Incident commander (IC) | Owns the incident, decisions, timeline. Default: on-call engineer → founder |
| Communications lead | User, partner and regulator communications (with counsel) |
| Scribe | Timestamped log of actions/evidence |
| Counsel | Legal assessment of notification duties |

## Severity
| Sev | Examples | Response |
|---|---|---|
| 1 | Confirmed exposure of personal data, uploads or credentials; production compromise; reference library tampering | Page immediately, 24/7 |
| 2 | Suspected exposure, vulnerability actively exploitable, billing integrity issue | Within 4 hours |
| 3 | Vulnerability without evidence of exploitation | Next business day |

## Steps
1. **Detect & declare** — alert, report or anomaly → open incident channel, assign IC, start log.
2. **Contain** — revoke/rotate affected keys (Supabase service key, Stripe, RevenueCat, vision key, PSA token), disable compromised accounts/roles, block abusive IPs, pause deploys, put the affected feature behind a kill switch.
3. **Preserve evidence** — snapshot logs (app, auth, database audit, `admin_audit_log`, `consent_events`), storage access logs, deploy history. Do not destroy data.
4. **Assess scope** — which data categories (see Notice at Collection), which users, which time window; whether data was encrypted; whether the reference library/rules were altered (compare published version hashes).
5. **Eradicate & recover** — patch, redeploy from a clean build, restore from backup if needed, verify.
6. **Notify** (with counsel) — see below.
7. **Post-incident review** within 10 business days: root cause, timeline, what worked, action items with owners.

## Breach notification (draft — counsel must confirm)
- **US state laws**: notify affected residents "in the most expedient time possible and without unreasonable delay"; many states set deadlines (often 30–60 days) and require regulator notice above thresholds (e.g. California: notify the Attorney General when more than 500 residents are notified; sample notice format required).
- **CCPA/CPRA**: private right of action for certain breaches of unencrypted personal information — keep encryption at rest enabled and documented.
- **If serving EU/UK users**: GDPR/UK GDPR — notify the supervisory authority within **72 hours** of awareness when there is a risk to individuals; notify individuals without undue delay when the risk is high.
- **Vendors**: notify processors/partners per contract; App Store / Google Play if account credentials are involved.
- Notices state what happened, what data, what we're doing, what users should do, and contact details.

## Contacts (fill in before launch)
Supabase support · Stripe · RevenueCat · hosting provider · counsel · cyber-insurance carrier.

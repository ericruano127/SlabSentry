# Security Policy

## Reporting a vulnerability
Please **do not open a public issue**. Email **[security contact — to be set before launch]** with steps to reproduce and impact. We acknowledge within 2 business days and aim to fix critical issues within 7 days. Good-faith research that avoids privacy violations, data destruction and service disruption will not be pursued legally.

Out of scope: reports about counterfeit-detection *accuracy* (send those via in-app feedback) and requests to disclose detection methods.

## How we protect data
Summary of controls (details in `docs/security/`): metadata (EXIF/GPS) stripped from all uploads before storage; TLS in transit and encryption at rest; private storage served only to the owner; row-level security on every table; least-privilege staff roles with mandatory 2FA; audited admin actions; verified, idempotent billing webhooks; rate limiting; upload type/size/pixel limits; dependency and secret scanning in CI.

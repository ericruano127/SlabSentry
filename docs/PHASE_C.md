# Phase C — Expanded checks + fair market value (done 2026-11-10)

| Check | Status | Notes |
|---|---|---|
| Cert ↔ record cross-check incl. **set** | ✅ | Grade, year, subject, card number and set compared with label text |
| **Label layout / typography / colour** | ✅ needs templates | Layout skeleton + colour palette vs a **verified template** of the same holder generation. No template → "inconclusive" (never guessed). Thresholds wide until tuned on real slabs |
| **Microprint** | ✅ needs templates | Resolvability check (focus/camera limit → "not supported by device") + structure match vs verified template crop |
| **UV (blacklight photo)** | ✅ needs templates | New `uv` capture; fluorescence pattern vs verified template. No blacklight → "not visible" + retake request; no template → inconclusive |
| **Slab proportions** | ✅ needs data | Measured holder aspect vs documented per-generation range (library `proportions`, none documented yet) |
| **Card swap** | ✅ (Phase 1–2) | Reference comparison + physical fingerprint |
| **Image manipulation** | ✅ partial | Editing software named in file (from metadata read before stripping) and copy-paste duplication (0 false alarms on 24 clean test images) are review items; duplication on the front is a low finding. **Recompression (ELA) analysis is disabled in reports**: it flagged every clean validation image. Single cloned characters are not detectable (repeated glyphs are normal) |
| **Live-capture mode** | ✅ | Single-use 2-minute codes for in-app camera captures (web live camera, mobile camera); raises evidence quality; stated as not proof against photographing a screen |
| **Cloned certs across uploads** | ✅ | Pseudonymous index (HMAC of grader+cert and of user id, item perceptual hash). Same cert on a visually different item → medium (≥2 → high). Only counts are shown; deleted with the account |
| **Fair market value** | ✅ | Comparable sales the user adds (median of last 90 days, MAD outlier removal, range, confidence) + licensed price provider adapter (PriceCharting/SportsCardsPro) that stays **off until its field mapping is verified** against a live response in Admin → Templates & market. Always labelled "if genuine", never affects authenticity findings; asking price < 50% of FMV in listing mode → low "too good to be true" note |

Templates are registered by staff (admin/owner + 2FA) from slabs whose authenticity was established outside the app; each registration records how, and is audited.

**Research notes:** eBay's sold-items API (Marketplace Insights) is restricted to approved developers. PriceCharting's documented basics were confirmed by search (token `t`, `/api/product`, `/api/products`), but its documentation pages weren't reachable from this environment, so the grade→field mapping and price units are left unconfigured on purpose.

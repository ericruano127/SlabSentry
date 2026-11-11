# Accessibility

**Target: WCAG 2.2 level AA** for the web app, and the platform accessibility APIs (VoiceOver, TalkBack) in the mobile apps.

## Audit: 2026-11-11
**Method:**
- axe-core 4.11 with the WCAG 2.0/2.1/2.2 A and AA rules, on **every page**: 19 pages, including the report and shared-report pages.
- Each page scanned in light and dark mode at desktop size, and in light mode at phone size (390 px).
- Each page scanned signed out, signed in, and as staff: **57 page scans**.
- A **keyboard walk** on every page: Tab through every stop, check each has a visible focus indicator, and check focus never gets stuck.
- Manual checks of page titles, heading order and landmarks.
- A static review of the mobile app.

**Before:** no missing form labels, alt text, button names or ARIA errors, and no keyboard traps; every page was reachable by keyboard. Found:

| Issue | WCAG | Where | Fix |
|---|---|---|---|
| Green status text at **3.9:1** on its tint (4.4:1 on white) | 1.4.3 Contrast (AA) | "Verified/consistent" pills, report summaries, staff tables (74 elements) | Light-theme green `#1f8a4c` → `#15703c`: 5.5:1 and 6.2:1. Same fix in the camera hint pills and the mobile theme |
| Links inside grey text distinguished **only by colour** (1.05:1 against the surrounding text) | 1.4.1 Use of Color | Report evidence links, footers, staff pages (39 links) | Links inside text are underlined; navigation and buttons keep their styling |
| Wide tables scroll sideways but **couldn't be scrolled by keyboard** | 2.1.1 Keyboard | Staff tables, history, reports on phones | Scroll containers are focusable regions with a name and a focus ring |
| **Every page had the same title** | 2.4.2 Page Titled | All pages | Each page has its own title, e.g. "Scan · SlabGuard" and "Terms of Service · SlabGuard". Admin and shared-report pages are also marked not to be indexed |
| **No way to skip the navigation** | 2.4.1 Bypass Blocks | All pages | "Skip to main content" is the first Tab stop and moves focus into `<main>` |
| Heading levels skipped (h1 → h3) | 1.3.1 Info and Relationships | Home page cards, legal documents | Correct levels, same visual size |
| Mobile buttons lost their name while showing a spinner | 4.1.2 Name, Role, Value | All mobile buttons | Buttons keep their label and announce "busy" |

All colour pairs in both themes were also checked by calculation, not only those that appeared on scanned pages. Everything else already passed: text, muted text, links and the amber/red statuses in light and dark.

**After:** **0 violations in 57 page scans**, a visible focus indicator on every Tab stop, no traps, and the skip link first on every page.

## Kept that way automatically
`apps/web/scripts/a11y-audit.mjs` runs the same audit and **fails on any violation**. CI runs it on every push (the `accessibility` job): a fresh database, the app in development mode, and test accounts for signed-in and staff pages. It was verified to fail when the old low-contrast green was restored.

To run it locally against a development server:

```bash
cd apps/web && AUTH_MODE=dev NEXT_PUBLIC_AUTH_MODE=dev npx next dev -p 3000
```

```bash
cd apps/web && node scripts/a11y-audit.mjs --session <session-id> --share <share-token>
```

## Mobile app
- **Static review:** every pressable has an accessibility role, and every image, text field and switch has a label. Buttons are at least 48 pt. The live camera announces "Ready to capture", its hints are a live region, and the shot outline is hidden from screen readers.
- **Not verified here:** VoiceOver and TalkBack on real devices. Add them to the device test in `docs/MOBILE_CAMERA.md`: navigate a full scan with the screen reader on, and with the largest text size.

## Limits
Automated tools find roughly a third to a half of accessibility problems. Before launch, it's worth one session with a screen-reader user, or an accessibility specialist, through the main flows: sign up, scan, read a report, upgrade. Watch especially for how report findings and uncertainty are announced.

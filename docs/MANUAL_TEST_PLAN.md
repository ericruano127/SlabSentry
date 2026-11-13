# Manual test plan

What to test by hand on **staging**, on the website and the mobile apps, before launch. It covers what the automated tests can't reach:
- real sign-up, sign-in and two-factor;
- real card photos;
- Stripe and app-store test purchases;
- the live camera on phones;
- screen readers;
- how the app behaves on real devices and networks.

The automated suites (`docs/TESTING.md`) already check the logic on every push. This plan checks the real thing end to end.

**Record results in the shared checklist:** https://claude.ai/artifact/1EPoj6cgtQMo5MF5KwUiJn
- Start a run for your device, then mark each test Pass, Fail or Blocked, with a note or bug link. Everyone's results show live.
- **Copy failures** gives a ready-to-paste list of a run's failed and blocked tests.
- To get in, ask the owner to share it with you at **Contributor** access, and sign in to claude.ai.
- The checklist copies the tests from this document. When this document changes, update the checklist to match. Results are kept by test ID.

## Two kinds of run
- **Smoke test** (about 30 minutes): after every staging deploy you care about. Run the tests marked **★**.
- **Full pass** (one to two days, ideally two people): before launch, and again after any big change. Run everything.

## Before you start
**Environment:**
- Staging deployed (`docs/STAGING_FLY.md`).
- The staging Supabase project has email sign-in plus Google and Apple sign-in configured, with staging redirect URLs.
- Stripe is in **test mode**, with its keys on staging.
- RevenueCat is connected to the App Store sandbox and Google Play test tracks.
- Optional: a PSA API token on staging (otherwise cert lookups show as unavailable). Grafana is useful for checking errors after a pass (`docs/MONITORING.md`).

**People and accounts:**

| What | Why |
|---|---|
| 2–3 test email addresses you can read | Sign-up, confirmation, password reset, a second user for privacy checks |
| A Google account and an Apple ID | Social sign-in |
| An authenticator app (Google Authenticator, 1Password, …) | Two-factor |
| A staff account (your email in `ADMIN_EMAILS`), plus a **second** staff account | Staff tools. Template approval needs two different people |
| App Store **sandbox tester** and Google Play **license tester** accounts | Mobile purchases without real charges |

**Devices:**
- **Desktop:** Chrome, Safari, Firefox and Edge, at normal width and resized narrow.
- **Phones:** at least one recent and one older **iPhone**, and the same for **Android**. Test the mobile **website** on them as well as the app.

**Test cards (slabs):**
- **Known genuine slabs**, ideally PSA, CGC and TAG, including an older PSA label. Cards you own and trust.
- If you have them: a **known counterfeit or altered slab**, or seller photos of one.
- For online-listing tests: **marketplace listing photos** (screenshots are fine).
- A blacklight (365–395 nm) and a phone flashlight for the UV and backlight captures.

**Stripe test card numbers** (any future expiry date, any CVC):
- `4242 4242 4242 4242`: succeeds.
- `4000 0000 0000 0002`: declined.
- `4000 0025 0000 3155`: asks for 3-D Secure authentication.

## How to record results
For each test write **Pass**, **Fail** or **Blocked** (couldn't run). For anything that isn't a pass, file a bug with:
- **Test ID** (e.g. B3), device or browser, and app version (mobile: Account screen; web: the version link in the footer).
- **Steps**, **what you expected**, **what happened**.
- A screenshot or screen recording.
- **The time it happened** and, if shown, the **request ID** in the error message, so the logs can be found.
- **For a wrong result on a scan:** the report link (from your history). Don't post photos of other people's cards publicly.

**Severity:**
- **Blocker:** data loss, privacy leak, wrong charge, can't sign in or scan.
- **Major:** a feature doesn't work, or a misleading result.
- **Minor:** cosmetic issues, unclear wording.

## A. Accounts and sign-in
| ID | Do | Expect |
|---|---|---|
| A1 ★ | Website → **Start free** → sign up with email and password | "Check your inbox". A confirmation email arrives, and its link signs you in to the dashboard |
| A2 ★ | First sign-in | The consent screen blocks the app until you tick the Terms and Privacy box. The training-data option is **off** unless you tick it |
| A3 | Sign in before confirming the email | "Please verify your email first" |
| A4 | Sign out, then use the browser Back button | No account pages are shown; you're asked to sign in |
| A5 | **Forgot password?** → email link → new password → sign in | Works. The old password no longer works |
| A6 | **Continue with Google**, on desktop and phone | Signs in. A new account sees the consent screen |
| A7 | **Continue with Apple**, on an iPhone (Safari) and in the iOS app | Signs in, including with "Hide my email" |
| A8 | Account → Security → **Enable two-factor**: scan the QR code, enter a code | Enabled. Signing in again asks for a 6-digit code; a wrong code is refused |
| A9 | Remove two-factor | Next sign-in doesn't ask for a code |
| A10 | Mobile app: sign in with email, Google and Apple | Same as on the web. The same account shows the same history on both |
| A11 | Mobile: Account → **Sign out of all devices** | Other devices can't renew their sign-in: the website asks you to sign in again within about an hour, once its current sign-in token expires |

## B. Scanning (website)
Use real slabs. Do each on desktop (uploading photos) and on a phone browser (camera).

| ID | Do | Expect |
|---|---|---|
| B1 ★ | Quick scan, **In hand**: front, back, **Read label** | Each photo shows "Photo looks good" or a clear tip. The cert number and grader are filled in from the label; check every digit |
| B2 ★ | Confirm → **Analyze (quick scan)** | A progress bar, then a report within about a minute. One verification used (the count on the scan page drops by 1) |
| B3 | Upload a blurry photo, a photo with strong glare, and one with an edge cut off | Specific retake guidance. **No credit used** |
| B4 | Phone browser: **Live camera** | Camera opens with an outline and hints. Captures when steady and framed |
| B5 | Tick **Deep check**: tilt video, backlit label (PSA), edges, UV, security close-up | Each upload is accepted or gets clear guidance. The tilt video reports "distinct frames extracted" |
| B6 | Add a **reference image** without choosing where it's from, then with | Upload is blocked until you choose; the report labels it **user-supplied** |
| B7 | **Online listing** mode with marketplace photos and an asking price | The report says it describes the photos only, and can't confirm the seller has the slab |
| B8 | A slab whose number is hard to read (older label, glare) | No guessed number: you're asked to type it. Typing it works |
| B9 | Trading-card and other categories (Pokémon, sealed, etc.) | The category shows its support level (supported / beta / limited), and limited checks are explained |
| B10 | From a report: **Add photos / retake**, then analyze again | **No extra credit** used. The report history shows both assessments |
| B11 | Click **Analyze** twice quickly, or in two tabs | One analysis, one credit |
| B12 | Start a scan, leave, come back from the dashboard ("Draft scan") | Continues where you left off |

## C. Reports
| ID | Do | Expect |
|---|---|---|
| C1 ★ | Read a report on a genuine slab | The headline, photo quality table, findings, official verification link and recommended next action all make sense, and the wording is easy to understand |
| C2 ★ | **Wording check** on every report you see | Never says a slab is "real", "fake", "authentic" or "counterfeit" as a verdict. It describes consistency, what couldn't be checked, and how confident it is |
| C3 | Report on a known counterfeit or altered slab (if available) | Findings point to the problem, or the report clearly says what it couldn't check. **Record every miss**: it's the most important accuracy data |
| C4 | **Open official lookup** | Opens the grader's real cert page for that number |
| C5 | Market value section, with and without a grade entered | Shows a range, or "no estimate yet", never a made-up number |
| C6 ★ | **Share**, then open the link in a private window | The report shows **without photos, your name or email**. The link works signed out |
| C7 | Pro account: **Download PDF** | The PDF opens and matches the report. Free account: the button says "PDF (Pro)" and goes to plans |
| C8 | Pro account: **Plain-language explanation** | A readable summary that matches the findings, labelled as AI-assisted or rule-based |
| C9 | History page: open older reports. Power plan: search, bulk queue and batch download | All reports are listed. Lower plans see that search is a Power feature, and no bulk tools |

## D. Plans and billing (Stripe test mode)
| ID | Do | Expect |
|---|---|---|
| D1 ★ | Free account, use up all 3 scans, then try a 4th | An upgrade prompt instead of a report. No charge or credit taken |
| D2 ★ | Plans → **Upgrade** to Collector Pro monthly, with card 4242… | Stripe checkout, then back to the app with Pro features and 30 verifications |
| D3 | Upgrade with the declined card, then the 3-D Secure card | Declined: clear error, plan unchanged. 3-D Secure: approval step, then success |
| D4 | Annual price | Shows the yearly price. The allowance still renews monthly |
| D5 | Account → **Manage subscription** → cancel | You keep Pro until the end of the period, then go back to Free with your history kept. Check the end date in the Stripe dashboard. To see the switch to Free without waiting, use a Stripe **test clock** |
| D6 | Upgrade Pro → Power, and downgrade Power → Pro | Allowance and features change as described on the plans page |
| D7 | In the Stripe dashboard, **refund** a test payment | The plan and allowance update (may take a minute) |
| D8 | Mobile: paywall → subscribe with a **sandbox** account (iOS and Android) | The store sheet shows the right price. After purchase, Pro shows in the app **and on the website** for the same account |
| D9 | Mobile: delete and reinstall, then **Restore purchases** | The subscription comes back |
| D10 | Website, signed in with a mobile subscriber | Plans page says the subscription is managed in the App Store or Google Play, with no Stripe buttons |

## E. Account and privacy
| ID | Do | Expect |
|---|---|---|
| E1 | Account → **Download my data** | A zip with your account, consent history, sessions and reports. Nothing from anyone else |
| E2 | Turn the training-data option on, then off | Saved. "No" doesn't limit any feature |
| E3 ★ | **Privacy between users:** user 2 opens user 1's report link (`/sessions/…`) and a photo link | "Not found". User 2 never sees user 1's photos or reports |
| E4 | Upload a photo taken on a phone with location on; then download your data or the photo | No GPS location in the stored file (check with an EXIF viewer) |
| E5 | **Delete account** (type DELETE), with an active Stripe test subscription | Signed out; signing in again starts a new account. The Stripe subscription is canceled. Old share links stop working |
| E6 | Footer: Terms, Privacy, Notice at collection, **Your privacy choices** | All open, readable on a phone, and marked as drafts until legal review |

## F. Mobile apps
Run on a recent **and** an older phone, for each platform.

| ID | Do | Expect |
|---|---|---|
| F1 ★ | Install **SlabGuard Staging** (`docs/MOBILE_BUILDS.md`), open it, sign in | Home shows your plan and history. Account's last line says "staging build" and the staging address |
| F2 ★ | **Scan new slab** with the live camera | The camera opens. Hints change as you move and tilt. The box overlay lines up with the slab. It auto-captures when well lit and steady |
| F3 | Deny camera permission the first time, then allow it in Settings | A clear explanation and a way to retry. No crash |
| F4 | Backlit and UV shots; record a tilt video | They unlock and upload. The video is accepted (no sound recorded) |
| F5 | Full scan → report screen → **Share report link** | Same report as on the web |
| F6 | **Improve this report**: add a requested capture | Re-analyzes with no extra credit |
| F7 | Switch apps or lock the phone mid-scan, then come back | Picks up where you were, or explains what happened |
| F8 | Poor network: slow Wi-Fi, flight mode during upload | A clear error and a retry. No duplicate scans or credits |
| F9 | Largest text size and dark mode | Everything readable. Nothing cut off |
| F10 | Account: privacy policy, download data (opens the website), sign out | All work |

## G. Website on different browsers and screens
| ID | Do | Expect |
|---|---|---|
| G1 | Smoke tests in Chrome, Safari, Firefox and Edge | Same behaviour everywhere |
| G2 | Phone width (iPhone SE size and a large Android) | No sideways scrolling except wide tables. Buttons easy to tap |
| G3 | Browser zoom at 200% | Usable. Nothing overlaps |
| G4 | Dark mode (system setting) | Readable, with good contrast |

## H. Accessibility (screen readers)
Ideally done by, or with, someone who uses a screen reader daily. See `docs/ACCESSIBILITY.md`.

| ID | Do | Expect |
|---|---|---|
| H1 | **VoiceOver** on iPhone: sign up, scan, read a report, upgrade, in the app and in Safari | Every control has a sensible name. Progress and errors are announced. The report's headline, findings and uncertainty make sense when heard |
| H2 | **TalkBack** on Android: same flows | Same |
| H3 | **NVDA** (Windows) or VoiceOver (Mac) on the website | Same. "Skip to main content" works. Tables are navigable |
| H4 | Website with the keyboard only | Every action reachable. Focus always visible |

## I. Staff tools
Sign in as staff. Two-factor is required for staff tools.

| ID | Do | Expect |
|---|---|---|
| I1 | Open Staff tools without two-factor, then with it (sign in again after enabling) | Without: a message that staff tools require two-factor. With: access |
| I2 | Normal user opens `/admin` | Refused |
| I3 | Staff tools → **Staff roles**: give the second account a role | Saved and listed. A "staff role changed" alert, if Grafana is connected |
| I4 | **Reference library → Submit a template** with a verified genuine slab photo; approve it as the **other** staff member | Submitter can't approve their own template. After approval it's active and appears in coverage |
| I5 | **Quality**: label a report (genuine / counterfeit), view accuracy and releases | Saved. Accuracy updates |
| I6 | **Reference library** (categories and graders): edit a draft, publish, roll back | Each change is recorded. Users see the published version only |
| I7 | **Unit economics** page | Numbers look sane for the test activity |

## J. Security spot checks
| ID | Do | Expect |
|---|---|---|
| J1 | Change a share link's last characters | "Not found". Never someone else's report |
| J2 | Upload a non-image file renamed to `.jpg`, and a very large image | Refused with a clear message |
| J3 | Keep a page open for over an hour, then use it | Either still works or asks you to sign in. No confusing errors |
| J4 | Website address bar shows a lock; `http://` redirects to `https://` | Yes |

## After a full pass
- **Grafana** (if connected): no unexplained error spikes, the analysis queue drained, no `CspViolations` alert.
- **Staff tools → Quality:** label the reports from known slabs, so accuracy figures use real data.
- **Collect** all bugs with their severity. Fix every blocker and major, then re-run those tests and the smoke tests.

## Ready to launch when
- No open **blocker** or **major** bugs.
- Every ★ test passes on the latest staging deploy, on desktop, iPhone and Android.
- Billing (section D) passes on web, iOS and Android sandboxes.
- The screen-reader session (H1–H3) is done, and its findings are fixed or scheduled.
- Every miss on a known counterfeit (C3) is recorded and reviewed.
- The other items in `docs/LAUNCH_CHECKLIST.md` are done (legal review, pen test, production setup).

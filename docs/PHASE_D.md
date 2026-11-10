# Phase D — Capture quality gate & tiered flow (done 2026-11-10)

| Requirement | Delivered |
|---|---|
| Front **and** back required | Enforced server-side before any credit is reserved (also in bulk), in the web wizard (Continue disabled) and on mobile (back step no longer skippable) |
| Real-time checks before acceptance (web) | Live camera analyzes each downscaled frame on-device: all four edges inside the frame, fill, tilt/keystone, frame-to-frame motion, motion-blur anisotropy, glare, exposure, focus and **label-region sharpness**; detected outline drawn on screen; specific guidance ("Move back", "Hold the phone parallel", "Focus on the label"…); **auto-capture** after ~1 s of passing checks (toggle). Unit-tested (`lib/client/frame-analysis.ts`) |
| Server quality gate | Adds **motion-blur** detection (directional smear vs. defocus) and **label sharpness** (warped label region; separate check for label close-ups). Rejects with a specific reason; never silently accepts |
| Per-image quality in the report | "Photo quality" table: score, issues, near-duplicates, and **which checks each photo's quality limited** |
| Tiered flow | **Quick scan** by default (category → front/back → optional label close-up → confirm → analyze). **Deep check** (holograms/tilt video, UV, edges, microprint, reference image) when opted in at the start or recommended by the report ("Start deep check", free re-analysis) |
| One-screen summary | Top of every report (web, mobile, PDF data): **Verified · Looks inconsistent · Can't see from these photos · Ask / photograph next** (listing mode phrases asks for the seller), plus a deep-check recommendation |
| Category-specific guidance | From the reference library (Phase B) in web and mobile |

**Mobile feasibility finding:** true per-frame analysis on iOS/Android needs camera frame processors (e.g. react-native-vision-camera with worklets in a development build); Expo's image picker launches the system camera, which can't show overlays or expose frames. Mobile today uses the system camera + immediate server quality check with specific retake guidance + live-capture codes. Recommended follow-up: adopt vision-camera frame processors and port `frame-analysis.ts`.

**Thresholds** (fill, tilt, motion, anisotropy, label sharpness) are initial values to be tuned with real phone footage.

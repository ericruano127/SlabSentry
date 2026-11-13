# Mobile live camera (iOS & Android)

The in-app camera now gives the same real-time guidance as the web camera. It uses the same code: `@slabguard/core/capture`.

## How it works
- **Camera library:** `react-native-vision-camera` 5.2.4, which is Nitro-based. It is installed with `react-native-vision-camera-worklets`, `react-native-worklets` 0.13.0 (the version Expo SDK 58 pins), `react-native-nitro-modules` and `react-native-nitro-image`.
- **Frame processor:** a frame processor (worklet) runs on the camera thread at about 4 checks a second. Each check:
  - takes the **luminance (Y) plane** of a 640×480 YUV frame;
  - downscales it to 240 px wide (`fromLuma`; video-range luma 16–235 is expanded to 0–255);
  - runs `analyzeFrame`.

  Only the small result object is sent to the UI thread (`scheduleOnRN`). Frames are always disposed.
- **Checks.** These are identical to the web camera:
  - **All shots:** steadiness (motion and motion-blur direction), focus, light and glare.
  - **Whole-slab shots** (front and back) add: all four edges in frame, size, a straight-on angle (keystone) and label sharpness.
  - **Blacklight and backlit shots** use a `lowlight` target that skips the light and glare checks, because darkness is expected there. The same fix now applies on the web: UV photos previously could never pass the "too dark" check.
- **Capture:**
  - The Capture button unlocks after about 0.75 s of passing checks.
  - Auto-capture fires after about 1 s. It happens once per opening and can be switched off.
  - Photos are 4:3 at up to 12 MP (`capturePhotoToFile`).
  - Tilt videos are 4 s MP4 clips with no audio.
- **Live capture code.** In-app captures still request the single-use code, so the report can note a live in-app capture. Library picks never get one.
- **Fallbacks:**
  - If permission is denied, the screen offers Settings, or choosing a saved photo.
  - If there is no camera or a camera error occurs, it offers the system camera (the previous behaviour).
  - Frames in unsupported formats (for example 10-bit) skip guidance; manual capture still works.
- **Accessibility:**
  - Hints are a polite live region.
  - "Ready to capture" is announced.
  - All buttons are at least 48 pt with labels.

## Building
VisionCamera and Nitro are native modules, so **Expo Go can't run this screen**. Use a development build:

```bash
cd apps/mobile && npx expo prebuild
```

```bash
npx expo run:ios
```

```bash
npx expo run:android
```

EAS Build works as well (`eas build --profile development`); for testers, use the staging build. Both are described in `docs/MOBILE_BUILDS.md`. Camera permission strings are already in `app.json`. No microphone permission is needed because audio is off.

## Verified here vs. on devices
**Verified in this environment:**
- Typecheck.
- Metro bundles for iOS and Android.
- The bundle shows the worklets plugin compiled the shared functions as worklets. The frame processor captures `fromLuma`/`analyzeFrame`, which capture their helpers.
- Unit tests of the checks, including a padded full-resolution luma plane giving the same verdict as the reference frame.
- Analysis cost: about 4.5 ms per frame with a JIT and about 32 ms with the JIT disabled on a desktop CPU. Expect roughly 40–100 ms on a phone running Hermes. With `dropFramesWhileBusy`, that only skips analysis frames, never preview or photo frames.

**Not verified here:** running on a real iPhone or Android phone. No simulator or device is available in this environment.

Before release, test on at least one recent and one older device per platform:
- does auto-capture trigger on a well-lit slab?
- do the hints change while moving and tilting?
- does the box overlay line up?
- do UV and backlit shots unlock?
- does the tilt video upload?

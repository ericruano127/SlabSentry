# Mobile builds (iOS and Android)

How to build the SlabGuard app and get it onto testers' phones, using **EAS Build**, Expo's build service. One codebase produces three builds, chosen by the build profile:

| Build | Profile | App name | App ID | Talks to | Who gets it |
|---|---|---|---|---|---|
| Development | `development` | SlabGuard Dev | `com.slabguard.app.dev` | Your machine or staging | Developers (live reload) |
| Staging | `staging` | SlabGuard Staging | `com.slabguard.app.staging` | Staging | Testers (`docs/MANUAL_TEST_PLAN.md`) |
| Production | `production` | SlabGuard | `com.slabguard.app` | Production | The App Store and Google Play |

**Separate IDs:** each build has its own app ID and its own sign-in link scheme (`slabguard-dev://`, `slabguard-staging://`, `slabguard://`). All three can be installed on one phone, and sign-in always returns to the right app.

**Server settings:** the server address and the public client keys are baked into each build from **EAS environment variables**, so nothing is edited by hand. To check which build a phone has, open **Account**. The last line shows the app version, the build type and the server it talks to (production builds show only the version).

The setup lives in `apps/mobile/app.config.ts` (per-build settings) and `apps/mobile/eas.json` (build profiles). **A staging or production build fails on the build servers if a required setting is missing, or isn't a public `https` address.** You can't accidentally ship a build that points at nothing or at `localhost`.

## One-time setup
1. **Expo account:** create one (free) at expo.dev.
2. **Install the build tool and sign in:**

```bash
npm install -g eas-cli
```

```bash
eas login
```

3. **Link the project:**

```bash
cd apps/mobile && eas init
```

The app config is dynamic, so `eas init` may ask you to add the project ID yourself. If it does, put it in `apps/mobile/app.json` under `expo.extra.eas.projectId` and commit it. The ID isn't secret.

4. **Settings for each environment.** The `staging` profiles use the EAS environment **preview**; `production` uses **production**. Use visibility `plaintext` or `sensitive`, not `secret`: `EXPO_PUBLIC_` values end up inside the app anyway, and these are public client keys. Never put a server secret here: no service-role key, no Stripe secret key.

| Variable | Staging (preview) | Production |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | `https://slabsentry-staging-web.fly.dev` (or your staging domain) | Your production domain |
| `EXPO_PUBLIC_SUPABASE_URL` | The **staging** Supabase project URL | The production project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Staging project's anon (publishable) key | Production anon key |
| `EXPO_PUBLIC_RC_APPLE_KEY`, `EXPO_PUBLIC_RC_GOOGLE_KEY` | Optional: RevenueCat **public** SDK keys for sandbox purchases. Without them the plans screen shows no store plans | **Required** |

For example:

```bash
eas env:create --environment preview --name EXPO_PUBLIC_API_URL --value https://slabsentry-staging-web.fly.dev --visibility plaintext
```

Repeat for each variable, or use the project's **Environment variables** page on expo.dev.

5. **Supabase (staging project; later the same for production with `slabguard://`):**
   - **Authentication → URL Configuration → Redirect URLs:** add `slabguard-staging://**`, for email confirmation links and Google sign-in.
   - **Sign in with Apple** (Authentication → Providers → Apple): add `com.slabguard.app.staging` to the client IDs. Native Apple sign-in identifies the app by its app ID.

6. **Apple (for iPhone builds):** you need an Apple Developer account ($99/year).
   - On the first iOS build, let EAS create the certificates and register the app IDs. It asks to sign in to your Apple account.
   - Turn on the **Sign in with Apple** capability for each app ID (EAS normally does this from `usesAppleSignIn`).

## Staging build on Android (no Google Play account needed)

```bash
cd apps/mobile && eas build --profile staging --platform android
```

When it finishes, EAS shows a link and a QR code to an installable APK. On the phone, open it, allow installing from that source when asked, and install **SlabGuard Staging**. Share the same link with other Android testers.

## Staging build on iPhone
There are two ways. Ad hoc is quickest for a few phones; TestFlight is easier for more testers.

**A. Ad hoc (up to 100 registered iPhones):**
1. Register each tester's iPhone **before** building. Send the tester the link this command prints; it installs a profile that registers the phone:

```bash
eas device:create
```

2. Build. EAS includes all registered phones:

```bash
eas build --profile staging --platform ios
```

3. Testers open the link EAS gives and install. If you register a new phone later, run the build again.

**B. TestFlight:**
1. In App Store Connect, create an app record **"SlabGuard Staging"** with app ID `com.slabguard.app.staging`.
2. Build and send it to TestFlight:

```bash
eas build --profile staging-testflight --platform ios --auto-submit
```

3. Add testers in App Store Connect → TestFlight. Internal testers get it right away. External testers need a short Apple review the first time.

## Development builds
For working on the app itself, with live reload against your own machine or staging:

```bash
eas build --profile development --platform android
```

Use `--platform ios` for an iPhone (the phone must be registered with `eas device:create`). Then start the bundler, pointing at a server:

```bash
cd apps/mobile && EXPO_PUBLIC_API_URL=https://slabsentry-staging-web.fly.dev EXPO_PUBLIC_SUPABASE_URL=<staging Supabase URL> EXPO_PUBLIC_SUPABASE_ANON_KEY=<staging anon key> npx expo start --dev-client
```

The **development** EAS environment can hold these values instead. `eas env:pull --environment development` writes them to a local `.env` file, which git ignores.

The live camera needs a development or staging build. Expo Go can't run it (`docs/MOBILE_CAMERA.md`).

## Production builds and store submission
Once the production environment variables are set (including the RevenueCat keys) and the store records exist:

```bash
eas build --profile production --platform all
```

```bash
eas submit --profile production --platform ios
```

```bash
eas submit --profile production --platform android
```

**Build numbers:** EAS keeps them (`appVersionSource: remote`, `autoIncrement`). Change the user-visible version in `app.json` (`expo.version`).

**Store setup:** Google Play requires the first upload to be done by hand in the Play Console. After that, `eas submit` works. The store listings, screenshots and privacy labels are part of `docs/LAUNCH_CHECKLIST.md` § 5.

## Verified here vs not
**Verified:**
- Expo's own `eas.json` parser accepts all four build profiles on both platforms, and resolves them as intended: internal APK for staging Android; store builds for TestFlight and production; the development client for development.
- `expo config` gives each build type its own name, link scheme and app IDs.
- A staging build **fails on the build servers** (exit code 1) when the server settings are missing. Locally it warns with the exact problem, for example a `localhost` address.
- A staging Android bundle exports with the staging server address baked in.
- The mobile type check passes.

**Not verified:** a real EAS build, installing on phones, Apple and Supabase sign-in with the staging app ID, and RevenueCat sandbox purchases. These need your Expo, Apple and Google accounts. Expo's servers aren't reachable from this development environment.

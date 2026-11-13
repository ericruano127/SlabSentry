import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * One app, three builds, chosen by APP_VARIANT (set per build profile in eas.json):
 *  - development: dev client, connects to your machine or staging      "SlabGuard Dev"
 *  - staging:     installable test build that talks to staging          "SlabGuard Staging"
 *  - production:  the store app                                         "SlabGuard"
 * Each has its own app ID and link scheme, so all three can be installed side by side and sign-in
 * redirects return to the right one. app.json holds the shared settings (and the EAS project id).
 *
 * Server address and public client keys come from EXPO_PUBLIC_* variables (EAS environment variables
 * per environment; see docs/MOBILE_BUILDS.md) and are baked into the build. They are public by nature
 * (anon/publishable keys); never put a secret here.
 */
type Variant = "development" | "staging" | "production";

const VARIANTS: Record<Variant, { name: string; id: string; scheme: string }> = {
  development: { name: "SlabGuard Dev", id: "com.slabguard.app.dev", scheme: "slabguard-dev" },
  staging: { name: "SlabGuard Staging", id: "com.slabguard.app.staging", scheme: "slabguard-staging" },
  production: { name: "SlabGuard", id: "com.slabguard.app", scheme: "slabguard" },
};

export function variantFrom(env: NodeJS.ProcessEnv): Variant {
  const v = env.APP_VARIANT ?? "development";
  if (!(v in VARIANTS)) throw new Error(`APP_VARIANT must be development, staging or production (got "${v}")`);
  return v as Variant;
}

/** Settings a build can't work without. Staging and production must point at real https servers. */
export function configProblems(variant: Variant, env: NodeJS.ProcessEnv): string[] {
  if (variant === "development") return [];
  const problems: string[] = [];
  const https = (name: string) => {
    const v = env[name];
    if (!v) problems.push(`${name} is not set`);
    else if (!/^https:\/\//.test(v) || /localhost|127\.0\.0\.1|YOUR-/i.test(v)) problems.push(`${name} must be a public https address (got "${v}")`);
  };
  https("EXPO_PUBLIC_API_URL");
  https("EXPO_PUBLIC_SUPABASE_URL");
  if (!env.EXPO_PUBLIC_SUPABASE_ANON_KEY) problems.push("EXPO_PUBLIC_SUPABASE_ANON_KEY is not set");
  if (variant === "production") {
    if (!env.EXPO_PUBLIC_RC_APPLE_KEY) problems.push("EXPO_PUBLIC_RC_APPLE_KEY is not set (in-app purchases on iOS)");
    if (!env.EXPO_PUBLIC_RC_GOOGLE_KEY) problems.push("EXPO_PUBLIC_RC_GOOGLE_KEY is not set (in-app purchases on Android)");
  }
  return problems;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const env = process.env;
  const variant = variantFrom(env);
  const v = VARIANTS[variant];
  const problems = configProblems(variant, env);
  if (problems.length) {
    const msg = `SlabGuard ${variant} build settings:\n - ${problems.join("\n - ")}\nSee docs/MOBILE_BUILDS.md.`;
    // Fail on the build servers, so a build that can't reach its servers is never produced;
    // locally just warn, so `eas build` can resolve the config before it uploads.
    if (env.EAS_BUILD === "true") throw new Error(msg);
    console.warn(msg);
  }
  return {
    ...config,
    name: v.name,
    slug: config.slug ?? "slabguard",
    scheme: v.scheme,
    ios: { ...config.ios, bundleIdentifier: v.id },
    android: { ...config.android, package: v.id },
    extra: {
      ...config.extra,
      variant,
      apiUrl: env.EXPO_PUBLIC_API_URL ?? "",
      supabaseUrl: env.EXPO_PUBLIC_SUPABASE_URL ?? "",
      supabaseAnonKey: env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
      revenuecatAppleKey: env.EXPO_PUBLIC_RC_APPLE_KEY ?? "",
      revenuecatGoogleKey: env.EXPO_PUBLIC_RC_GOOGLE_KEY ?? "",
    },
  };
};

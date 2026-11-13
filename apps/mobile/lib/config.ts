import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
export const config = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? extra.apiUrl,
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? extra.supabaseUrl,
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? extra.supabaseAnonKey,
  revenuecatAppleKey: process.env.EXPO_PUBLIC_RC_APPLE_KEY ?? extra.revenuecatAppleKey,
  revenuecatGoogleKey: process.env.EXPO_PUBLIC_RC_GOOGLE_KEY ?? extra.revenuecatGoogleKey,
  /** development | staging | production (app.config.ts). */
  variant: (extra.variant ?? "development") as "development" | "staging" | "production",
  /** App version from app.json, shown on the Account screen for bug reports. */
  appVersion: Constants.expoConfig?.version ?? "",
};

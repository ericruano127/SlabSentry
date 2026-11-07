"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const DEV_AUTH = process.env.NEXT_PUBLIC_AUTH_MODE === "dev";

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient | null {
  if (!url || !key) return null;
  return (client ??= createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" } }));
}

export function devSignIn() {
  let id = localStorage.getItem("dev_user");
  if (!id) localStorage.setItem("dev_user", (id = crypto.randomUUID()));
  document.cookie = `dev_user=${id}; path=/; samesite=lax`;
}
export function devSignOut() {
  document.cookie = "dev_user=; path=/; max-age=0";
}
export function hasDevSession() {
  return typeof document !== "undefined" && /(?:^|; )dev_user=/.test(document.cookie);
}

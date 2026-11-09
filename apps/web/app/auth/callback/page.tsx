"use client";
import { useEffect } from "react";
import { supabase } from "@/lib/client/supabase";

/** OAuth / email-verification landing. supabase-js exchanges the PKCE code from the URL. */
export default function Callback() {
  useEffect(() => {
    const next = new URLSearchParams(location.search).get("next") ?? "/dashboard";
    const safe = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
    const sb = supabase();
    if (!sb) return void (location.href = "/login");
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session) return void (location.href = "/login");
      const aal = (await sb.auth.mfa.getAuthenticatorAssuranceLevel()).data;
      location.href = aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2" ? `/login?mfa=1&next=${encodeURIComponent(safe)}` : safe;
    });
  }, []);
  return <p className="muted">Signing you in…</p>;
}

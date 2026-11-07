"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/client/supabase";

export default function ResetPassword() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [msg, setMsg] = useState("");
  const sb = supabase();
  useEffect(() => {
    const { data } = sb?.auth.onAuthStateChange((e) => e === "PASSWORD_RECOVERY" && setRecovery(true)) ?? { data: null };
    return () => data?.subscription.unsubscribe();
  }, [sb]);
  if (!sb) return <div className="banner bad">Authentication is not configured.</div>;
  return (
    <div className="card" style={{ maxWidth: 440, margin: "24px auto" }}>
      <h1>{recovery ? "Choose a new password" : "Reset password"}</h1>
      {recovery ? (
        <form onSubmit={async (e) => { e.preventDefault(); const { error } = await sb.auth.updateUser({ password: pw }); setMsg(error ? error.message : "Password updated. You can now sign in."); }}>
          <div className="field"><label htmlFor="pw">New password</label><input id="pw" type="password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></div>
          <button className="btn primary block" style={{ marginTop: 12 }}>Update password</button>
        </form>
      ) : (
        <form onSubmit={async (e) => { e.preventDefault(); await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/reset-password` }); setMsg("If an account exists for that email, a reset link is on its way."); }}>
          <div className="field"><label htmlFor="email">Email</label><input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></div>
          <button className="btn primary block" style={{ marginTop: 12 }}>Send reset link</button>
        </form>
      )}
      {msg && <div className="banner" style={{ marginTop: 12 }} role="status">{msg}</div>}
    </div>
  );
}

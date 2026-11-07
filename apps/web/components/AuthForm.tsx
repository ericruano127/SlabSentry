"use client";
import Link from "next/link";
import { useState } from "react";
import { DEV_AUTH, devSignIn, supabase } from "@/lib/client/supabase";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ tone: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const sb = supabase();
  const next = typeof window !== "undefined" ? new URLSearchParams(location.search).get("next") ?? "/dashboard" : "/dashboard";
  const redirectTo = typeof window !== "undefined" ? `${location.origin}/auth/callback?next=${encodeURIComponent(mode === "signup" ? "/dashboard?welcome=1" : next)}` : undefined;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!sb) return;
    setBusy(true);
    setMsg(null);
    if (mode === "signup") {
      const { error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
      setMsg(error ? { tone: "bad", text: error.message } : { tone: "ok", text: "Check your inbox to verify your email, then sign in. Your first three slab verifications are free." });
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) setMsg({ tone: "bad", text: error.message.includes("confirm") ? "Please verify your email first — check your inbox." : error.message });
      else location.href = next;
    }
    setBusy(false);
  }
  const oauth = (provider: "google" | "apple") => sb?.auth.signInWithOAuth({ provider, options: { redirectTo } });

  return (
    <div className="card" style={{ maxWidth: 440, margin: "24px auto" }}>
      <h1>{mode === "signup" ? "Create your free account" : "Welcome back"}</h1>
      <p className="muted">{mode === "signup" ? "3 free slab verifications. No credit card required." : "Sign in to continue verifying slabs."}</p>
      {!sb && !DEV_AUTH && <div className="banner bad">Authentication is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.</div>}
      {sb && (
        <>
          <div className="stack">
            <button className="btn block" onClick={() => oauth("apple")}> Continue with Apple</button>
            <button className="btn block" onClick={() => oauth("google")}>Continue with Google</button>
          </div>
          <p className="muted small" style={{ textAlign: "center", margin: "14px 0" }}>or use email</p>
          <form onSubmit={submit}>
            <div className="field"><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="field"><label htmlFor="pw">Password</label><input id="pw" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
            <button className="btn primary block" style={{ marginTop: 16 }} disabled={busy}>{mode === "signup" ? "Create account" : "Sign in"}</button>
          </form>
        </>
      )}
      {DEV_AUTH && (
        <button className="btn block" style={{ marginTop: 12 }} onClick={() => { devSignIn(); location.href = mode === "signup" ? "/dashboard?welcome=1" : next; }}>
          Continue as local dev user
        </button>
      )}
      {msg && <div className={`banner ${msg.tone}`} style={{ marginTop: 14 }} role="status">{msg.text}</div>}
      <p className="small" style={{ marginTop: 16 }}>
        {mode === "signup" ? <>Already have an account? <Link href="/login">Sign in</Link></> : <>New here? <Link href="/signup">Create a free account</Link> · <Link href="/reset-password">Forgot password?</Link></>}
      </p>
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import { DEV_AUTH, supabase } from "@/lib/client/supabase";

/** TOTP two-factor enrollment via Supabase Auth MFA. Staff accounts must enable it. */
export function MfaSettings({ required }: { required: boolean }) {
  const sb = supabase();
  const [factors, setFactors] = useState<any[]>([]);
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const load = async () => setFactors((await sb?.auth.mfa.listFactors())?.data?.totp ?? []);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!sb) {
    return DEV_AUTH ? (
      <div className="small">
        <p className="muted">Two-factor authentication uses Supabase Auth and isn't available in local dev mode.</p>
        <button className="btn" onClick={() => { document.cookie = `dev_aal=${document.cookie.includes("dev_aal=aal2") ? "aal1" : "aal2"}; path=/; samesite=lax`; location.reload(); }}>
          {typeof document !== "undefined" && document.cookie.includes("dev_aal=aal2") ? "Dev: simulate no 2FA" : "Dev: simulate verified 2FA"}
        </button>
      </div>
    ) : null;
  }
  const verified = factors.filter((f) => f.status === "verified");
  return (
    <div className="stack">
      {required && !verified.length && <div className="banner warn">Your staff role requires two-factor authentication.</div>}
      {verified.length ? (
        <div className="row spread"><span>✓ Authenticator app enabled</span>
          <button className="btn danger" onClick={async () => { for (const f of verified) await sb.auth.mfa.unenroll({ factorId: f.id }); setMsg("Two-factor authentication removed."); load(); }} disabled={required}>Remove</button></div>
      ) : enroll ? (
        <div className="stack">
          <p className="small">Scan this QR code with an authenticator app (1Password, Google Authenticator, Authy), then enter the 6-digit code.</p>
          <img src={enroll.qr} alt="Authenticator QR code" style={{ width: 180, height: 180, background: "#fff", borderRadius: 8 }} />
          <p className="small muted">Or enter this key manually: <code>{enroll.secret}</code></p>
          <div className="row"><input aria-label="6-digit code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} style={{ maxWidth: 140 }} />
            <button className="btn primary" disabled={code.length !== 6} onClick={async () => {
              const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: enroll.id, code });
              if (error) setMsg(error.message); else { setEnroll(null); setMsg("Two-factor authentication is on."); load(); }
            }}>Verify</button></div>
        </div>
      ) : (
        <button className="btn" onClick={async () => {
          const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
          if (error || !data) setMsg(error?.message ?? "Could not start enrollment"); else setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
        }}>Enable two-factor authentication</button>
      )}
      {msg && <p className="small" role="status">{msg}</p>}
    </div>
  );
}

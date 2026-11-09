"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { hasDevSession, supabase } from "@/lib/client/supabase";
import { Markdown } from "./Markdown";

/**
 * Blocks the app until the current Terms + Privacy are accepted (re-shown when a new version is
 * published). Training consent is a separate, unticked, optional choice.
 */
export function ConsentGate() {
  const [status, setStatus] = useState<any>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [agree, setAgree] = useState(false);
  const [training, setTraining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const check = useCallback(async () => {
    const signedIn = hasDevSession() || !!(await supabase()?.auth.getSession())?.data.session;
    if (!signedIn) return;
    const st = await api("/api/consent").catch(() => null);
    if (st?.required) {
      setStatus(st);
      setDocs((await api("/api/legal")).documents);
    } else setStatus(null);
  }, []);

  useEffect(() => {
    check();
    const on = () => check();
    window.addEventListener("consent-required", on);
    return () => window.removeEventListener("consent-required", on);
  }, [check]);

  if (!status) return null;
  const notice = docs.find((d) => d.kind === "data_collection");
  const updated = !!status.terms.accepted;
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="consent-title" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 60, display: "grid", placeItems: "center", padding: 16 }}>
      <div className="card stack" style={{ maxWidth: 720, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <h2 id="consent-title">{updated ? "We've updated our terms" : "Before you start"}</h2>
        <p>Slab Guard reports are <strong>guidance, not a guarantee of authenticity</strong>. Here's what we collect and why:</p>
        {notice && <div className="small"><Markdown text={notice.body} /></div>}
        {status.pendingLegalReview && <p className="small muted">These documents are drafts pending legal review.</p>}
        <label className="row" style={{ fontWeight: 400, alignItems: "flex-start" }}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ width: 22, minHeight: 22, marginTop: 2 }} />
          <span>I agree to the <Link href="/legal/terms" target="_blank">Terms of Service</Link> (v{status.terms.current}) and the <Link href="/legal/privacy" target="_blank">Privacy Policy</Link> (v{status.privacy.current}).</span>
        </label>
        {status.training.current && (
          <label className="row" style={{ fontWeight: 400, alignItems: "flex-start" }}>
            <input type="checkbox" checked={training} onChange={(e) => setTraining(e.target.checked)} style={{ width: 22, minHeight: 22, marginTop: 2 }} />
            <span><strong>Optional:</strong> let my future uploads be used to improve counterfeit detection (<Link href="/legal/training-consent" target="_blank">details</Link>). Saying no doesn't limit any feature, and you can change this anytime.</span>
          </label>
        )}
        {err && <div className="banner bad">{err}</div>}
        <button className="btn primary" disabled={!agree || busy} onClick={async () => {
          setBusy(true); setErr(null);
          try {
            await api("/api/consent", { method: "POST", json: { terms: status.terms.current, privacy: status.privacy.current, ...(status.training.current && !status.training.granted ? { training } : {}) } });
            setStatus(null);
            location.reload();
          } catch (e: any) { setErr(e.message); await check(); } finally { setBusy(false); }
        }}>{busy ? "Saving…" : "Agree and continue"}</button>
      </div>
    </div>
  );
}

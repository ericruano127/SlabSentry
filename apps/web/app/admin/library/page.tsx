"use client";
import Link from "next/link";
import { useState } from "react";
import { fmtDate, Pill } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";

/** Reference library releases: draft → validate → publish (audited, hashed, immutable once published). */
export default function LibraryAdmin() {
  const lib = useApi<any>("/api/admin/library");
  const [draftId, setDraftId] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [version, setVersion] = useState("");
  const [reason, setReason] = useState("");
  const [issues, setIssues] = useState<any[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  if (lib.error?.body?.error === "mfa_required") return <div className="banner warn">Staff tools require two-factor authentication. <Link href="/account">Enable it in Account → Security</Link>.</div>;
  if (lib.error) return <div className="banner bad">{lib.error.message}</div>;
  if (!lib.data) return <p className="muted">Loading…</p>;
  const { releases, published } = lib.data;
  const c = published.content;

  async function openDraft(id: number) {
    const r = await api(`/api/admin/library/${id}`);
    setDraftId(id); setText(JSON.stringify(r.content, null, 2)); setIssues([]); setMsg(null);
  }
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null); setIssues([]);
    try { await fn(); setMsg(ok); lib.reload(); } catch (e: any) { setMsg(e.message); setIssues(e.body?.issues ?? []); }
  };

  return (
    <div className="stack">
      <div className="row spread"><h1>Reference library</h1><Link href="/admin">← Staff tools</Link></div>
      <div className="card">
        <div className="row spread"><div><strong>Published: {published.version}</strong><div className="small muted">sha256 {published.sha256?.slice(0, 16)}…</div></div>
          <div className="small">{c.categories.length} categories · {c.graders.length} graders · {c.generations.length} holder generations · {c.features.length} features · {c.certRanges.length} verified cert ranges</div></div>
      </div>

      <section className="card scroll-x" tabIndex={0} role="region" aria-label="Scrollable table">
        <h2>Categories & graders</h2>
        <table className="table small"><thead><tr><th>Category</th><th>Status</th><th>Graders</th><th>Checks</th></tr></thead>
          <tbody>{c.categories.map((cat: any) => (
            <tr key={cat.id}><td>{cat.name}</td><td><Pill tone={cat.launchStatus === "supported" ? "ok" : "warn"}>{cat.launchStatus}</Pill></td>
              <td>{c.graders.filter((g: any) => g.categories.includes(cat.id)).map((g: any) => `${g.id}${g.status === "research_needed" ? "*" : ""}`).join(", ")}</td>
              <td>{Object.entries(cat.checks).filter(([, v]) => v).map(([k]) => k).join(", ")}</td></tr>
          ))}</tbody></table>
        <p className="small muted">* research needed — official documentation not yet confirmed.</p>
      </section>

      <section className="card scroll-x" tabIndex={0} role="region" aria-label="Scrollable table">
        <h2>Releases</h2>
        <table className="table small"><thead><tr><th>Version</th><th>Status</th><th>Hash</th><th>Published</th><th>Notes</th><th></th></tr></thead>
          <tbody>{releases.map((r: any) => (
            <tr key={r.id}><td>{r.version}</td><td><Pill tone={r.status === "published" ? "ok" : r.status === "draft" ? "warn" : ""}>{r.status}</Pill></td>
              <td><code>{r.content_sha256?.slice(0, 10) ?? "—"}</code></td><td>{fmtDate(r.published_at)}</td><td>{r.notes ?? ""}</td>
              <td>{r.status === "draft" ? <button className="btn" onClick={() => openDraft(r.id)}>Edit</button> : r.status === "retired" ? <button className="btn" disabled={reason.length < 5} title="Enter a reason below" onClick={() => act(() => api(`/api/admin/library/${r.id}/publish`, { method: "POST", json: { reason } }), `Rolled back to ${r.version}`)}>Roll back</button> : null}</td></tr>
          ))}</tbody></table>
        <div className="row" style={{ marginTop: 12 }}>
          <input aria-label="New version" placeholder="New version e.g. 2026.11.2" value={version} onChange={(e) => setVersion(e.target.value)} style={{ maxWidth: 240 }} />
          <button className="btn" disabled={version.length < 3} onClick={() => act(async () => { const d = await api("/api/admin/library", { method: "POST", json: { version } }); await openDraft(d.id); }, `Draft ${version} created from ${published.version}`)}>Create draft</button>
        </div>
      </section>

      {draftId && (
        <section className="card stack">
          <h2>Edit draft</h2>
          <p className="small muted">Validated against the library schema on save and on publish. Published releases can never be edited — publish a new version instead.</p>
          <textarea aria-label="Library JSON" rows={22} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row">
            <button className="btn" onClick={() => act(async () => { let content; try { content = JSON.parse(text); } catch { throw new Error("Not valid JSON"); } await api(`/api/admin/library/${draftId}`, { method: "PUT", json: { content } }); }, "Draft saved and valid.")}>Save & validate</button>
          </div>
        </section>
      )}

      <section className="card stack">
        <h2>Publish</h2>
        <input aria-label="Reason" placeholder="Reason / change summary (required, audited)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="btn primary" disabled={!draftId || reason.length < 5} onClick={() => act(() => api(`/api/admin/library/${draftId}/publish`, { method: "POST", json: { reason } }), "Published. New analyses use this release immediately.")}>Publish open draft</button>
      </section>
      {msg && <div className="banner" role="status">{msg}</div>}
      {issues.length > 0 && <div className="banner bad small"><strong>Validation errors</strong><ul>{issues.map((i, n) => <li key={n}>{(i.path ?? []).join(".")}: {i.message}</li>)}</ul></div>}
    </div>
  );
}

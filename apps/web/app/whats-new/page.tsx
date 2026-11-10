"use client";
import { Markdown } from "@/components/Markdown";
import { fmtDate } from "@/components/ui";
import { useApi } from "@/lib/client/hooks";

/** Public patch notes. Deliberately general: specific detection methods are never published. */
export default function WhatsNew() {
  const { data } = useApi<{ current: string | null; releases: { version: string; published_at: string; public_notes: string }[] }>("/api/releases");
  return (
    <div className="stack" style={{ maxWidth: 760, margin: "0 auto" }}>
      <h1>What's new</h1>
      <p className="muted">Current version: <strong>{data?.current ?? "—"}</strong>. Every report records the version that produced it. We keep notes general on purpose so they don't help counterfeiters.</p>
      {data?.releases.map((r) => (
        <article key={r.version} className="card">
          <div className="row spread"><h2>{r.version}</h2><span className="small muted">{fmtDate(r.published_at)}</span></div>
          <Markdown text={r.public_notes} />
        </article>
      ))}
      {data && !data.releases.length && <p className="muted">No releases published yet.</p>}
    </div>
  );
}

"use client";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { ReportView } from "@/components/ReportView";
import { api, download } from "@/lib/client/api";
import { useApi, type Me } from "@/lib/client/hooks";

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: s, error, reload } = useApi<any>(`/api/sessions/${id}`);
  const me = useApi<Me>("/api/me");
  const [share, setShare] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (s && (s.status === "queued" || s.status === "processing")) {
      const t = setTimeout(reload, 2000);
      return () => clearTimeout(t);
    }
  }, [s, reload]);
  if (error) return <div className="banner bad">{error.message}</div>;
  if (!s) return <p className="muted">Loading…</p>;
  const canPdf = me.data?.usage.features.includes("pdf_export");
  return (
    <div className="stack">
      <div className="row spread">
        <div><h1>{s.title ?? "Verification"}</h1><p className="muted small">{s.mode === "in_hand" ? "In-hand" : "Online listing"} · {s.grader ?? "Grader ?"} {s.certNumber ?? ""}</p></div>
        <div className="row">
          <Link className="btn" href={`/scan?session=${id}`}>Add photos / retake</Link>
          {s.report && (canPdf ? <button className="btn" onClick={() => download(`/api/sessions/${id}/report.pdf`, `slab-report-${id.slice(0, 8)}.pdf`).catch((e) => setErr(e.message))}>Download PDF</button> : <Link className="btn" href="/pricing" title="Collector Pro and up">PDF (Pro)</Link>)}
          {s.report && <button className="btn" onClick={async () => setShare((await api(`/api/sessions/${id}/share`, { method: "POST" })).url)}>Share</button>}
        </div>
      </div>
      {share && <div className="banner" role="status">Share link (no photos or personal data): <a href={share}>{share}</a></div>}
      {err && <div className="banner bad">{err}</div>}
      {(s.status === "queued" || s.status === "processing") && (
        <div className="banner stack" role="status" aria-live="polite">
          <div className="row spread"><strong>{s.progress?.stage ?? "Analyzing your slab"}…</strong><span className="small muted">{s.progress?.percent ?? 0}%</span></div>
          <div className="meter" role="progressbar" aria-valuenow={s.progress?.percent ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label="Analysis progress"><span style={{ width: `${s.progress?.percent ?? 0}%`, transition: "width .4s" }} /></div>
          <span className="small muted">{s.status === "queued" && s.progress?.queueAhead ? `${s.progress.queueAhead} report${s.progress.queueAhead === 1 ? "" : "s"} ahead of yours. ` : ""}You can leave this page — your report will be in History.</span>
        </div>
      )}
      {s.status === "failed" && <div className="banner bad" role="alert">{s.error}</div>}
      {s.report ? <ReportView report={s.report} history={s.assessmentHistory} sessionId={id} canNarrate={me.data?.usage.features.includes("detailed_report")} /> : s.status === "draft" && <p>Not analyzed yet. <Link href={`/scan?session=${id}`}>Continue scan</Link></p>}
    </div>
  );
}

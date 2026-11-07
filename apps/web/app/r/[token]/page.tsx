"use client";
import { use } from "react";
import { ReportView } from "@/components/ReportView";
import { useApi } from "@/lib/client/hooks";

export default function SharedReport({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { data, error } = useApi<{ report: any }>(`/api/share/${token}`);
  if (error) return <div className="banner bad">{error.message}</div>;
  if (!data) return <p className="muted">Loading…</p>;
  return <div className="stack"><h1>Shared verification report</h1><p className="muted small">Photos and personal details are not included in shared reports.</p><ReportView report={data.report} privateImages={false} /></div>;
}

"use client";
import { use } from "react";
import { Markdown } from "@/components/Markdown";
import { useApi } from "@/lib/client/hooks";

const KINDS: Record<string, string> = { terms: "terms", privacy: "privacy", "training-consent": "training_consent", "notice-at-collection": "data_collection" };

export default function LegalPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = use(params);
  const { data } = useApi<{ documents: any[] }>("/api/legal");
  const doc = data?.documents.find((d) => d.kind === KINDS[kind]);
  if (!data) return <p className="muted">Loading…</p>;
  if (!doc) return <p>Document not found.</p>;
  return (
    <article className="card" style={{ maxWidth: 820, margin: "0 auto" }}>
      <h1>{doc.title}</h1>
      <p className="small muted">Version {doc.version}{doc.pendingLegalReview ? " · draft pending legal review" : ""}</p>
      <Markdown text={doc.body} />
    </article>
  );
}

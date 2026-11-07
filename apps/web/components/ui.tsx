"use client";
import Link from "next/link";

export const STATUS: Record<string, { label: string; tone: string }> = {
  consistent: { label: "Consistent", tone: "ok" },
  potential_discrepancy: { label: "Potential discrepancy", tone: "bad" },
  inconclusive: { label: "Inconclusive", tone: "warn" },
  not_visible: { label: "Not visible", tone: "" },
  not_supported_by_device: { label: "Not supported by device", tone: "" },
  not_applicable: { label: "Not applicable", tone: "" },
};
export const ASSESS: Record<string, { label: string; tone: string }> = {
  no_major_conflicts: { label: "No major conflicts detected", tone: "ok" },
  additional_verification_recommended: { label: "Additional verification recommended", tone: "warn" },
  high_risk_inconsistencies: { label: "High-risk inconsistencies detected", tone: "bad" },
  unable_to_assess: { label: "Unable to assess reliably", tone: "" },
};

export const Pill = ({ tone = "", children }: { tone?: string; children: React.ReactNode }) => <span className={`pill ${tone}`}>{children}</span>;

export function AssessmentPill({ value }: { value?: string | null }) {
  if (!value) return <Pill>Draft</Pill>;
  const a = ASSESS[value];
  return <Pill tone={a?.tone}>{a?.label ?? value}</Pill>;
}

export function UpgradePrompt({ reason, compact }: { reason: string; compact?: boolean }) {
  return (
    <div className="banner warn" role="status">
      <div className="row spread">
        <div><strong>{reason}</strong>{!compact && <div className="small muted">Your reports, history and official grader links stay available on every plan.</div>}</div>
        <Link className="btn primary" href="/pricing">See plans</Link>
      </div>
    </div>
  );
}

export function fmtDate(iso?: string | null) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";
}

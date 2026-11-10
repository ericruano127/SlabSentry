import { readFileSync } from "node:fs";
import path from "node:path";
import { compareAccuracy, lintPublicNotes, RULES_VERSION } from "@slabguard/core";
import { one, q, tx } from "./db";
import { env } from "./env";
import { accuracyReport } from "./evaluation";
import { HttpError } from "./http";
import { loadLibrary } from "./library";

/**
 * Releases ("patches") bundle every component that can change a report: rules version, published
 * reference library (version + hash), vision tool versions, app version and models. Each has a public
 * changelog (general, linted so it never reveals detection methods) and an internal one, plus an
 * accuracy snapshot. Publishing is gated: no new missed fakes / no higher weighted cost on the
 * labeled set, unless an owner overrides with a reason. Published releases are immutable.
 */
export async function currentComponents() {
  const lib = await loadLibrary();
  let vision: Record<string, string> = {};
  try {
    const h = await fetch(`${env.visionUrl}/health`, { headers: env.visionKey ? { "x-vision-key": env.visionKey } : {}, signal: AbortSignal.timeout(5000) }).then((r) => r.json());
    vision = h.tools ?? {};
  } catch { /* recorded as unknown */ }
  let app = "unknown";
  try { app = JSON.parse(readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")).version; } catch { /* ignore */ }
  const models = await q(`select name, version from model_registry where status='active' order by name`);
  return { rules: RULES_VERSION, library: { version: lib.meta.version, sha256: lib.meta.sha256 }, vision, app, models };
}

export async function latestPublished() {
  return one(`select * from releases where status='published' order by published_at desc limit 1`);
}

/** Version string recorded on reports: the latest published release if this build matches it. */
export async function reportReleaseVersion() {
  const rel = await latestPublished();
  if (!rel) return "unreleased";
  const lib = await loadLibrary();
  const same = rel.components.rules === RULES_VERSION && rel.components.library?.sha256 === lib.meta.sha256;
  return same ? rel.version : `${rel.version}+unreleased`;
}

export async function createRelease(actor: string, b: { version: string; publicNotes: string; internalNotes: string }) {
  const lint = lintPublicNotes(b.publicNotes);
  if (lint.length) throw new HttpError(400, "public_notes_reveal_methods", "Public notes must stay general.", { issues: lint });
  if (await one(`select 1 from releases where version=$1`, [b.version])) throw new HttpError(409, "version_exists", "That version already exists.");
  const components = await currentComponents();
  const accuracy = await accuracyReport("replay");
  const prev = await latestPublished();
  const gate = { ...compareAccuracy(prev?.accuracy ?? null, accuracy), comparedTo: prev?.version ?? null, note: "Replay re-runs the rules engine on stored inputs; vision tool changes require re-analysing the labeled images." };
  return one(
    `insert into releases (version,components,public_notes,internal_notes,accuracy,gate,created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id, version, gate`,
    [b.version, JSON.stringify(components), b.publicNotes, b.internalNotes, JSON.stringify(accuracy), JSON.stringify(gate), actor],
  );
}

export async function publishRelease(actor: { id: string; role: string }, id: number, override?: string) {
  return tx(async (c) => {
    const r = (await c.query(`select * from releases where id=$1 for update`, [id])).rows[0];
    if (!r) throw new HttpError(404, "not_found", "Release not found.");
    if (r.status === "published") throw new HttpError(409, "already_published", "Already published.");
    if (!r.gate?.pass) {
      if (!override) throw new HttpError(409, "gate_failed", "This release makes accuracy worse on the labeled set.", { reasons: r.gate?.reasons });
      if (actor.role !== "owner") throw new HttpError(403, "forbidden", "Only an owner can override the accuracy gate.");
    }
    await c.query(`update releases set status='published', published_by=$2, published_at=now(), gate_override_reason=$3 where id=$1`, [id, actor.id, r.gate?.pass ? null : override]);
    await c.query(`insert into admin_audit_log (admin_id,action,after) values ($1,'release.publish',$2)`, [actor.id, JSON.stringify({ id, version: r.version, gate: r.gate, override: override ?? null })]);
    return { id, version: r.version };
  });
}

export async function publicReleaseNotes(limit = 30) {
  return q(`select version, published_at, public_notes from releases where status='published' order by published_at desc limit $1`, [limit]);
}

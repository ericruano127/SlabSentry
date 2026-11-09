import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GRADERS, HOLDER_GENERATIONS, HOLDER_LIBRARY_VERSION, SECURITY_FEATURES, validatePlansConfig } from "@slabguard/core";
import { pool, tx } from "../lib/db";
import { upsertPlans } from "../lib/plans";

const readPlansConfigFile = () =>
  validatePlansConfig(JSON.parse(readFileSync(process.env.PLANS_CONFIG ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../config/plans.json"), "utf8")));

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../db/migrations");

export async function migrate({ seedPlans = true } = {}) {
  await pool.query(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await pool.query(`select name from schema_migrations`)).rows.map((r) => r.name));
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(f)) continue;
    await tx(async (c) => {
      await c.query(readFileSync(path.join(dir, f), "utf8").replace(/create table schema_migrations[^;]+;/, ""));
      await c.query(`insert into schema_migrations (name) values ($1)`, [f]);
    });
    console.log("applied", f);
  }
  await seedLegalDocuments();
  await tx(async (c) => {
    // Plans: inserted from config only if missing (admins may have edited them since). PLANS_FORCE_SYNC=1 overwrites.
    const existing = (await c.query(`select count(*)::int n from subscription_plans`)).rows[0].n;
    if (seedPlans && (existing === 0 || process.env.PLANS_FORCE_SYNC === "1")) await upsertPlans(c, readPlansConfigFile().plans);
    for (const g of Object.values(GRADERS)) await c.query(`insert into grading_companies (id,name,data) values ($1,$2,$3) on conflict (id) do update set name=excluded.name, data=excluded.data`, [g.id, g.name, JSON.stringify({ ...g, certPattern: g.certPattern.source })]);
    for (const h of HOLDER_GENERATIONS) await c.query(`insert into holder_generations (id,grader,name,data,library_version) values ($1,$2,$3,$4,$5) on conflict (id) do update set data=excluded.data, library_version=excluded.library_version`, [h.id, h.grader, h.name, JSON.stringify(h), HOLDER_LIBRARY_VERSION]);
    for (const f of Object.values(SECURITY_FEATURES)) await c.query(`insert into security_features (id,data,library_version) values ($1,$2,$3) on conflict (id) do update set data=excluded.data, library_version=excluded.library_version`, [f.id, JSON.stringify(f), HOLDER_LIBRARY_VERSION]);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate().then(() => pool.end()).catch((e) => (console.error(e), process.exit(1)));
}

/** Load legal/*.md (front matter: version, title, requires_acceptance) as published document versions.
 * Existing versions are never overwritten — changing text requires a new version (re-acceptance). */
export async function seedLegalDocuments() {
  const legalDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../legal");
  const kinds: Record<string, string> = { "terms.md": "terms", "privacy.md": "privacy", "training-consent.md": "training_consent", "data-collection.md": "data_collection" };
  for (const [f, kind] of Object.entries(kinds)) {
    let raw: string;
    try { raw = readFileSync(path.join(legalDir, f), "utf8"); } catch { continue; }
    const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) throw new Error(`legal/${f}: missing front matter`);
    const meta = Object.fromEntries(m[1].split("\n").map((l) => l.split(/:\s*/, 2)));
    const r = await pool.query(
      `insert into legal_documents (kind,version,title,body_md,requires_acceptance,published) values ($1,$2,$3,$4,$5,true)
       on conflict (kind,version) do nothing returning version`,
      [kind, meta.version, meta.title, m[2].trim(), kind === "terms" || kind === "privacy" ? meta.requires_acceptance !== "false" : false],
    );
    if (!r.rowCount) {
      const existing = await pool.query(`select body_md from legal_documents where kind=$1 and version=$2`, [kind, meta.version]);
      if (existing.rows[0]?.body_md !== m[2].trim()) console.warn(`legal/${f}: text changed but version ${meta.version} already exists — bump the version to publish it`);
    }
  }
}

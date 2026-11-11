#!/usr/bin/env node
/**
 * Migration safety check (CI). Production deploys are blue-green and can roll back, so the PREVIOUS release
 * must keep working against the NEW schema. Destructive statements break that, so they are only allowed in a
 * migration that declares itself the "contract" step of an expand → deploy → contract change:
 *   -- contract: <why it's safe now, e.g. "column unused since release 2026.12.1">
 * Usage: node scripts/check-migrations.mjs [migrations dir]   (exits 1 on violations)
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../db/migrations");
// Migrations that existed before this check (applied everywhere already).
const BASELINE = 9;
const RISKY = [
  [/\bdrop\s+table\b/i, "DROP TABLE"],
  [/\bdrop\s+column\b/i, "DROP COLUMN"],
  [/\brename\s+(column\s+)?\w+\s+to\b/i, "RENAME"],
  [/\balter\s+column\s+\w+\s+(set\s+data\s+)?type\b/i, "ALTER COLUMN … TYPE"],
  [/\balter\s+column\s+\w+\s+set\s+not\s+null\b/i, "SET NOT NULL (fails/locks if old code writes NULLs)"],
];
const problems = [];
for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  if (Number(f.slice(0, 3)) <= BASELINE) continue;
  const sql = readFileSync(path.join(dir, f), "utf8");
  const code = sql.replace(/--.*$/gm, ""); // ignore comments when matching
  const hits = RISKY.filter(([re]) => re.test(code)).map(([, name]) => name);
  if (hits.length && !/^--\s*contract:\s*\S+/m.test(sql)) problems.push(`${f}: ${hits.join(", ")} without a "-- contract: <reason>" line`);
}
if (problems.length) {
  console.error("Unsafe migrations (the previous release must keep working during blue-green deploys and rollbacks):\n - " + problems.join("\n - "));
  console.error('Split the change: add the new column/table first (expand), deploy, then remove the old one in a later migration marked "-- contract: <reason>".');
  process.exit(1);
}
console.log("migrations ok");

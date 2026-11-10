#!/usr/bin/env node
/**
 * Reduced-scale local load runner (autocannon). For a single machine only — the full 10,000-user
 * k6 scenarios in ../k6 must run against staging. Uses HS256 JWTs signed with SUPABASE_JWT_SECRET
 * (local/staging secret only — never production auth).
 *
 *   node loadtest/local/run.mjs <browse|write|spike|stress|all> [--users 2000] [--duration 20] [--base http://localhost:3100]
 *
 * Writes a JSON summary to loadtest/results/<scenario>-<timestamp>.json.
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../../apps/web/package.json"));
const autocannon = require("autocannon");
const { SignJWT } = await import(require.resolve("jose"));

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const scenario = args[0] ?? "browse";
const BASE = opt("base", process.env.BASE_URL ?? "http://localhost:3100");
const USERS = Number(opt("users", 2000));
const DURATION = Number(opt("duration", 20));
const SECRET = process.env.SUPABASE_JWT_SECRET;
if (!SECRET) { console.error("SUPABASE_JWT_SECRET is required"); process.exit(2); }

async function token(i) {
  const sub = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  return new SignJWT({ role: "authenticated", aal: "aal2", email: `load${i}@example.test` })
    .setProtectedHeader({ alg: "HS256" }).setSubject(sub).setAudience("authenticated").setIssuedAt().setExpirationTime("2h")
    .sign(new TextEncoder().encode(SECRET));
}

console.log(`minting ${USERS} tokens…`);
const tokens = await Promise.all(Array.from({ length: USERS }, (_, i) => token(i + 1)));
const auth = (t) => ({ authorization: `Bearer ${t}`, "content-type": "application/json" });
const pick = () => tokens[(Math.random() * tokens.length) | 0];

/** Onboard every user once (account row + consent), 50 at a time, like a real first visit. */
async function onboard() {
  const t0 = Date.now();
  for (let i = 0; i < tokens.length; i += 50) {
    await Promise.all(tokens.slice(i, i + 50).map(async (t) => {
      const st = await (await fetch(`${BASE}/api/consent`, { headers: auth(t) })).json();
      if (st.required) await fetch(`${BASE}/api/consent`, { method: "POST", headers: auth(t), body: JSON.stringify({ terms: st.terms.current, privacy: st.privacy.current }) });
    }));
  }
  console.log(`onboarded ${tokens.length} users in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

const BROWSE = ["/api/me", "/api/sessions", "/api/plans", "/api/releases", "/api/me", "/api/sessions"];
const browseReqs = BROWSE.map((p) => ({ method: "GET", path: p, setupRequest: (r) => ({ ...r, headers: auth(pick()) }) }));
const writeReqs = [
  { method: "POST", path: "/api/sessions", setupRequest: (r) => ({ ...r, headers: auth(pick()), body: JSON.stringify({ mode: "in_hand", category: "sports_cards" }) }) },
  ...browseReqs.slice(0, 3),
];

function run(name, { connections, duration, requests }) {
  return new Promise((resolve, reject) => {
    const inst = autocannon({ url: BASE, connections, duration, requests, timeout: 10 }, (err, r) => (err ? reject(err) : resolve(r)));
    inst.on("error", reject);
  }).then((r) => {
    const statuses = Object.fromEntries(Object.entries(r).filter(([k]) => /^\d{1}xx$/.test(k)).map(([k, v]) => [k, v]));
    const total = r.requests.total + r.timeouts + r.errors;
    const s = {
      name, connections, duration, rps: Math.round(r.requests.average), total: r.requests.total,
      p50: r.latency.p50, p90: r.latency.p90, p99: r.latency.p99, max: r.latency.max,
      non2xx: r.non2xx, errors: r.errors, timeouts: r.timeouts, statuses,
      failRate: total ? +(((r.non2xx + r.errors + r.timeouts) / total) * 100).toFixed(2) : 0,
    };
    console.log(`${name.padEnd(22)} conn=${String(connections).padStart(5)} rps=${String(s.rps).padStart(6)} p50=${s.p50}ms p90=${s.p90}ms p99=${s.p99}ms fail=${s.failRate}% (non2xx=${s.non2xx} err=${s.errors} timeout=${s.timeouts})`);
    return s;
  });
}

const results = [];
await onboard();
if (scenario === "browse" || scenario === "all") {
  for (const c of [50, 200, 500]) results.push(await run(`browse`, { connections: c, duration: DURATION, requests: browseReqs }));
}
if (scenario === "write" || scenario === "all") {
  results.push(await run("write+browse", { connections: 200, duration: DURATION, requests: writeReqs }));
}
if (scenario === "spike" || scenario === "all") {
  results.push(await run("spike:baseline", { connections: 20, duration: 10, requests: browseReqs }));
  results.push(await run("spike:surge", { connections: 1500, duration: 15, requests: browseReqs }));
  results.push(await run("spike:recovery", { connections: 20, duration: 10, requests: browseReqs }));
}
if (scenario === "stress" || scenario === "all") {
  for (const c of [100, 250, 500, 1000, 2000]) {
    const s = await run("stress", { connections: c, duration: 15, requests: browseReqs });
    results.push(s);
    if (s.failRate > 5 || s.p99 > 5000) { console.log(`breaking point reached at ${c} connections`); break; }
  }
}
const dir = path.join(here, "../results");
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${scenario}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify({ base: BASE, users: USERS, at: new Date().toISOString(), node: process.version, results }, null, 2));
console.log(`wrote ${file}`);

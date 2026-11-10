// Realistic mix for N concurrent users: browsing, history, polling a running analysis, creating sessions.
// Usage: k6 run -e BASE_URL=https://staging.example -e JWT_SECRET=... -e USERS=10000 k6/api-mix.js
import http from "k6/http";
import { check, sleep } from "k6";
import { BASE, headers, onboard } from "./lib.js";

const USERS = Number(__ENV.USERS || 10000);
export const options = {
  scenarios: {
    users: { executor: "ramping-vus", startVUs: 0, stages: [{ duration: "5m", target: USERS }, { duration: "15m", target: USERS }, { duration: "2m", target: 0 }], gracefulRampDown: "30s" },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{kind:read}": ["p(95)<500"],
    "http_req_duration{kind:write}": ["p(95)<1000"],
  },
};

const seen = new Set();
export default function () {
  const vu = __VU;
  if (!seen.has(vu)) { onboard(vu); seen.add(vu); }
  const h = headers(vu);
  const read = { ...h, tags: { kind: "read" } };
  const r = Math.random();
  if (r < 0.35) check(http.get(`${BASE}/api/me`, read), { me: (x) => x.status === 200 });
  else if (r < 0.55) check(http.get(`${BASE}/api/sessions`, read), { history: (x) => x.status === 200 });
  else if (r < 0.75) http.get(`${BASE}/api/plans`, { tags: { kind: "read" } });
  else if (r < 0.9) http.get(`${BASE}/api/library`, { tags: { kind: "read" } });
  else check(http.post(`${BASE}/api/sessions`, JSON.stringify({ mode: "in_hand", category: "tcg" }), { ...h, tags: { kind: "write" } }), { create: (x) => x.status === 201 || x.status === 429 });
  sleep(5 + Math.random() * 10); // think time: one request every ~10 s per user
}

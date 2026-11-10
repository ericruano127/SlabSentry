// Spike: a viral moment — near-zero to 10k users in 30 s, hold, drop. Checks recovery after the spike.
import http from "k6/http";
import { sleep } from "k6";
import { BASE, headers, onboard } from "./lib.js";
export const options = {
  scenarios: { spike: { executor: "ramping-vus", startVUs: 50, stages: [{ duration: "1m", target: 50 }, { duration: "30s", target: 10000 }, { duration: "3m", target: 10000 }, { duration: "30s", target: 50 }, { duration: "2m", target: 50 }] } },
  thresholds: { http_req_failed: ["rate<0.02"], http_req_duration: ["p(95)<1500"] },
};
const seen = new Set();
export default function () {
  if (!seen.has(__VU)) { onboard(__VU); seen.add(__VU); }
  const h = headers(__VU);
  http.get(`${BASE}/api/plans`);
  http.get(`${BASE}/api/me`, h);
  sleep(3 + Math.random() * 4);
}

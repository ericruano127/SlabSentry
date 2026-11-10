// Stress: keep adding load until thresholds fail to find the breaking point.
import http from "k6/http";
import { sleep } from "k6";
import { BASE, headers, onboard } from "./lib.js";
export const options = {
  scenarios: { stress: { executor: "ramping-arrival-rate", startRate: 100, timeUnit: "1s", preAllocatedVUs: 2000, maxVUs: 20000,
    stages: [{ duration: "3m", target: 500 }, { duration: "3m", target: 1500 }, { duration: "3m", target: 3000 }, { duration: "3m", target: 6000 }, { duration: "2m", target: 0 }] } },
  thresholds: { http_req_failed: [{ threshold: "rate<0.05", abortOnFail: true }], http_req_duration: [{ threshold: "p(95)<2000", abortOnFail: true }] },
};
const seen = new Set();
export default function () {
  if (!seen.has(__VU)) { onboard(__VU); seen.add(__VU); }
  http.get(`${BASE}/api/me`, headers(__VU));
  sleep(0.1);
}

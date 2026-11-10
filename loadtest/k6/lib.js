// Shared helpers for k6 scenarios. Auth: HS256 JWTs signed with the STAGING Supabase JWT secret
// (staging only — never point load tests at production auth). Each VU is a distinct user.
import crypto from "k6/crypto";
import encoding from "k6/encoding";
import http from "k6/http";

export const BASE = __ENV.BASE_URL || "http://localhost:3000";
const SECRET = __ENV.JWT_SECRET;

function b64url(s) { return encoding.b64encode(s, "rawurl"); }
export function token(vu) {
  const now = Math.floor(Date.now() / 1000);
  const sub = `00000000-0000-4000-8000-${String(vu).padStart(12, "0")}`;
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ sub, aud: "authenticated", role: "authenticated", aal: "aal2", email: `load${vu}@example.test`, iat: now, exp: now + 3600 }));
  const sig = crypto.hmac("sha256", SECRET, `${head}.${body}`, "base64rawurl");
  return `${head}.${body}.${sig}`;
}
export function headers(vu) { return { headers: { Authorization: `Bearer ${token(vu)}`, "content-type": "application/json" } }; }

/** First request per user: create the account row and accept the current terms (as real users do). */
export function onboard(vu) {
  const h = headers(vu);
  const st = http.get(`${BASE}/api/consent`, h).json();
  if (st && st.required) http.post(`${BASE}/api/consent`, JSON.stringify({ terms: st.terms.current, privacy: st.privacy.current }), h);
}

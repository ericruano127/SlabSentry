import { createHmac } from "node:crypto";
import type { CertSightings } from "@slabguard/core";
import { q } from "./db";

/**
 * Cross-upload cloned-certificate detection, privacy-safe: only keyed hashes of (grader, cert) and of
 * the user id are stored, plus a perceptual fingerprint of the item. Nothing about other users or
 * their items is ever returned — only counts.
 */
const secret = () => process.env.CERT_HASH_SECRET ?? "dev-only-cert-hash-secret";
export const certKey = (grader: string, cert: string) => createHmac("sha256", secret()).update(`${grader.toUpperCase()}|${cert.toUpperCase()}`).digest("hex");
export const userKey = (userId: string) => createHmac("sha256", secret()).update(`user|${userId}`).digest("hex");

const hamming = (a: string, b: string) => {
  let n = 0;
  for (let i = 0; i < a.length; i++) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { n += x & 1; x >>= 1; } }
  return n;
};
/** pHash distance that separates "clearly different item" from re-photographs of the same item. */
export const DIFFERENT_ITEM_HAMMING = 20;

export async function recordAndCheck(p: { sessionId: string; userId: string; grader: string; cert: string; category: string; phash?: string | null; dhash?: string | null }): Promise<CertSightings> {
  const key = certKey(p.grader, p.cert);
  const others = await q(`select item_phash from cert_sightings where cert_key=$1 and (session_id is distinct from $2) and created_at > now() - interval '3 years'`, [key, p.sessionId]);
  await q(`delete from cert_sightings where session_id=$1`, [p.sessionId]); // one sighting per session (re-analysis replaces it)
  await q(`insert into cert_sightings (cert_key,user_key,session_id,category,item_phash,item_dhash) values ($1,$2,$3,$4,$5,$6)`, [key, userKey(p.userId), p.sessionId, p.category, p.phash ?? null, p.dhash ?? null]);
  const comparable = p.phash ? others.filter((o) => o.item_phash) : [];
  return {
    otherSessions: others.length,
    comparable: comparable.length,
    visuallyDifferent: comparable.filter((o) => hamming(o.item_phash, p.phash!) >= DIFFERENT_ITEM_HAMMING).length,
  };
}

export async function deleteUserSightings(userId: string) {
  await q(`delete from cert_sightings where user_key=$1`, [userKey(userId)]);
}

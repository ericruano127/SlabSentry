import { officialLookupUrl, type GraderId, type OfficialCertRecord } from "@slabguard/core";
import { env } from "../env";

/**
 * Grader adapters. Only documented, permitted integrations are called; every
 * other grader returns found=null with an official link — never scraped data.
 */
export interface LookupResult {
  record: OfficialCertRecord;
  images: { side: "front" | "back"; url: string }[];
  imageAvailability: "available" | "unavailable" | "inaccessible" | "not_checked";
  providerError?: string;
}

export async function lookupCert(grader: GraderId, cert: string): Promise<LookupResult> {
  const now = new Date().toISOString();
  const link = officialLookupUrl(grader, cert);
  if (grader === "PSA" && env.psaToken) return psaLookup(cert, link);
  return {
    record: { grader, certNumber: cert, found: null, verificationUrl: link, provenance: { source: "official_link", url: link, retrievedAt: now, note: grader === "PSA" ? "PSA API token not configured" : "no permitted programmatic access" } },
    images: [],
    imageAvailability: "not_checked",
  };
}

const PSA = "https://api.psacard.com/publicapi";

async function psaGet(path: string) {
  const r = await fetch(`${PSA}${path}`, { headers: { Authorization: `bearer ${env.psaToken}`, Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (r.status === 204 || r.status === 404) return null;
  if (!r.ok) throw new Error(`PSA API ${r.status}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function psaLookup(cert: string, link: string): Promise<LookupResult> {
  const now = new Date().toISOString();
  const prov = { source: "official_api" as const, url: `${PSA}/cert/GetByCertNumber/${cert}`, retrievedAt: now, tool: "psa-public-api" };
  try {
    const data = await psaGet(`/cert/GetByCertNumber/${encodeURIComponent(cert)}`);
    const c = data?.PSACert;
    if (!c) {
      const found = data?.IsValidRequest === false || data?.ServerMessage ? false : data === null ? false : null;
      return { record: { grader: "PSA", certNumber: cert, found, verificationUrl: link, provenance: { ...prov, note: data?.ServerMessage }, raw: data }, images: [], imageAvailability: "not_checked" };
    }
    const record: OfficialCertRecord = {
      grader: "PSA", certNumber: cert, found: true,
      year: c.Year, brand: c.Brand, subject: c.Subject, cardNumber: c.CardNumber, variety: c.Variety,
      grade: c.CardGrade ?? c.GradeDescription, labelType: c.LabelType,
      description: [c.Year, c.Brand, c.Subject, c.CardNumber && `#${c.CardNumber}`, c.Variety].filter(Boolean).join(" "),
      verificationUrl: link, provenance: prov, raw: c,
    };
    let images: LookupResult["images"] = [];
    let availability: LookupResult["imageAvailability"] = "unavailable";
    try {
      const imgs = await psaGet(`/cert/GetImagesByCertNumber/${encodeURIComponent(cert)}`);
      // Response schema is not fully documented; accept the observed {IsFrontImage, ImageURL} shape only.
      if (Array.isArray(imgs)) {
        images = imgs.filter((i) => typeof i?.ImageURL === "string" && /^https:\/\//.test(i.ImageURL)).map((i) => ({ side: i.IsFrontImage ? "front" : "back", url: i.ImageURL }));
        availability = images.length ? "available" : "unavailable";
      }
    } catch {
      availability = "inaccessible";
    }
    record.imageUrls = { front: images.find((i) => i.side === "front")?.url, back: images.find((i) => i.side === "back")?.url };
    return { record, images, imageAvailability: availability };
  } catch (e) {
    return { record: { grader: "PSA", certNumber: cert, found: null, verificationUrl: link, provenance: { ...prov, note: "PSA API unavailable" } }, images: [], imageAvailability: "inaccessible", providerError: (e as Error).message };
  }
}

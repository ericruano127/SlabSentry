import { env } from "./env";

/** Google Cloud Vision Web Detection (licensed). Returns null when not configured. */
export async function webDetection(img: Buffer) {
  if (!env.googleVisionKey) return null;
  const r = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${env.googleVisionKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ image: { content: img.toString("base64") }, features: [{ type: "WEB_DETECTION", maxResults: 20 }] }] }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`vision web detection ${r.status}`);
  const w = (await r.json()).responses?.[0]?.webDetection ?? {};
  const pagesWithFull = (w.pagesWithMatchingImages ?? []).filter((p: any) => p.fullMatchingImages?.length).map((p: any) => p.url as string);
  return {
    samePhotoUrls: [...new Set<string>([...pagesWithFull, ...(w.fullMatchingImages ?? []).map((i: any) => i.url)])].slice(0, 20),
    similarUrls: (w.visuallySimilarImages ?? []).map((i: any) => i.url as string).slice(0, 20),
  };
}

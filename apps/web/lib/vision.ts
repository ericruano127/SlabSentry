import type { ComparisonResult, HolderInspectionResult, QualityReport } from "@slabguard/core";
import { env } from "./env";

export class VisionUnavailable extends Error {}

async function post<T>(p: string, files: Record<string, Buffer | Buffer[] | undefined>, fields: Record<string, string> = {}, timeoutMs = 60_000): Promise<T> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(files)) {
    if (!v) continue;
    for (const b of Array.isArray(v) ? v : [v]) fd.append(k, new Blob([new Uint8Array(b)]), `${k}.jpg`);
  }
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  let r: Response;
  try {
    r = await fetch(`${env.visionUrl}${p}`, { method: "POST", body: fd, headers: env.visionKey ? { "x-vision-key": env.visionKey } : {}, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new VisionUnavailable(`vision service unreachable: ${(e as Error).message}`);
  }
  if (r.status === 422) throw Object.assign(new Error("unreadable image"), { code: "unreadable_image" });
  if (!r.ok) throw new VisionUnavailable(`vision ${p} failed: ${r.status}`);
  return r.json() as Promise<T>;
}

export const vision = {
  quality: (img: Buffer, role: string) => post<QualityReport & { elapsedMs: number }>("/quality", { image: img }, { role }, 20_000),
  extract: (img: Buffer) => post<{ codes: { type: string; data: string }[]; ocr: { text: string; score: number }[] }>("/extract", { image: img }),
  compare: (upload: Buffer, reference: Buffer, uploadLabelText?: string[]) =>
    post<ComparisonResult & { elapsedMs: number; overlays: Record<string, string | undefined> }>("/compare", { upload, reference }, uploadLabelText?.length ? { upload_label_text: uploadLabelText.join("\n") } : {}, 120_000),
  frames: (video: Buffer, k = 6) =>
    post<{ durationSec: number; sampled: number; distinctFrames: number; status: "ok" | "too_few_distinct_frames"; frames: { t: number; sharpness: number; jpeg: string }[] }>("/frames", { video_file: video }, { k: String(k) }, 90_000),
  edge: (img: Buffer) => post<{ status: string; anomalies?: number; regions?: any[]; note?: string }>("/edge", { image: img }),
  holder: (f: { front: Buffer; label?: Buffer; tilt?: Buffer[]; normal?: Buffer; backlit?: Buffer }) =>
    post<HolderInspectionResult & { elapsedMs: number }>("/holder", f),
};

import { config } from "./config";
import { supabase } from "./supabase";

/** Same API and entitlements as the website. The server is the source of truth for plan & credits. */
export class ApiError extends Error {
  constructor(public status: number, public body: any) {
    super(body?.message ?? `Request failed (${status})`);
  }
}

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const headers: Record<string, string> = { "x-client": "mobile", ...(init.headers as any) };
  if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  let body = init.body;
  if (init.json !== undefined) (headers["Content-Type"] = "application/json"), (body = JSON.stringify(init.json));
  const r = await fetch(`${config.apiUrl}${path}`, { ...init, headers, body });
  const out = (r.headers.get("content-type") ?? "").includes("json") ? await r.json() : null;
  if (!r.ok) throw new ApiError(r.status, out);
  return out as T;
}

export async function uploadPhoto(sessionId: string, role: string, uri: string, attestation?: string, mimeType?: string) {
  const fd = new FormData();
  const isVideo = role === "tilt_video";
  const type = mimeType ?? (isVideo ? "video/mp4" : "image/jpeg");
  fd.append("file", { uri, name: `${role}.${isVideo ? (type.includes("quicktime") ? "mov" : "mp4") : "jpg"}`, type } as any);
  fd.append("role", role);
  if (attestation) fd.append("attestation", attestation);
  return api(`/api/sessions/${sessionId}/images`, { method: "POST", body: fd });
}

export type Usage = {
  planId: string; planName: string; features: string[]; periodAllowance: number; periodUsed: number; periodRemaining: number;
  freeGranted: number; freeUsed: number; freeRemaining: number; totalRemaining: number; renewsAt: string | null; windowEnd: string | null;
  willCancel: boolean; accessEndsAt: string | null; subscriptionProvider: string | null; billingInterval: string | null;
};
export type Me = { user: { id: string; email: string | null }; usage: Usage; welcome: boolean };

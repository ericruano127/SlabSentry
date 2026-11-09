"use client";
import { supabase } from "./supabase";

export class ApiError extends Error {
  constructor(public status: number, public body: any) {
    super(body?.message ?? `Request failed (${status})`);
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const sb = supabase();
  if (!sb) return {};
  const { data } = await sb.auth.getSession();
  return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(await authHeader()), ...(init.headers as any) };
  let body = init.body;
  if (init.json !== undefined) (headers["Content-Type"] = "application/json"), (body = JSON.stringify(init.json));
  const r = await fetch(path, { ...init, headers, body, credentials: "same-origin" });
  if (r.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/plans")) {
    const body = await r.clone().json().catch(() => null);
    window.location.href = `/login?${body?.error === "mfa_challenge_required" ? "mfa=1&" : ""}next=${encodeURIComponent(location.pathname)}`;
  }
  if (r.status === 428 && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("consent-required"));
  const ct = r.headers.get("content-type") ?? "";
  const data = ct.includes("json") ? await r.json() : await r.blob();
  if (!r.ok) throw new ApiError(r.status, data);
  return data as T;
}

export async function download(path: string, filename: string, init: RequestInit & { json?: unknown } = {}) {
  const blob = await api<Blob>(path, init);
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";

/** Private images require auth headers, so fetch as blob instead of a public URL. */
export function AuthImage({ id, alt, className }: { id: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    api<Blob>(`/api/images/${id}`).then((b) => setSrc((url = URL.createObjectURL(b)))).catch(() => setSrc(null));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [id]);
  return src ? <img src={src} alt={alt} className={className} /> : <div className={className} style={{ minHeight: 120 }} aria-busy="true" />;
}

"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";

/** Private images require auth headers, so fetch as blob instead of a public URL. */
export function AuthImage({ id, path, alt, className, style }: { id?: string; path?: string; alt: string; className?: string; style?: React.CSSProperties }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    api<Blob>(path ?? `/api/images/${id}`).then((b) => setSrc((url = URL.createObjectURL(b)))).catch(() => setSrc(null));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [id, path]);
  return src ? <img src={src} alt={alt} className={className} style={style} /> : <div className={className} style={{ minHeight: 120, ...style }} aria-busy="true" />;
}

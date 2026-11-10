"use client";
import Link from "next/link";
import { useApi } from "@/lib/client/hooks";

export function VersionLink() {
  const { data } = useApi<{ current: string | null }>("/api/releases");
  return <Link href="/whats-new">What's new{data?.current ? ` · v${data.current}` : ""}</Link>;
}

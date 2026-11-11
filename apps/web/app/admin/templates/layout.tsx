import type { Metadata } from "next";

export const metadata: Metadata = { title: "Verified templates" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

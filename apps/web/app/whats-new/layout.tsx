import type { Metadata } from "next";

export const metadata: Metadata = { title: "What\u2019s new" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

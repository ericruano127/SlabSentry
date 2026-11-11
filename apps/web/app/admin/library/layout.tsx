import type { Metadata } from "next";

export const metadata: Metadata = { title: "Reference library" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

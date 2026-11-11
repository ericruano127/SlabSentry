import type { Metadata } from "next";

export const metadata: Metadata = { title: { default: "Staff tools", template: "%s · Staff · SlabGuard" }, robots: { index: false, follow: false } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

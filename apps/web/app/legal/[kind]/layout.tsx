import type { Metadata } from "next";

const TITLES: Record<string, string> = { terms: "Terms of Service", privacy: "Privacy Policy", "training-consent": "Training consent", "notice-at-collection": "Notice at collection" };

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }): Promise<Metadata> {
  return { title: TITLES[(await params).kind] ?? "Legal" };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

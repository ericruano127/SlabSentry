import type { Metadata, Viewport } from "next";
import "./globals.css";
import Link from "next/link";
import { ConsentGate } from "@/components/ConsentGate";
import { Nav } from "@/components/Nav";
import { VersionLink } from "@/components/VersionLink";

export const metadata: Metadata = {
  // Every page gets its own title (WCAG 2.4.2), e.g. "Scan · SlabGuard"; the home page uses the default.
  title: { default: "SlabGuard — Graded card verification", template: "%s · SlabGuard" },
  description: "Evidence-based screening of graded sports cards and TCG slabs before you buy.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#3b5bdb" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* WCAG 2.4.1: let keyboard and screen-reader users skip the repeated navigation */}
        <a href="#main" className="skip-link">Skip to main content</a>
        <Nav />
        <main id="main" tabIndex={-1} className="container">{children}</main>
        <ConsentGate />
        <footer className="container small muted" style={{ padding: "24px 16px 40px", borderTop: "1px solid var(--border)" }}>
          Slab Guard reports are guidance based on the photos and records available — <strong>not a guarantee of authenticity</strong>. We never declare an item real or fake.
          <div className="row" style={{ marginTop: 8 }}>
            <Link href="/legal/terms">Terms</Link><Link href="/legal/privacy">Privacy</Link><Link href="/legal/notice-at-collection">Notice at collection</Link><Link href="/account#privacy">Your privacy choices</Link><VersionLink />
          </div>
        </footer>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "SlabGuard — Graded card verification",
  description: "Evidence-based screening of graded sports cards and TCG slabs before you buy.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#3b5bdb" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="container">{children}</main>
      </body>
    </html>
  );
}

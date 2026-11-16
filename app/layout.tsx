import type { Metadata, Viewport } from "next";
import { Shell } from "@/components/shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Finance Dashboard",
  description: "Upload statements, categorise spending, and separate personal from business.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}

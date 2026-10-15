import type { Metadata } from "next";
import SiteLayout from "@/components/SiteLayout";
import "./globals.css";

export const metadata: Metadata = {
  title: "Open Valley | Better information. Better decisions.",
  description:
    "Public data, useful tools, and perspective from Macon Phillips. Understanding the decisions facing the Mad River Valley and beyond, starting with our schools.",
  ...(process.env.NEXT_PUBLIC_OPENVALLEY_STAGING === "true" ? { robots: { index: false, follow: false } } : {}),
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><SiteLayout>{children}</SiteLayout></body>
    </html>
  );
}

import type { Metadata } from "next";
import SiteLayout from "@/components/SiteLayout";
import "./globals.css";

export const metadata: Metadata = {
  title: "Open Valley | Homes and Schools",
  description:
    "Independent civic research on homes and the Harwood Unified Union School District in Vermont, published by Open Valley.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><SiteLayout>{children}</SiteLayout></body>
    </html>
  );
}

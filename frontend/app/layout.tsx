import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SOP Opera",
  description: "Operational Review Platform — Phase 0 seam check",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

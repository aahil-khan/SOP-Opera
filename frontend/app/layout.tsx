import type { Metadata } from "next";
import "./globals.css";
import { TopNav } from "@/components/nav/TopNav";
import { DemoModeBar } from "@/components/demo/DemoModeBar";

export const metadata: Metadata = {
  title: "SOP Opera",
  description: "Operational Review Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <TopNav />
          <main className="app-main">{children}</main>
          <DemoModeBar />
        </div>
      </body>
    </html>
  );
}

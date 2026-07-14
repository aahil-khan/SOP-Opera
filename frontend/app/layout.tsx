import type { Metadata } from "next";
import "./globals.css";
import { TopNav } from "@/components/nav/TopNav";
import { DemoModeBar } from "@/components/demo/DemoModeBar";
import { RealtimeProvider } from "@/components/RealtimeProvider";

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
        <RealtimeProvider>
          <div className="app-shell">
            <TopNav />
            <main className="app-main">{children}</main>
            <DemoModeBar />
          </div>
        </RealtimeProvider>
      </body>
    </html>
  );
}

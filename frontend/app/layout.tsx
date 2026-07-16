import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { TopNav } from "@/components/nav/TopNav";
import { AppToaster } from "@/components/notifications/AppToaster";
import { RealtimeProvider } from "@/components/RealtimeProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { DEFAULT_THEME, THEME_STORAGE_KEY } from "@/lib/theme";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans-loaded",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono-loaded",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SOP Opera",
  description: "Operational Review Platform",
};

const themeInitScript = `
(function () {
  try {
    var key = ${JSON.stringify(THEME_STORAGE_KEY)};
    var fallback = ${JSON.stringify(DEFAULT_THEME)};
    var allowed = ["mission-control", "vscode-dark", "light", "blueprint", "catppuccin"];
    var stored = localStorage.getItem(key);
    var theme = allowed.indexOf(stored) !== -1 ? stored : fallback;
    document.documentElement.dataset.theme = theme;
  } catch (e) {
    document.documentElement.dataset.theme = ${JSON.stringify(DEFAULT_THEME)};
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ThemeProvider>
          <RealtimeProvider>
            <div className="app-shell">
              <TopNav />
              <main className="app-main">{children}</main>
            </div>
            <AppToaster />
          </RealtimeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

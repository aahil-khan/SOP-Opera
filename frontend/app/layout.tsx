import type { Metadata } from "next";
import localFont from "next/font/local";
import { Plus_Jakarta_Sans } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { AppShell } from "@/components/nav/AppShell";
import { AppToaster } from "@/components/notifications/AppToaster";
import { RealtimeProvider } from "@/components/RealtimeProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { DEFAULT_THEME, THEME_STORAGE_KEY } from "@/lib/theme";

const satoshi = localFont({
  src: [
    {
      path: "../fonts/satoshi/Satoshi-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../fonts/satoshi/Satoshi-Medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../fonts/satoshi/Satoshi-Medium.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../fonts/satoshi/Satoshi-Bold.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-display-loaded",
  display: "swap",
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-label-loaded",
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
    var allowed = ["mission-control", "vscode-dark", "github-dark", "light", "blueprint", "catppuccin"];
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
      className={`${GeistSans.variable} ${GeistMono.variable} ${satoshi.variable} ${plusJakarta.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ThemeProvider>
          <RealtimeProvider>
            <AppShell>{children}</AppShell>
            <AppToaster />
          </RealtimeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

"use client";

import { usePathname } from "next/navigation";
import { TopNav } from "@/components/nav/TopNav";

/**
 * Conditionally renders the TopNav.
 * The landing page provides its own navigation, so TopNav is suppressed there.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLanding = pathname === "/landing";

  return (
    <div className="app-shell">
      {!isLanding && <TopNav />}
      <main className="app-main">{children}</main>
    </div>
  );
}

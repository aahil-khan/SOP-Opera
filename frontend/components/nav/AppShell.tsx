"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TopNav } from "@/components/nav/TopNav";
import { SupervisorNav } from "@/components/nav/SupervisorNav";
import { getActorFromCookie } from "@/lib/actorCookie";

/** Where each actor kind belongs once signed in. */
const HOME_FOR_KIND: Record<string, string> = {
  user: "/operator",
  worker: "/supervisor",
};

/**
 * Conditionally renders navigation and enforces the entry flow.
 * Landing/login have no app chrome; supervisors get a dedicated bar
 * with no operator links (Operator Dashboard, Demo, Settings, etc.).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLanding = pathname === "/";
  const isLogin = pathname === "/login";
  const isSupervisor = pathname.startsWith("/supervisor");

  const allowed = useMemo(
    () => isLanding || isLogin || pathname === "/health",
    [isLanding, isLogin, pathname],
  );

  // Cookie is only available in the browser — start unset so SSR and the
  // first client render match. Gate redirects until the cookie is read.
  const [actorKind, setActorKind] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const a = getActorFromCookie();
    setActorKind(a?.kind ?? null);
    setAuthReady(true);
  }, [pathname]);

  useEffect(() => {
    if (!authReady) return;
    // Signed-in visitors skip the landing page — straight to their dashboard.
    if (isLanding) {
      const home = actorKind ? HOME_FOR_KIND[actorKind] : null;
      if (home) router.replace(home);
      return;
    }
    if (allowed) return;
    if (!actorKind) {
      router.replace("/login");
      return;
    }
    if (actorKind === "worker" && !isSupervisor) {
      router.replace("/supervisor");
      return;
    }
    if (actorKind === "user" && isSupervisor) {
      router.replace("/operator");
    }
  }, [authReady, allowed, actorKind, isLanding, isSupervisor, router]);

  const showChrome = !isLanding && !isLogin;

  return (
    <div className="app-shell">
      {showChrome && (isSupervisor || actorKind === "worker" ? (
        <SupervisorNav />
      ) : (
        <TopNav />
      ))}
      <main className="app-main">{children}</main>
    </div>
  );
}

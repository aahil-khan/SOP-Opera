"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TopNav } from "@/components/nav/TopNav";
import { SupervisorNav } from "@/components/nav/SupervisorNav";
import { getActorFromCookie } from "@/lib/actorCookie";

/**
 * Conditionally renders navigation.
 * Landing/login have no app chrome; supervisors get a dedicated bar
 * with no operator links (Digital Twin, Demo, Settings, etc.).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLanding = pathname === "/landing";
  const isLogin = pathname === "/login";
  const isSupervisor = pathname.startsWith("/supervisor");

  const allowed = useMemo(
    () => isLanding || isLogin || pathname === "/health",
    [isLanding, isLogin, pathname],
  );

  const [actorKind, setActorKind] = useState<string | null>(() => {
    const a = getActorFromCookie();
    return a?.kind ?? null;
  });

  useEffect(() => {
    const a = getActorFromCookie();
    setActorKind(a?.kind ?? null);
  }, [pathname]);

  useEffect(() => {
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
      router.replace("/");
    }
  }, [allowed, actorKind, isSupervisor, router]);

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

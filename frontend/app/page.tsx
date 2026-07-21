"use client";

import { LazyMotion, domAnimation } from "framer-motion";
import { LandingNav } from "@/components/landing/LandingNav";
import { HeroSection } from "@/components/landing/HeroSection";
import { GapSection } from "@/components/landing/GapSection";
import { ProofSection } from "@/components/landing/ProofSection";
import { HowItWorksSection } from "@/components/landing/HowItWorksSection";
import { DashboardSection } from "@/components/landing/DashboardSection";
import { ArchitectureSection } from "@/components/landing/ArchitectureSection";
import { CTASection } from "@/components/landing/CTASection";
import { LandingFooter } from "@/components/landing/LandingFooter";
import styles from "./landing.module.css";

/**
 * Public front door. Signed-in visitors are forwarded to their dashboard by
 * AppShell, so this only renders for logged-out traffic.
 *
 * LazyMotion + domAnimation keeps the framer bundle small — every landing
 * component uses the `m` component rather than `motion`, which is required for
 * the lazy feature bundle to actually pay off.
 */
export default function LandingPage() {
  return (
    <LazyMotion features={domAnimation} strict>
      <div className={styles.landing}>
        <LandingNav />
        <main>
          <HeroSection />
          <GapSection />
          <ProofSection />
          <HowItWorksSection />
          <DashboardSection />
          <ArchitectureSection />
          <CTASection />
        </main>
        <LandingFooter />
      </div>
    </LazyMotion>
  );
}

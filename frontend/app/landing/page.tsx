"use client";

import { useEffect, useRef } from "react";
import { LandingNav } from "@/components/landing/LandingNav";
import { HeroSection } from "@/components/landing/HeroSection";
import { ProblemSection } from "@/components/landing/ProblemSection";
import { HowItWorksSection } from "@/components/landing/HowItWorksSection";
import { CapabilitiesSection } from "@/components/landing/CapabilitiesSection";
import { DigitalTwinSection } from "@/components/landing/DigitalTwinSection";
import { SimulatorSection } from "@/components/landing/SimulatorSection";
import { WhyAISection } from "@/components/landing/WhyAISection";
import { BuiltForSection } from "@/components/landing/BuiltForSection";
import { TechnologySection } from "@/components/landing/TechnologySection";
import { CTASection } from "@/components/landing/CTASection";
import { LandingFooter } from "@/components/landing/LandingFooter";
import styles from "./landing.module.css";

/**
 * Subtle fade-on-scroll for each landing section.
 * Uses IntersectionObserver to add a `.visible` class as sections enter view.
 */
function useScrollFade() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const sections = el.querySelectorAll<HTMLElement>("section");
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add(styles.visible);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -40px 0px" },
    );

    sections.forEach((section) => {
      section.classList.add(styles.fadeSection);
      observer.observe(section);
    });

    return () => observer.disconnect();
  }, []);

  return containerRef;
}

export default function LandingPage() {
  const ref = useScrollFade();

  return (
    <div className={styles.landing} ref={ref}>
      <LandingNav />
      <HeroSection />
      <ProblemSection />
      <HowItWorksSection />
      <CapabilitiesSection />
      <DigitalTwinSection />
      <SimulatorSection />
      <WhyAISection />
      <BuiltForSection />
      <TechnologySection />
      <CTASection />
      <LandingFooter />
    </div>
  );
}

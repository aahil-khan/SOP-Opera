import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SOP Opera — Operational Safety Intelligence",
  description:
    "Industrial plants already have the data. SOP Opera brings sensors, permits, maintenance and worker records into one explainable operational review so supervisors understand compound risks before work begins.",
};

export default function LandingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

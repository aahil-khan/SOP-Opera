"use client";

import { use } from "react";
import { ReportDetailView } from "@/components/reports/ReportDetailView";

export default function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <ReportDetailView reportId={id} />;
}

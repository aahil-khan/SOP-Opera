"use client";

import { use } from "react";
import { ReviewDetail } from "@/components/reviews/ReviewDetail";

export default function ReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <ReviewDetail reviewId={id} />;
}

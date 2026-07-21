import { redirect } from "next/navigation";

/** Reviews list now lives in the operator dashboard's left panel. */
export default function ReviewsPage() {
  redirect("/operator");
}

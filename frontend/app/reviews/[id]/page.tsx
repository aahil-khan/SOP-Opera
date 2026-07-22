import { redirect } from "next/navigation";

/** Legacy URLs → operator twin deep-link. */
export default async function ReviewDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/operator?review=${encodeURIComponent(id)}`);
}

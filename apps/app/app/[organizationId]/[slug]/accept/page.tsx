import { redirect } from "next/navigation";

export default async function AcceptInviteRedirectDouble({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : undefined;
  const query = token ? `?token=${encodeURIComponent(token)}` : "";
  redirect(`/invite/accept${query}`);
}

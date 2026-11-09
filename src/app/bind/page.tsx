import { BindClient } from "./BindClient";

export const dynamic = "force-dynamic";

export default async function BindPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const ticket = Array.isArray(params.ticket)
    ? params.ticket[0]
    : params.ticket || "";
  return <BindClient ticket={ticket} />;
}

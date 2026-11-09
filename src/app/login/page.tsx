import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { env, isWechatConfigured } from "@/lib/config";
import { LoginClient } from "./LoginClient";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");
  const params = await searchParams;
  const error = Array.isArray(params.error)
    ? params.error[0]
    : params.error || "";
  return (
    <LoginClient
      initialError={error}
      wechatConfigured={isWechatConfigured}
      demoMode={env.DEMO_MODE}
      expired={Boolean(params.expired)}
    />
  );
}

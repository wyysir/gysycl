import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { AppShell } from "@/components/AppShell";
import { LeaveProtectionProvider } from "@/components/LeaveProtection";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <LeaveProtectionProvider owner={user.id}><AppShell user={user}>{children}</AppShell></LeaveProtectionProvider>;
}

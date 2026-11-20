import { hasPermission } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { SettingsClient } from "./SettingsClient";
export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user || !["settings.manage","user.manage","project.manage","template.manage"].some(key=>hasPermission(user,key as import("@/lib/permissions").Permission))) redirect("/dashboard");
  return <SettingsClient />;
}

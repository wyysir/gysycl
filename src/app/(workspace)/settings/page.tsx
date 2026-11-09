import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { SettingsClient } from "./SettingsClient";
export default async function SettingsPage() {
  const user = await getSessionUser();
  if (user?.globalRole !== "ADMIN") redirect("/dashboard");
  return <SettingsClient />;
}

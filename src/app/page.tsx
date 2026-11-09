import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getSessionUser();
  redirect(user ? "/dashboard" : "/login");
}

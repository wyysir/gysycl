import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { hasPermission } from "@/lib/permissions";
import { AuthorizationsClient } from "./AuthorizationsClient";
export default async function Page(){const user=await getSessionUser();if(!user||!hasPermission(user,"grant.manage"))redirect("/dashboard");return <AuthorizationsClient/>;}

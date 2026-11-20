import { SuppliersClient } from "./SuppliersClient";
import { getSessionUser } from "@/server/auth";
import { canOpenNavigation } from "@/lib/client/navigation";
import { redirect } from "next/navigation";
export default async function Page(){const user=await getSessionUser();if(!user||!canOpenNavigation(user,"/suppliers"))redirect("/dashboard");return <SuppliersClient/>;}

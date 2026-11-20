import type { NextRequest } from "next/server";
import { requireUser,ApiError } from "./auth";
import { hasPermission } from "@/lib/permissions";
export async function requireMasterReader(request:NextRequest){const user=await requireUser(request);if(!hasPermission(user,"master.view"))throw new ApiError(403,"没有共享基础资料查看权限");return user;}

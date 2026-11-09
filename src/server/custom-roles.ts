import { z } from "zod";
import { PERMISSION_KEYS } from "@/lib/permissions";

export const roleFields = {
  name: z.string().trim().min(1).max(50),
  description: z.string().trim().max(300).default(""),
  permissions: z.array(z.enum(PERMISSION_KEYS)).max(PERMISSION_KEYS.length)
    .transform(values=>[...new Set(values)].sort()),
};

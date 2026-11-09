import "dotenv/config";
import { getDb } from "@/lib/prisma";
import { markDemoRevenueReviewed } from "@/server/demo-revenue-review";
const args = process.argv.slice(2);
if (args.some(a => a !== "--apply")) throw new Error("只接受--apply；默认只读预览");
const db = await getDb();
try { console.log(JSON.stringify(await markDemoRevenueReviewed(db, args.includes("--apply")), null, 2)); }
finally { await db.$disconnect(); }

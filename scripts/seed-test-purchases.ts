import "dotenv/config";
import { getDb } from "@/lib/prisma";
import { seedTestPurchases } from "../src/server/test-purchases";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--apply")) {
  throw new Error("仅接受 --apply；默认只预览，先备份并导入测试主数据。");
}
const db = await getDb();
try {
  console.log(JSON.stringify(await seedTestPurchases(db, args.includes("--apply")), null, 2));
} finally {
  await db.$disconnect();
}

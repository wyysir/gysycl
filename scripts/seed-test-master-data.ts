import "dotenv/config";
import { getDb } from "@/lib/prisma";
import { seedTestMasterData } from "../src/server/test-master-data";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--apply")) {
  throw new Error("仅接受 --apply；不带参数只预览，使用前确认目标 DATABASE_URL 并备份。");
}
const db = await getDb();
try {
  console.log(JSON.stringify(await seedTestMasterData(db, args.includes("--apply")), null, 2));
} finally {
  await db.$disconnect();
}

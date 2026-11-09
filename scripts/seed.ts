import { getDb } from "../src/lib/prisma";
import { seedDatabase } from "../src/server/seed";

const db = await getDb();
const seeded = await seedDatabase(db);
console.log(seeded ? "示例数据已初始化" : "数据库已有数据，跳过初始化");

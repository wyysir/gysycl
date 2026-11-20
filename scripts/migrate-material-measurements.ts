import { getDb } from "../src/lib/prisma";
import { upgradeSpecificationKeys } from "../src/lib/specification-keys";
const db = await getDb();
try { console.log(JSON.stringify({ status: "PASS", normalizedSpecificationKeys: await upgradeSpecificationKeys(db) })); }
finally { await db.$disconnect(); }

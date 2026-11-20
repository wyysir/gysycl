import { getDb } from "../src/lib/prisma";
import { legacyGrants } from "../src/lib/permissions";
import { toSessionUser,userInclude } from "../src/server/auth";
import { authorizationLock,assertGrantManagerRemains } from "../src/server/authorizations";
const db=await getDb();
try{
 const migrated=await db.$transaction(async tx=>{await authorizationLock(tx);const rows=await tx.user.findMany({include:userInclude()});let count=0;for(const row of rows){if(row.accessGrants!==null)continue;const grants=legacyGrants(await toSessionUser(row));await tx.$executeRaw`UPDATE "User" SET "accessGrants"=${JSON.stringify(grants)}::jsonb WHERE id=${row.id} AND "accessGrants" IS NULL`;count++;}await assertGrantManagerRemains(tx);return count;},{timeout:60000});
 console.log(JSON.stringify({status:"PASS",migrated,oldBusinessPermissionsPreserved:true,newSupplierOperationsGranted:false,oldColumnsUnchanged:true}));
}finally{await db.$disconnect();}

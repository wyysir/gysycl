import { expect, it } from "vitest";
import { getReadyDb } from "@/lib/bootstrap";
import { seedDemoWeek, demoWeekBatch } from "@/server/demo-week";
import { markDemoRevenueReviewed } from "@/server/demo-revenue-review";
import { seedTestMasterData, testProjects, testSuppliers, testIngredients } from "@/server/test-master-data";
it("adds a balanced week once and preserves later human deletions",async()=>{
  const db=await getReadyDb();
  await seedTestMasterData(db,true);
  const existing=await db.document.findMany({orderBy:{id:"asc"}});
  try{
    const preview=await seedDemoWeek(db);expect(preview).toMatchObject({planned:{documents:35,revenues:35}});
    expect(await db.document.findMany({orderBy:{id:"asc"}})).toEqual(existing);
    await seedDemoWeek(db,true);
    const docs=await db.document.findMany({where:{id:{startsWith:"demo_week_20261102_"}},include:{items:true,checks:true}});
    expect(docs).toHaveLength(35);expect(docs.filter(d=>d.status==="PENDING_REVIEW")).toHaveLength(5);
    expect(docs.every(d=>d.checks.every(c=>c.severity!=="ERROR"))).toBe(true);
    expect(await db.projectDailyRevenue.count({where:{id:{startsWith:"demo_week_20261102_"}}})).toBe(35);
    expect(await db.projectDailyRevenue.count({where:{id:{startsWith:"demo_week_20261102_"},status:"APPROVED",reviewNote:{contains:"虚构演示数据"}}})).toBe(30);
    // Simulate upgrade from 0005; changed samples and the current-day pending examples stay pending.
    await db.projectDailyRevenue.updateMany({where:{id:{startsWith:"demo_week_20261102_"}},data:{status:"PENDING_REVIEW",reviewedById:null,reviewedAt:null,reviewNote:""}});
    await db.projectDailyRevenue.update({where:{id:"demo_week_20261102_0_0_revenue"},data:{amount:1}});
    await db.projectDailyRevenue.update({where:{id:"demo_week_20261102_0_1_revenue"},data:{notes:"后续人工修改"}});
    expect((await markDemoRevenueReviewed(db)).eligible).toHaveLength(28);
    expect(await db.projectDailyRevenue.count({where:{status:"APPROVED",id:{startsWith:"demo_week_20261102_"}}})).toBe(0);
    expect((await markDemoRevenueReviewed(db,true)).eligible).toHaveLength(28);
    expect((await markDemoRevenueReviewed(db,true)).eligible).toHaveLength(0);
    expect(await db.projectDailyRevenue.count({where:{status:"PENDING_REVIEW",id:{startsWith:"demo_week_20261102_"}}})).toBe(7);
    await db.document.delete({where:{id:docs[0].id}});
    expect(await seedDemoWeek(db,true)).toMatchObject({skipped:true});
    expect(await db.document.count({where:{id:{startsWith:"demo_week_20261102_"}}})).toBe(34);
    expect(await db.document.findMany({where:{id:{not:{startsWith:"demo_week_20261102_"}}},orderBy:{id:"asc"}})).toEqual(existing);
  }finally{
    await db.document.deleteMany({where:{id:{startsWith:"demo_week_20261102_"}}});
    await db.projectDailyRevenue.deleteMany({where:{id:{startsWith:"demo_week_20261102_"}}});
    await db.auditLog.deleteMany({where:{OR:[{entityId:{startsWith:"demo_week_20261102_"}},{entityId:demoWeekBatch}]}});
    await db.project.deleteMany({where:{id:{in:testProjects.map(p=>p.id)}}});
    await db.supplier.deleteMany({where:{id:{in:testSuppliers.map(p=>p.id)}}});
    await db.ingredient.deleteMany({where:{id:{in:testIngredients.map(p=>p.id)}}});
  }
},120000);

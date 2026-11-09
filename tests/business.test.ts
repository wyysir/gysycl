import { afterAll, describe, expect, it } from "vitest";
import { getReadyDb } from "@/lib/bootstrap";
import { dateOnly, parseDateOnly } from "@/lib/text";
import { getBusiness, revenueDate, revenueEditAllowed, saveRevenue, summarizeBusiness, reviewRevenue } from "@/server/business";
import { hasPermission } from "@/lib/permissions";
import type { SessionUser } from "@/server/auth";
const projectId="test_business_project";
const admin:SessionUser={id:"usr_admin",employeeNo:"admin",name:"测试",globalRole:"ADMIN",memberships:[]};
const employee:SessionUser={...admin,globalRole:"STAFF",memberships:[{projectId,projectName:"经营测试",projectCode:"BUSINESS-TEST",roles:["SUBMITTER"]}]};
afterAll(async()=>{const db=await getReadyDb();await db.document.deleteMany({where:{projectId}});await db.projectDailyRevenue.deleteMany({where:{projectId}});await db.auditLog.deleteMany({where:{entityType:"projectDailyRevenue",afterValue:{path:["projectId"],equals:projectId}}});await db.project.deleteMany({where:{id:projectId}});});
describe("project revenue and purchasing margin",()=>{
  it("keeps China civil dates and validates them",()=>{expect(revenueDate("2026-11-02").toISOString()).toBe("2026-11-02T00:00:00.000Z");expect(()=>revenueDate("2026-02-30")).toThrow("日期");});
  it("grants builtins, denies custom roles without explicit new keys and enforces China midnight",()=>{
    expect(hasPermission(employee,"revenue.edit_today",projectId)).toBe(true);
    expect(revenueEditAllowed(employee,projectId,"2026-11-02",new Date("2026-11-01T16:01:00Z"))).toBe(true);
    expect(revenueEditAllowed(employee,projectId,"2026-11-01",new Date("2026-11-01T16:01:00Z"))).toBe(false);
    expect(revenueEditAllowed(employee,"other","2026-11-02",new Date("2026-11-02"))).toBe(false);
    expect(hasPermission({...employee,memberships:[{...employee.memberships[0],permissions:[]} ]},"revenue.view",projectId)).toBe(false);
    expect(hasPermission({...admin,globalRole:"FINANCE"},"revenue.edit_today")).toBe(false);
  });
  it("uses weighted totals, supports negative rates and distinguishes missing from zero",()=>{
    const result=summarizeBusiness([{date:"1",revenue:100,cost:150,pending:20,documents:1},{date:"2",revenue:900,cost:300,pending:0,documents:1}]);
    expect(result.daily[0].rate).toBe(-50);expect(result.rate).toBe(55);
    for(const revenue of [0,null])expect(summarizeBusiness([{date:"1",revenue,cost:10,pending:10,documents:1}]).daily[0].rate).toBeNull();
    expect(summarizeBusiness([{date:"1",revenue:null,cost:10,pending:10,documents:1}]).incomplete).toBe(true);
  });
  it("persists one shared daily total with version conflict detection and attributable audit",async()=>{
    const db=await getReadyDb();await db.project.upsert({where:{id:projectId},create:{id:projectId,code:"BUSINESS-TEST",name:"经营测试"},update:{}});
    const date=dateOnly(new Date());const row=await saveRevenue(employee,{projectId,date,amount:0,notes:"未营业",version:0});expect(row.amount).toBe(0);
    await expect(saveRevenue(admin,{projectId,date,amount:3,notes:"过期副本",version:0})).rejects.toMatchObject({status:409});
    const competing=await Promise.allSettled([100,200].map(amount=>saveRevenue(admin,{projectId,date,amount,notes:"并发",version:row.version})));
    expect(competing.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    const audit=await db.auditLog.findFirstOrThrow({where:{entityId:row.id,action:"revenue.created"}});expect(audit.userId).toBe(employee.id);
    expect(await db.projectDailyRevenue.count({where:{projectId}})).toBe(1);
    await expect(saveRevenue(admin,{projectId,date,amount:-1,notes:"",version:2})).rejects.toThrow("非负");
    await expect(saveRevenue(admin,{projectId,date,amount:1.001,notes:"",version:2})).rejects.toThrow("小数");
    await expect(saveRevenue(admin,{projectId,date:"2099-01-01",amount:1,notes:"",version:0})).rejects.toThrow("未来");
    await expect(saveRevenue(employee,{projectId,date:"2026-01-01",amount:1,notes:"补录",version:0})).rejects.toMatchObject({status:403});
    await expect(saveRevenue(admin,{projectId,date:"2026-01-01",amount:1,notes:"",version:0})).rejects.toThrow("原因");
  });
  it("sums actual lines including pending only, respects permissions and avoids double counting after approval",async()=>{
    const db=await getReadyDb();const date=dateOnly(new Date());
    const docs=[];
    for(const status of ["APPROVED","PENDING_REVIEW","DRAFT","NEEDS_REVISION"] as const)docs.push(await db.document.create({data:{projectId,docDate:parseDateOnly(date)!,createdById:admin.id,status,totalAmount:999,items:{create:{lineNo:1,name:"测试材料",unit:"斤",quantity:2,unitPrice:25,amount:49.9}}}}));
    let result=await getBusiness(admin,{projectId,from:date,to:date});expect(result.summary.cost).toBe(99.8);expect(result.summary.pending).toBe(49.9);expect(result.categories[0]).toMatchObject({name:"未分类",ratio:100,amount:99.8});expect(result.sourceDifference).toBe(1898.2);
    await db.document.update({where:{id:docs[1].id},data:{status:"APPROVED"}});
    result=await getBusiness(admin,{projectId,from:date,to:date});expect(result.summary.cost).toBe(99.8);expect(result.summary.pending).toBe(0);
    const restricted={...employee,memberships:[{...employee.memberships[0],permissions:["revenue.view" as const]}]};
    result=await getBusiness(restricted,{projectId,from:date,to:date});expect(result.categories).toEqual([]);expect(result.summary.cost).toBe(0);expect(result.analysisProjectCount).toBe(0);expect(result.revenues).toHaveLength(1);
    await expect(getBusiness(employee,{projectId:"prj_sh"})).rejects.toMatchObject({status:403});
  });
  it("requires approval before counting revenue and reopens approval after every edit",async()=>{
    const db=await getReadyDb(),date=dateOnly(new Date());
    let row=await db.projectDailyRevenue.findUniqueOrThrow({where:{projectId_date:{projectId,date:revenueDate(date)}}});
    expect(row.status).toBe("PENDING_REVIEW");
    let result=await getBusiness(admin,{projectId,from:date,to:date});expect(result.summary.revenue).toBe(0);expect(result.summary.rate).toBeNull();expect(result.revenueReview.pendingCount).toBe(1);
    await reviewRevenue(admin,{id:row.id,version:row.version,action:"approve",note:"核对收银日报"});
    row=await db.projectDailyRevenue.findUniqueOrThrow({where:{id:row.id}});
    expect(row).toMatchObject({status:"APPROVED",reviewedById:admin.id,reviewNote:"核对收银日报"});expect(row.reviewedAt).not.toBeNull();
    result=await getBusiness(admin,{projectId,from:date,to:date});expect(result.summary.revenue).toBe(Number(row.amount));expect(result.summary.rate).not.toBeNull();
    const saved=await saveRevenue(employee,{projectId,date,amount:300,notes:"修正营业额",version:row.version});
    expect(saved.status).toBe("PENDING_REVIEW");
    row=await db.projectDailyRevenue.findUniqueOrThrow({where:{id:row.id}});expect(row.reviewedById).toBeNull();expect(row.reviewNote).toBe("");
    result=await getBusiness(admin,{projectId,from:date,to:date});expect(result.summary.revenue).toBe(0);expect(result.summary.incomplete).toBe(true);
  });
  it("enforces reviewer project permissions, return reasons, stale versions and resubmission",async()=>{
    const db=await getReadyDb(),date=dateOnly(new Date());
    let row=await db.projectDailyRevenue.findUniqueOrThrow({where:{projectId_date:{projectId,date:revenueDate(date)}}});
    const payload={id:row.id,version:row.version,action:"approve" as const,note:""};
    for(const user of [employee,{...admin,globalRole:"FINANCE" as const},{...employee,memberships:[]}]) await expect(reviewRevenue(user,payload)).rejects.toMatchObject({status:403});
    await expect(reviewRevenue(admin,{...payload,action:"return"})).rejects.toThrow("原因");
    await expect(reviewRevenue(admin,{...payload,version:row.version-1})).rejects.toMatchObject({status:409});
    const supervisor={...employee,memberships:[{...employee.memberships[0],roles:["SUPERVISOR" as const]}]};
    await reviewRevenue(supervisor,{...payload,action:"return",note:"请核对收款总额"});
    row=await db.projectDailyRevenue.findUniqueOrThrow({where:{id:row.id}});expect(row.status).toBe("NEEDS_REVISION");
    await expect(reviewRevenue(admin,{...payload,version:row.version})).rejects.toMatchObject({status:409});
    const next=await saveRevenue(employee,{projectId,date,amount:0,notes:"未营业",version:row.version});
    await reviewRevenue(admin,{...payload,version:next.version});
    const result=await getBusiness(admin,{projectId,from:date,to:date});expect(result.summary.daily[0].revenue).toBe(0);expect(result.summary.daily[0].rate).toBeNull();
    expect(await db.auditLog.count({where:{entityId:row.id,action:{in:["revenue.approved","revenue.returned"]}}})).toBe(3);
  });
  it("allows only one concurrent reviewer and protects newer edits from stale review",async()=>{
    const db=await getReadyDb(),date=dateOnly(new Date());
    const row=await db.projectDailyRevenue.findUniqueOrThrow({where:{projectId_date:{projectId,date:revenueDate(date)}}});
    const next=await saveRevenue(employee,{projectId,date,amount:500,notes:"",version:row.version});
    const payload={id:row.id,version:next.version,action:"approve" as const,note:""};
    const outcomes=await Promise.allSettled([reviewRevenue(admin,payload),reviewRevenue(admin,{...payload,action:"return",note:"退回"})]);
    expect(outcomes.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    const current=await db.projectDailyRevenue.findUniqueOrThrow({where:{id:row.id}});
    const changed=await saveRevenue(employee,{projectId,date,amount:600,notes:"",version:current.version});
    await expect(reviewRevenue(admin,payload)).rejects.toMatchObject({status:409});
    expect((await db.projectDailyRevenue.findUniqueOrThrow({where:{id:row.id}})).version).toBe(changed.version);
  });
  it("isolates project cards and detail records, uses the displayed revenue as the period denominator",async()=>{
    const db=await getReadyDb(),date=dateOnly(new Date()),other=projectId+"_other";
    try {
      await db.project.create({data:{id:other,code:"BUSINESS-OTHER",name:"另一项目"}});
      await saveRevenue(admin,{projectId:other,date,amount:1000,notes:"",version:0});
      const row=await db.projectDailyRevenue.findUniqueOrThrow({where:{projectId_date:{projectId,date:revenueDate(date)}}});
      await reviewRevenue(admin,{id:row.id,version:row.version,action:"approve",note:""});
      // A prior date with revenue in just one project and no purchases exposed the old denominator bug.
      const prior="2026-01-02";const old=await saveRevenue(admin,{projectId,date:prior,amount:400,notes:"回归测试补录",version:0});
      await reviewRevenue(admin,{id:old.id,version:old.version,action:"approve",note:""});
      const data=await getBusiness(employee,{projectId,from:prior,to:date});
      expect(data.projectId).toBe(projectId);expect(data.projectCards.map(p=>p.id)).toEqual([projectId]);expect(data.revenues.every(r=>r.projectId===projectId)).toBe(true);
      expect(data.summary.revenue).toBe(1000);expect(data.summary.rate).toBe(90.02);
      const overview=await getBusiness(admin,{from:prior,to:date});expect(overview.summary.revenue).toBeGreaterThanOrEqual(1000);
      expect(overview.summary.incomplete).toBe(true);expect(overview.summary.rate).toBeNull();
      const restricted={...employee,memberships:[{...employee.memberships[0],permissions:["revenue.view" as const]}]};
      expect((await getBusiness(restricted,{projectId,from:date,to:date})).projectCards[0].cost).toBeNull();
    } finally {
      await db.auditLog.deleteMany({where:{entityType:"projectDailyRevenue",afterValue:{path:["projectId"],equals:other}}});
      await db.projectDailyRevenue.deleteMany({where:{projectId:other}});await db.project.deleteMany({where:{id:other}});
    }
  });
});

import type { Db } from "@/lib/prisma";
import { parseDateOnly, roundMoney } from "@/lib/text";
import { recomputeDocumentChecksInTransaction } from "./checks";
export const demoWeekBatch="demo-week-20261102";
const prefix="demo_week_20261102";
// Fixed dates make reruns safe even after the demonstration week has passed.
export async function seedDemoWeek(db:Db,apply=false) {
  return db.$transaction(async tx=>{
    const marker=await tx.auditLog.findFirst({where:{entityType:"testDataBatch",entityId:demoWeekBatch,action:"demo.week.seeded"}});
    if(marker)return {batch:demoWeekBatch,skipped:true,reason:"本批已执行；保留后续人工修改和删除，不补回"};
    const projects=await tx.project.findMany({where:{code:{startsWith:"TEST-"},active:true},orderBy:{code:"asc"}});
    const supplier=await tx.supplier.findFirst({where:{name:{startsWith:"测试·优鲜综合"},active:true}});
    const ingredients=await tx.ingredient.findMany({where:{active:true,normalizedName:{in:["青菜","白菜","土豆","猪五花肉","鸡蛋","豆腐","鲈鱼","大米","食用油","生抽"]}},orderBy:{name:"asc"}});
    const author=await tx.user.findFirst({where:{active:true,globalRole:"ADMIN"},orderBy:{createdAt:"asc"}});
    if(projects.length!==5||!supplier||ingredients.length<8||!author)throw new Error("须先具备5个TEST测试项目、测试综合供应商和分类材料；本脚本不重建被删除的旧采购单");
    const dates=Array.from({length:7},(_,i)=>new Date(Date.UTC(2026,9,27+i)).toISOString().slice(0,10));
    const conflicts=await tx.projectDailyRevenue.count({where:{projectId:{in:projects.map(p=>p.id)},date:{gte:new Date(dates[0]),lte:new Date(dates[6])}}});
    if(conflicts)throw new Error("演示周已存在营业额，整批取消以保护人工录入");
    const preview={batch:demoWeekBatch,from:dates[0],to:dates[6],projects:projects.map(p=>p.name),planned:{documents:35,items:35*ingredients.length,revenues:35},synthetic:true};
    if(!apply)return preview;
    const base:Record<string,number>={青菜:2.8,白菜:1.8,土豆:2.2,猪五花肉:17.5,鸡蛋:4.9,豆腐:3.2,鲈鱼:16,大米:128,食用油:68,生抽:9.5};
    for(const [pi,project] of projects.entries())for(const [di,day] of dates.entries()) {
      const id=`${prefix}_${pi}_${di}`;
      if(await tx.document.findUnique({where:{id}}))throw new Error("演示ID冲突，整批取消");
      const items=[];
      for(const [ii,ingredient] of ingredients.entries()) {
        const contract=await tx.contract.findFirst({where:{projectId:project.id,supplierId:supplier.id,ingredientId:ingredient.id,startsOn:{lte:parseDateOnly(day)!},OR:[{endsOn:null},{endsOn:{gte:parseDateOnly(day)!}}]},orderBy:{startsOn:"desc"}});
        const unitPrice=roundMoney(Math.min((base[ingredient.normalizedName]||8)*(1+pi*.035+(di%3-1)*.025),contract?Number(contract.unitPrice):Infinity));
        const quantity=["袋","桶"].includes(ingredient.unit)?2+di%2:10+ii*2+pi+di;
        items.push({id:`${id}_line_${ii}`,lineNo:ii+1,ingredientId:ingredient.id,name:ingredient.name,spec:ingredient.spec,unit:ingredient.unit,quantity,unitPrice,amount:roundMoney(quantity*unitPrice),confidence:1,matchStatus:"MATCHED" as const,matchScore:1});
      }
      const cost=roundMoney(items.reduce((s,i)=>s+i.amount,0));
      const pending=di===6;
      const note=`【虚构演示数据】${demoWeekBatch}；无真实交易、无原图；由脚本生成${pending?"待审核示例":"已通过状态，不代表人工审批"}。`;
      await tx.document.create({data:{id,docNo:`DEMO-${day.replaceAll("-","")}-${pi+1}`,docDate:parseDateOnly(day)!,projectId:project.id,supplierId:supplier.id,ocrSupplierName:supplier.name,supplierMatchStatus:"MATCHED",supplierMatchScore:1,createdById:author.id,status:"DRAFT",subtotal:cost,totalAmount:cost,notes:note,items:{create:items}}});
      const checks=await recomputeDocumentChecksInTransaction(tx,id);
      if(checks.some(c=>c.severity==="ERROR"))throw new Error(`演示单${id}存在严重异常，整批取消`);
      await tx.document.update({where:{id},data:{status:pending?"PENDING_REVIEW":"APPROVED",submittedAt:parseDateOnly(day),reviewedById:pending?null:author.id,reviewedAt:pending?null:parseDateOnly(day),reviewNote:pending?"":note}});
      if(!pending){await tx.checkResult.updateMany({where:{documentId:id},data:{status:"RESOLVED"}});await tx.approvalRecord.create({data:{documentId:id,reviewerId:author.id,action:"APPROVE",note,afterValue:{synthetic:true,batch:demoWeekBatch}}});}
      const revenue=roundMoney(cost/(.45+(di%3)*.045+pi*.015));
      const row=await tx.projectDailyRevenue.create({data:{id:`${id}_revenue`,projectId:project.id,date:new Date(day),amount:revenue,notes:note,createdById:author.id,updatedById:author.id,status:pending?"PENDING_REVIEW":"APPROVED",reviewedById:pending?null:author.id,reviewedAt:pending?null:new Date(),reviewNote:pending?"":"【虚构演示数据】生成时设为通过，仅用于图表展示"}});
      await tx.auditLog.create({data:{entityType:"projectDailyRevenue",entityId:row.id,userId:author.id,action:"demo.revenue.seeded",afterValue:{batch:demoWeekBatch,synthetic:true,projectId:project.id,date:day,amount:revenue}}});
      await tx.auditLog.create({data:{entityType:"document",entityId:id,documentId:id,userId:author.id,action:"demo.document.seeded",afterValue:{batch:demoWeekBatch,synthetic:true}}});
    }
    await tx.auditLog.create({data:{entityType:"testDataBatch",entityId:demoWeekBatch,userId:author.id,action:"demo.week.seeded",afterValue:preview}});
    return {...preview,applied:true};
  },{timeout:120000});
}

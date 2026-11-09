import { getReadyDb } from "@/lib/bootstrap";
import { hasPermission } from "@/lib/permissions";
import { dateOnly, parseDateOnly, roundMoney } from "@/lib/text";
import { ApiError, type SessionUser } from "./auth";

const DAY = 86400000;
// Revenue is a civil China date, stored as DATE without converting midnight +08 to UTC's previous day.
export function revenueDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !parseDateOnly(value)) throw new ApiError(400, "日期无效");
  return new Date(value + "T00:00:00Z");
}
export function revenueEditAllowed(user: SessionUser, projectId: string, date: string, now = new Date()) {
  const today = dateOnly(now);
  return date <= today && hasPermission(user, date === today ? "revenue.edit_today" : "revenue.edit_history", projectId);
}
export function summarizeBusiness(days: Array<{ date: string; revenue: number | null; cost: number; pending: number; documents: number }>) {
  const daily = days.map(day => ({ ...day, profit: day.revenue === null ? null : roundMoney(day.revenue - day.cost),
    rate: day.revenue !== null && day.revenue > 0 ? roundMoney((day.revenue - day.cost) / day.revenue * 100) : null }));
  const revenue = roundMoney(days.reduce((s, d) => s + (d.revenue ?? 0), 0));
  const cost = roundMoney(days.reduce((s, d) => s + d.cost, 0));
  const incomplete = days.some(d => d.revenue === null && d.documents > 0);
  return { daily, revenue, cost, pending: roundMoney(days.reduce((s, d) => s + d.pending, 0)), incomplete,
    rate: !incomplete && revenue > 0 ? roundMoney((revenue - cost) / revenue * 100) : null };
}
export async function saveRevenue(user: SessionUser, input: { projectId: string; date: string; amount: number; notes: string; version: number }) {
  const date = revenueDate(input.date);
  if (input.date > dateOnly(new Date())) throw new ApiError(400, "不能提前录入未来营业额");
  if (!hasPermission(user,"revenue.view",input.projectId) || !revenueEditAllowed(user, input.projectId, input.date)) throw new ApiError(403, "无权修改该项目或日期的营业额");
  if (!Number.isFinite(input.amount) || input.amount < 0 || input.amount > 999999999999.99 || Math.abs(input.amount * 100 - Math.round(input.amount * 100)) > .001) throw new ApiError(400, "营业额须为非负金额，最多两位小数");
  if (!Number.isInteger(input.version) || input.version < 0) throw new ApiError(400, "版本无效");
  if (input.date !== dateOnly(new Date()) && !input.notes.trim()) throw new ApiError(400, "历史营业额补录或修改必须填写原因");
  const db = await getReadyDb();
  if (!await db.project.findFirst({where:{id:input.projectId,active:true}})) throw new ApiError(404,"项目不存在或已停用");
  try {
    return await db.$transaction(async tx => {
      const before = await tx.projectDailyRevenue.findUnique({where:{projectId_date:{projectId:input.projectId,date}}});
      if ((before?.version ?? 0) !== input.version) throw new ApiError(409, "营业额已被其他人修改，请刷新后重试");
      const data = { amount: input.amount, notes: input.notes.trim(), updatedById: user.id,
        status: "PENDING_REVIEW", reviewedById: null, reviewedAt: null, reviewNote: "" };
      let after;
      if (before) {
        const claim = await tx.projectDailyRevenue.updateMany({ where:{id:before.id,version:input.version}, data:{...data,version:{increment:1}} });
        if (claim.count !== 1) throw new ApiError(409,"营业额已被其他人修改，请刷新后重试");
        after = await tx.projectDailyRevenue.findUniqueOrThrow({where:{id:before.id}});
      } else after = await tx.projectDailyRevenue.create({data:{...data, projectId:input.projectId, date, createdById:user.id}});
      await tx.auditLog.create({data:{entityType:"projectDailyRevenue",entityId:after.id,userId:user.id,action:before?"revenue.updated":"revenue.created",
        beforeValue:before?JSON.parse(JSON.stringify(before)):undefined,afterValue:JSON.parse(JSON.stringify(after))}});
      return { id:after.id, version:after.version, amount:Number(after.amount), status:after.status };
    });
  } catch(error) {
    if ((error as {code?:string}).code === "P2002") throw new ApiError(409,"已有营业额记录，请刷新后修改");
    throw error;
  }
}

export async function reviewRevenue(user: SessionUser, input: { id: string; version: number; action: "approve" | "return"; note: string }) {
  if (!["approve", "return"].includes(input.action) || !Number.isInteger(input.version) || input.version < 1) throw new ApiError(400, "审核参数无效");
  const db = await getReadyDb();
  return db.$transaction(async tx => {
    const before = await tx.projectDailyRevenue.findUnique({ where: { id: input.id }, include: { project: { select: { active: true } } } });
    if (!before) throw new ApiError(404, "营业额记录不存在");
    if (!hasPermission(user, "revenue.view", before.projectId) || !hasPermission(user, input.action === "approve" ? "revenue.approve" : "revenue.return", before.projectId)) throw new ApiError(403, "没有该项目营业额审核权限");
    if (!before.project.active) throw new ApiError(400, "项目已停用");
    if (before.version !== input.version || before.status !== "PENDING_REVIEW") throw new ApiError(409, "营业额已变更或已审核，请刷新后重试");
    if (input.action === "return" && !input.note.trim()) throw new ApiError(400, "退回营业额必须填写原因");
    const claim = await tx.projectDailyRevenue.updateMany({ where: { id: input.id, version: input.version, status: "PENDING_REVIEW" }, data: {
      status: input.action === "approve" ? "APPROVED" : "NEEDS_REVISION", reviewedById: user.id, reviewedAt: new Date(), reviewNote: input.note.trim(), version: { increment: 1 },
    } });
    if (claim.count !== 1) throw new ApiError(409, "营业额已变更，请刷新后重试");
    const after = await tx.projectDailyRevenue.findUniqueOrThrow({ where: { id: input.id } });
    const { project: _project, ...snapshot } = before;
    await tx.auditLog.create({ data: { entityType: "projectDailyRevenue", entityId: input.id, userId: user.id, action: `revenue.${input.action === "approve" ? "approved" : "returned"}`,
      beforeValue: JSON.parse(JSON.stringify(snapshot)), afterValue: JSON.parse(JSON.stringify(after)) } });
    return { id: after.id, version: after.version, status: after.status };
  });
}

export async function getBusiness(user: SessionUser, filters: {from?:string;to?:string;projectId?:string}) {
  const db = await getReadyDb();
  const today = dateOnly(new Date());
  const to = filters.to || today;
  const from = filters.from || dateOnly(new Date(Date.now() - 6 * DAY));
  const start = revenueDate(from), end = revenueDate(to);
  if (end < start || (end.getTime() - start.getTime()) / DAY > 365) throw new ApiError(400,"日期区间须在一年内");
  const projects = (await db.project.findMany({where:{active:true},orderBy:{code:"asc"}}))
    .filter(p=>hasPermission(user,"revenue.view",p.id));
  if (!projects.length && !hasPermission(user,"revenue.view")) throw new ApiError(403,"没有营业额查看权限");
  if (filters.projectId && !projects.some(p=>p.id===filters.projectId)) throw new ApiError(403,"无权查看该项目");
  const selected = projects.filter(p=>!filters.projectId || p.id===filters.projectId);
  // Require full project amount and ownership access so a partial cost cannot masquerade as full margin.
  const analysisIds = selected.filter(p=>["analytics.view","document.view_amount","document.view_others"].every(key=>hasPermission(user,key as "analytics.view"|"document.view_amount"|"document.view_others",p.id))).map(p=>p.id);
  const [revenues, docs] = await Promise.all([
    db.projectDailyRevenue.findMany({where:{projectId:{in:selected.map(p=>p.id)},date:{gte:start,lte:end}},orderBy:[{date:"desc"},{projectId:"asc"}]}),
    db.document.findMany({where:{projectId:{in:analysisIds},status:{in:["APPROVED","PENDING_REVIEW"]},docDate:{gte:parseDateOnly(from)!,lt:new Date(parseDateOnly(to)!.getTime()+DAY)}},include:{items:{include:{ingredient:{select:{category:true}}}}}})
  ]);
  const categories = new Map<string,{name:string;amount:number;pending:number}>();
  const days = [];
  let difference=0;
  for (let time=start.getTime();time<=end.getTime();time+=DAY) {
    const day=new Date(time).toISOString().slice(0,10);
    const dayDocs=docs.filter(d=>dateOnly(d.docDate)===day);
    const dayRevenues=revenues.filter(r=>r.status === "APPROVED" && r.date.toISOString().slice(0,10)===day && analysisIds.includes(r.projectId));
    const complete=analysisIds.length>0 && analysisIds.every(id=>dayRevenues.some(r=>r.projectId===id));
    days.push({date:day,revenue:complete?roundMoney(dayRevenues.reduce((s,r)=>s+Number(r.amount),0)):null,
      cost:roundMoney(dayDocs.reduce((s,d)=>s+d.items.reduce((sum,i)=>sum+Number(i.amount),0),0)),
      pending:roundMoney(dayDocs.filter(d=>d.status==="PENDING_REVIEW").reduce((s,d)=>s+d.items.reduce((sum,i)=>sum+Number(i.amount),0),0)),documents:dayDocs.length});
  }
  for (const doc of docs) {
    difference+=Number(doc.totalAmount)-doc.items.reduce((sum,i)=>sum+Number(i.amount),0);
    for (const item of doc.items) {
      const name=item.ingredient?.category?.trim() || "未分类";
      const row=categories.get(name)||{name,amount:0,pending:0};
      row.amount+=Number(item.amount); if(doc.status==="PENDING_REVIEW") row.pending+=Number(item.amount);
      categories.set(name,row);
    }
  }
  const summary=summarizeBusiness(days);
  summary.revenue=roundMoney(revenues.filter(r=>r.status === "APPROVED" && analysisIds.includes(r.projectId)).reduce((sum,r)=>sum+Number(r.amount),0));
  summary.rate=!summary.incomplete && summary.revenue>0?roundMoney((summary.revenue-summary.cost)/summary.revenue*100):null;
  return {today,from,to,projectId:filters.projectId || "",projects:projects.map(p=>({id:p.id,name:p.name,editToday:hasPermission(user,"revenue.edit_today",p.id),editHistory:hasPermission(user,"revenue.edit_history",p.id),approve:hasPermission(user,"revenue.approve",p.id),return:hasPermission(user,"revenue.return",p.id)})),
    projectCards: selected.map(p=>({ id:p.id, name:p.name,
      revenue:roundMoney(revenues.filter(r=>r.projectId===p.id && r.status==="APPROVED").reduce((s,r)=>s+Number(r.amount),0)),
      cost:analysisIds.includes(p.id)?roundMoney(docs.filter(d=>d.projectId===p.id).reduce((s,d)=>s+d.items.reduce((sum,i)=>sum+Number(i.amount),0),0)):null,
      pending:revenues.filter(r=>r.projectId===p.id && r.status==="PENDING_REVIEW").length,
      returned:revenues.filter(r=>r.projectId===p.id && r.status==="NEEDS_REVISION").length,
    })),
    revenueReview: { pendingCount: revenues.filter(r=>r.status === "PENDING_REVIEW").length, returnedCount: revenues.filter(r=>r.status === "NEEDS_REVISION").length },
    revenues:revenues.map(r=>({...r,date:r.date.toISOString().slice(0,10),amount:Number(r.amount)})),
    analysisProjectCount:analysisIds.length,excludedProjects:selected.length-analysisIds.length,summary,
    categories:Array.from(categories.values()).map(c=>({...c,amount:roundMoney(c.amount),pending:roundMoney(c.pending),ratio:summary.cost?roundMoney(c.amount/summary.cost*100):0})).sort((a,b)=>b.amount-a.amount),
    sourceDifference:roundMoney(difference)};
}

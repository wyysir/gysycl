import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { getReadyDb } from "@/lib/bootstrap";
import { hasPermission, type Permission } from "@/lib/permissions";
import { ApiError, canAccessDocument, type SessionUser } from "./auth";
import { assertCurrentAuthorization } from "./authorizations";

type Tx=Prisma.TransactionClient;
const D=Prisma.Decimal;
const text=z.string().trim().max(500);
const id=z.string().min(1).max(100);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s,"日期不合法");
const money=z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/);
const qty=z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?$/);
const common={projectId:id,supplierId:id,requestKey:z.string().uuid()};
export const adjustmentInput=z.object({...common,kind:z.enum(["RETURN","DEDUCTION"]),date,sourceDocumentId:id.optional(),sourceItemId:id.optional(),ingredientId:id.optional(),name:text.default(""),spec:text.default(""),unit:text.default(""),quantity:qty.default("0"),equivalentQuantity:qty.optional(),amount:money,reason:text.default(""),fileIds:z.array(id).max(12).default([])});
export const statementInput=z.object({...common,from:date,to:date}).refine(x=>x.from<=x.to,"开始日期不能晚于结束日期");
const allocations=z.array(z.object({statementId:id,amount:money})).min(1).max(100).refine(rows=>new Set(rows.map(r=>r.statementId)).size===rows.length,"不能重复选择同一期");
export const invoiceInput=z.object({...common,number:z.string().trim().min(1).max(80).transform(s=>s.replace(/\s/g,"")),seller:text.min(1),buyer:text.min(1),amount:money,allocations,fileIds:z.array(id).min(1).max(12),confirmed:z.literal(true)});
export const paymentInput=z.object({...common,allocations});
export function need(user:SessionUser,key:Permission,projectId:string,financial=false){if(!hasPermission(user,key,projectId)||financial&&!hasPermission(user,"document.view_amount",projectId))throw new ApiError(403,"没有此项权限、金额权限或项目范围");}
function positive(n:Prisma.Decimal,label:string){if(!n.greaterThan(0))throw new ApiError(400,label+"须大于0");}
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function lock(tx:Tx,projectId:string,supplierId:string){
  const project=await tx.$queryRaw<Array<{id:string;active:boolean}>>`SELECT id,active FROM "Project" WHERE id=${projectId} FOR SHARE`;
  const supplier=await tx.$queryRaw<Array<{id:string;active:boolean;name:string}>>`SELECT id,active,name FROM "Supplier" WHERE id=${supplierId} FOR UPDATE`;
  if(!project[0]||!supplier[0])throw new ApiError(404,"项目或供应商不存在");
  if(!project[0].active||!supplier[0].active)throw new ApiError(409,"项目或供应商已停用，不能新增业务");
  return supplier[0];
}

export async function updateInvoice(user:SessionUser,raw:unknown){
 const input=z.object({id,version:z.number().int().positive(),number:z.string().trim().min(1).max(80).transform(s=>s.replace(/\s/g,"")),seller:text.min(1),buyer:text.min(1)}).parse(raw),db=await getReadyDb();
 return db.$transaction(async tx=>{const initial=await tx.supplierInvoice.findUnique({where:{id:input.id}});if(!initial)throw new ApiError(404,"发票不存在");need(user,"invoice.edit",initial.projectId,true);need(user,"invoice.view",initial.projectId);const supplier=await lock(tx,initial.projectId,initial.supplierId);await assertCurrentAuthorization(tx,user.id,"invoice.edit",initial.projectId,true);const row=await tx.supplierInvoice.findUniqueOrThrow({where:{id:input.id},include:{allocations:true}});if(row.version!==input.version)throw new ApiError(409,"发票已变化，请刷新");if(await tx.supplierPaymentAllocation.count({where:{statementId:{in:row.allocations.map(a=>a.statementId)}}}))throw new ApiError(409,"相关期款已有付款，不能更改发票记录");const aliases=await tx.supplierAlias.findMany({where:{supplierId:row.supplierId}});const normalized=(s:string)=>s.replace(/[\s（）()]/g,"");if(![supplier.name,...aliases.map(a=>a.alias)].some(n=>normalized(n)===normalized(input.seller)))throw new ApiError(400,"开票方与供应商不一致");const updated=await tx.supplierInvoice.update({where:{id:row.id},data:{number:input.number,seller:input.seller,buyer:input.buyer,version:{increment:1}}});await audit(tx,user,"supplierInvoice",row.id,"invoice.metadataCorrected",{number:input.number,seller:input.seller,buyer:input.buyer,amountUnchanged:row.amount.toFixed(2)});return updated;});
}
async function audit(tx:Tx,user:SessionUser,entityType:string,entityId:string,action:string,afterValue:Prisma.InputJsonValue){await tx.auditLog.create({data:{userId:user.id,entityType,entityId,action,afterValue}});}
async function filesFor(tx:Tx,user:SessionUser,input:{projectId:string;supplierId:string;fileIds:string[]},kind:string){
 if(new Set(input.fileIds).size!==input.fileIds.length)throw new ApiError(400,"附件不可重复");
 const files=await tx.supplierFile.findMany({where:{id:{in:input.fileIds},projectId:input.projectId,supplierId:input.supplierId,kind,createdById:user.id,invoiceId:null,adjustmentId:null}});
 if(files.length!==input.fileIds.length)throw new ApiError(400,"附件范围、归属或状态不符，请重新上传");return files;
}
export async function createAdjustment(user:SessionUser,raw:unknown){
 const input=adjustmentInput.parse(raw),isReturn=input.kind==="RETURN";need(user,isReturn?"return.create":"deduction.create",input.projectId,true);
 const amount=new D(input.amount);positive(amount,"金额");const db=await getReadyDb(),requestHash=hash(input);
 return db.$transaction(async tx=>{
  await lock(tx,input.projectId,input.supplierId);await assertCurrentAuthorization(tx,user.id,isReturn?"return.create":"deduction.create",input.projectId,true);
  const old=await tx.supplierAdjustment.findUnique({where:{requestKey:input.requestKey}});if(old){if(old.createdById!==user.id||old.requestHash!==requestHash)throw new ApiError(409,"相同请求号的内容或操作人不一致");return old;}
  let sourceDocumentId=input.sourceDocumentId||null,ingredientId=input.ingredientId||null,name=input.name,spec=input.spec,unit=input.unit,sourceUnit=unit,equivalent=new D(input.equivalentQuantity||input.quantity),quantity=new D(input.quantity),price=new D(0),snapshot:Prisma.InputJsonValue={mode:"independent"};
  if(sourceDocumentId){await tx.$queryRaw`SELECT id FROM "Document" WHERE id=${sourceDocumentId} FOR SHARE`;const doc=await tx.document.findUnique({where:{id:sourceDocumentId}});if(!doc||doc.projectId!==input.projectId||doc.supplierId!==input.supplierId||doc.status!=="APPROVED"||!canAccessDocument(user,doc))throw new ApiError(400,"原采购单范围、状态或查看权限不符");}
  if(isReturn){
    positive(quantity,"退货数量");if(!unit)throw new ApiError(400,"请选择退货单位");
    if(input.sourceItemId){
      await tx.$queryRaw`SELECT id FROM "DocumentItem" WHERE id=${input.sourceItemId} FOR UPDATE`;
      const item=await tx.documentItem.findUnique({where:{id:input.sourceItemId},include:{document:true,ingredient:true}});
      if(!item||item.document.projectId!==input.projectId||item.document.supplierId!==input.supplierId||item.document.status!=="APPROVED"||!canAccessDocument(user,item.document)||sourceDocumentId&&sourceDocumentId!==item.documentId)throw new ApiError(400,"退货原明细必须属于同项目同供应商的已审核采购单");
      await tx.$queryRaw`SELECT id FROM "Document" WHERE id=${item.documentId} FOR SHARE`;
      const currentSource=await tx.document.findUniqueOrThrow({where:{id:item.documentId}});if(currentSource.status!=="APPROVED")throw new ApiError(409,"原采购状态已变化");
      sourceDocumentId=item.documentId;ingredientId=item.ingredientId;name=item.name;spec=item.spec;sourceUnit=item.unit;price=item.unitPrice;
      if(unit===sourceUnit)equivalent=quantity;
      else {
        const chosen=await tx.ingredient.findFirst({where:{name:item.ingredient?.name||item.name,spec:item.ingredient?.spec||item.spec,unit,active:true},include:{productSpecification:true}});
        if(!chosen)throw new ApiError(400,"只能选择同品名同规格已有的采购单位");
        // A confirmed historical conversion is authoritative for the original unit.
        const original=item.measurementSnapshot as {productId?:string;unitQuantity?:string;productBaseUnit?:string}|null;
        const confirmedFactor=chosen.quantityPerProductUnit&&original?.unitQuantity&&chosen.productSpecificationId===original.productId&&chosen.productSpecification?.baseUnit===original.productBaseUnit?chosen.quantityPerProductUnit:null;
        if(confirmedFactor&&original?.unitQuantity)equivalent=quantity.mul(confirmedFactor).div(original.unitQuantity).toDecimalPlaces(4);
        else if(!input.equivalentQuantity)throw new ApiError(400,"没有可用换算，请填写本次折合原采购单位数量");
        snapshot={mode:confirmedFactor?"confirmed":"manual",chosenIngredientId:chosen.id,originalUnit:sourceUnit,equivalent:equivalent.toString(),chosenFactor:confirmedFactor?.toString()??null,productBaseUnit:chosen.productSpecification?.baseUnit??null,originalUnitQuantity:original?.unitQuantity??null};
      }
      positive(equivalent,"折合数量");const reserved=await tx.supplierAdjustment.aggregate({where:{sourceItemId:item.id,kind:"RETURN",status:{in:["DRAFT","PENDING","APPROVED","RETURNED"]}},_sum:{equivalentQuantity:true}});
      if(equivalent.add(reserved._sum.equivalentQuantity||0).greaterThan(item.quantity))throw new ApiError(409,"退货数量超过原采购量（含其他草稿和待审退货占用）");
    }else{
      if(sourceDocumentId)throw new ApiError(400,"关联原采购退货必须指定材料行");
      if(!name||!ingredientId)throw new ApiError(400,"独立退货请选择已有采购材料");
      const ingredient=await tx.ingredient.findUnique({where:{id:ingredientId}});if(!ingredient||!ingredient.active||ingredient.unit!==unit||ingredient.name!==name||ingredient.spec!==spec)throw new ApiError(400,"独立退货材料、规格或单位不符");
      equivalent=quantity;
    }
  }else if(input.sourceItemId)throw new ApiError(400,"扣款关联采购单，不指定材料行");
  const files=await filesFor(tx,user,input,input.kind);
  const row=await tx.supplierAdjustment.create({data:{requestKey:input.requestKey,requestHash,projectId:input.projectId,supplierId:input.supplierId,kind:input.kind,status:isReturn?"DRAFT":"APPROVED",date:new Date(input.date),sourceDocumentId,sourceItemId:isReturn?input.sourceItemId:null,ingredientId:isReturn?ingredientId:null,name,spec,unit,quantity:isReturn?quantity:0,equivalentQuantity:isReturn?equivalent:0,sourceUnit,unitPrice:price,amount,reason:input.reason,conversionSnapshot:snapshot,createdById:user.id}});
  if(files.length)await tx.supplierFile.updateMany({where:{id:{in:files.map(f=>f.id)}},data:{adjustmentId:row.id}});
  await audit(tx,user,"supplierAdjustment",row.id,isReturn?"return.drafted":"deduction.effective",{amount:amount.toFixed(2),sourceDocumentId});return row;
 });
}
export async function changeAdjustment(user:SessionUser,input:{id:string;version:number;action:"submit"|"approve"|"return"|"edit";reason?:string;amount?:string;quantity?:string;unit?:string;equivalentQuantity?:string}){
 const db=await getReadyDb();return db.$transaction(async tx=>{
  const found=await tx.supplierAdjustment.findUnique({where:{id:input.id}});if(!found)throw new ApiError(404,"记录不存在");await lock(tx,found.projectId,found.supplierId);
  const row=await tx.supplierAdjustment.findUniqueOrThrow({where:{id:input.id}});if(row.version!==input.version)throw new ApiError(409,"记录已变化，请刷新");
  const key:Permission=input.action==="submit"?"return.submit":input.action==="approve"||input.action==="return"?"return.approve":row.kind==="RETURN"?"return.edit":"deduction.edit";need(user,key,row.projectId,true);await assertCurrentAuthorization(tx,user.id,key,row.projectId,true);
  let status=row.status;const data:Prisma.SupplierAdjustmentUpdateInput={version:{increment:1}};
  if(input.action==="submit"){if(row.kind!=="RETURN"||!["DRAFT","RETURNED"].includes(status))throw new ApiError(409,"只有退货草稿或退回记录可提交");status="PENDING";}
  else if(input.action==="approve"||input.action==="return"){if(row.kind!=="RETURN"||status!=="PENDING")throw new ApiError(409,"只有待审退货可审核");status=input.action==="approve"?"APPROVED":"RETURNED";data.reviewedById=user.id;data.reviewedAt=new Date();data.reviewNote=input.reason||"";}
  else{if(row.kind==="RETURN"&&!["DRAFT","RETURNED"].includes(status))throw new ApiError(409,"已审核退货不能修改");if(row.kind==="DEDUCTION"){const linked=await tx.supplierStatementLine.findMany({where:{adjustmentId:row.id},include:{statement:true}});if(linked.some(l=>l.statement.status!=="OPEN"))throw new ApiError(409,"扣款已计入开票对账，不能修改");if(linked.length){need(user,"statement.edit",row.projectId,true);await assertCurrentAuthorization(tx,user.id,"statement.edit",row.projectId,true);}}if(input.amount!==undefined){const amount=new D(money.parse(input.amount));positive(amount,"金额");data.amount=amount;}if(input.reason!==undefined)data.reason=text.parse(input.reason);}
  if(input.action==="edit"&&row.kind==="RETURN"){
    const quantity=new D(qty.parse(input.quantity??row.quantity.toString())),unit=text.parse(input.unit??row.unit);positive(quantity,"退货数量");let equivalent=quantity;
    if(row.sourceItemId){
      await tx.$queryRaw`SELECT id FROM "DocumentItem" WHERE id=${row.sourceItemId} FOR UPDATE`;
      const item=await tx.documentItem.findUniqueOrThrow({where:{id:row.sourceItemId},include:{ingredient:true}});
      if(unit!==row.sourceUnit){const chosen=await tx.ingredient.findFirst({where:{name:item.ingredient?.name||item.name,spec:item.ingredient?.spec||item.spec,unit,active:true},include:{productSpecification:true}});if(!chosen)throw new ApiError(400,"请选择同品名同规格已有单位");const original=item.measurementSnapshot as {productId?:string;unitQuantity?:string;productBaseUnit?:string}|null;if(chosen.quantityPerProductUnit&&original?.unitQuantity&&chosen.productSpecificationId===original.productId&&chosen.productSpecification?.baseUnit===original.productBaseUnit){equivalent=quantity.mul(chosen.quantityPerProductUnit).div(original.unitQuantity).toDecimalPlaces(4);data.conversionSnapshot={mode:"confirmed",chosenIngredientId:chosen.id,originalUnit:row.sourceUnit,equivalent:equivalent.toString()};}else{if(!input.equivalentQuantity)throw new ApiError(400,"请填写本次折合原采购单位数量");equivalent=new D(qty.parse(input.equivalentQuantity));data.conversionSnapshot={mode:"manual",originalUnit:row.sourceUnit,equivalent:equivalent.toString()};}}
      positive(equivalent,"折合数量");const reserved=await tx.supplierAdjustment.aggregate({where:{sourceItemId:row.sourceItemId,id:{not:row.id},status:{in:["DRAFT","PENDING","APPROVED","RETURNED"]}},_sum:{equivalentQuantity:true}});if(equivalent.add(reserved._sum.equivalentQuantity||0).greaterThan(item.quantity))throw new ApiError(409,"退货数量超过原采购量（含其他退货占用）");
    }else{const chosen=await tx.ingredient.findFirst({where:{name:row.name,spec:row.spec,unit,active:true},include:{productSpecification:true}});if(!chosen)throw new ApiError(400,"请选择同品名同规格已有单位");data.ingredient={connect:{id:chosen.id}};data.sourceUnit=unit;}
    data.quantity=quantity;data.unit=unit;data.equivalentQuantity=equivalent;
  }
  data.status=status;const updated=await tx.supplierAdjustment.update({where:{id:row.id},data});
  if(input.action==="edit"&&row.kind==="DEDUCTION"){
    const linked=await tx.supplierStatement.findMany({where:{lines:{some:{adjustmentId:row.id}}},orderBy:[{createdAt:"asc"},{id:"asc"}]});
    for(const statement of linked){const refreshed=await rebuildStatement(tx,user,{projectId:row.projectId,supplierId:row.supplierId,requestKey:statement.requestKey,from:statement.from.toISOString().slice(0,10),to:statement.to.toISOString().slice(0,10)},statement.id);await audit(tx,user,"supplierStatement",statement.id,"statement.creditCorrected",{adjustmentId:row.id,payable:refreshed.payable.toFixed(2)});}
  }
  await audit(tx,user,"supplierAdjustment",row.id,"adjustment."+input.action,{status,version:updated.version});return updated;
 });
}
async function rebuildStatement(tx:Tx,user:SessionUser,input:z.infer<typeof statementInput>,statementId:string){
 // Reservations in other periods are excluded; updating an OPEN statement releases only its own lines.
 await tx.supplierStatementLine.deleteMany({where:{statementId}});
 const documents=await tx.document.findMany({where:{projectId:input.projectId,supplierId:input.supplierId,status:"APPROVED",docDate:{lte:new Date(input.to)},supplierStatementLines:{none:{}}},include:{items:{orderBy:{lineNo:"asc"}}},orderBy:[{docDate:"asc"},{id:"asc"}]});
 let gross=new D(0);for(const doc of documents){await tx.$queryRaw`SELECT id FROM "Document" WHERE id=${doc.id} FOR SHARE`;const current=await tx.document.findUniqueOrThrow({where:{id:doc.id}});if(current.version!==doc.version||current.status!=="APPROVED")throw new ApiError(409,"采购单在生成对账期间变化，请重试");if(!canAccessDocument(user,doc))throw new ApiError(403,"生成对账需要查看本项目其他人员采购单的权限");gross=gross.add(doc.totalAmount);await tx.supplierStatementLine.create({data:{statementId,documentId:doc.id,kind:"PURCHASE",amount:doc.totalAmount,sourceDate:doc.docDate,snapshot:{id:doc.id,docNo:doc.docNo,date:doc.docDate.toISOString().slice(0,10),version:doc.version,late:doc.docDate<new Date(input.from),subtotal:doc.subtotal.toFixed(2),taxAmount:doc.taxAmount.toFixed(2),items:doc.items.map(i=>({id:i.id,name:i.name,spec:i.spec,unit:i.unit,quantity:i.quantity.toString(),unitPrice:i.unitPrice.toString(),amount:i.amount.toFixed(2)}))}}});}
 const adjustments=await tx.supplierAdjustment.findMany({where:{projectId:input.projectId,supplierId:input.supplierId,status:"APPROVED",date:{lte:new Date(input.to)}},include:{lines:true},orderBy:[{date:"asc"},{id:"asc"}]});
 let capacity=gross,returns=new D(0),deductions=new D(0);
 for(const a of adjustments){const used=a.lines.reduce((sum,l)=>sum.add(l.amount),new D(0)),remaining=a.amount.sub(used);if(!remaining.greaterThan(0)||!capacity.greaterThan(0))continue;const take=D.min(capacity,remaining);capacity=capacity.sub(take);if(a.kind==="RETURN")returns=returns.add(take);else deductions=deductions.add(take);await tx.supplierStatementLine.create({data:{statementId,adjustmentId:a.id,kind:a.kind,amount:take,sourceDate:a.date,snapshot:{id:a.id,kind:a.kind,name:a.name,spec:a.spec,unit:a.unit,quantity:a.quantity.toString(),sourceUnit:a.sourceUnit,equivalentQuantity:a.equivalentQuantity.toString(),unitPrice:a.unitPrice.toString(),originalAmount:a.amount.toFixed(2),reason:a.reason,sourceDocumentId:a.sourceDocumentId,sourceItemId:a.sourceItemId,conversion:a.conversionSnapshot}}});}
 if(!documents.length)throw new ApiError(400,"没有可对账的已审核采购，剩余抵扣继续保留");
 return tx.supplierStatement.update({where:{id:statementId},data:{from:new Date(input.from),to:new Date(input.to),gross,returns,deductions,payable:capacity,version:{increment:1}}});
}
export async function createStatement(user:SessionUser,raw:unknown){const input=statementInput.parse(raw);need(user,"statement.generate",input.projectId,true);const db=await getReadyDb(),requestHash=hash(input);return db.$transaction(async tx=>{await lock(tx,input.projectId,input.supplierId);await assertCurrentAuthorization(tx,user.id,"statement.generate",input.projectId,true);const old=await tx.supplierStatement.findUnique({where:{requestKey:input.requestKey}});if(old){if(old.requestHash!==requestHash||old.createdById!==user.id)throw new ApiError(409,"重复请求内容或操作人不符");return old;}const row=await tx.supplierStatement.create({data:{requestKey:input.requestKey,requestHash,projectId:input.projectId,supplierId:input.supplierId,from:new Date(input.from),to:new Date(input.to),gross:0,returns:0,deductions:0,payable:0,createdById:user.id}});const result=await rebuildStatement(tx,user,input,row.id);await audit(tx,user,"supplierStatement",row.id,"statement.created",{payable:result.payable.toFixed(2)});return result;},{timeout:30000});}
export async function updateStatement(user:SessionUser,raw:unknown){const body=z.object({id,version:z.number().int().positive(),from:date,to:date}).refine(x=>x.from<=x.to).parse(raw),db=await getReadyDb();return db.$transaction(async tx=>{const initial=await tx.supplierStatement.findUnique({where:{id:body.id}});if(!initial)throw new ApiError(404,"对账不存在");need(user,"statement.edit",initial.projectId,true);await lock(tx,initial.projectId,initial.supplierId);await assertCurrentAuthorization(tx,user.id,"statement.edit",initial.projectId,true);const row=await tx.supplierStatement.findUniqueOrThrow({where:{id:body.id}});if(row.status!=="OPEN"||row.version!==body.version)throw new ApiError(409,"已开票或记录已变化，不能更新");const result=await rebuildStatement(tx,user,{projectId:row.projectId,supplierId:row.supplierId,requestKey:row.requestKey,from:body.from,to:body.to},row.id);await audit(tx,user,"supplierStatement",row.id,"statement.updated",{payable:result.payable.toFixed(2)});return result;},{timeout:30000});}
export async function createInvoice(user:SessionUser,raw:unknown){const input=invoiceInput.parse(raw);need(user,"invoice.edit",input.projectId,true);need(user,"invoice.view",input.projectId);const db=await getReadyDb(),amount=new D(input.amount),requestHash=hash(input);positive(amount,"票额");if(!input.allocations.reduce((s,a)=>s.add(a.amount),new D(0)).equals(amount))throw new ApiError(400,"分配各期票额合计必须等于实际价税合计");return db.$transaction(async tx=>{
 const supplier=await lock(tx,input.projectId,input.supplierId);await assertCurrentAuthorization(tx,user.id,"invoice.edit",input.projectId,true);await assertCurrentAuthorization(tx,user.id,"invoice.view",input.projectId);const old=await tx.supplierInvoice.findUnique({where:{requestKey:input.requestKey}});if(old){if(old.requestHash!==requestHash||old.createdById!==user.id)throw new ApiError(409,"重复请求内容或操作人不符");return old;}
 const aliases=await tx.supplierAlias.findMany({where:{supplierId:input.supplierId}});const normalized=(s:string)=>s.replace(/[\s（）()]/g,"");if(![supplier.name,...aliases.map(a=>a.alias)].some(n=>normalized(n)===normalized(input.seller)))throw new ApiError(400,"开票方与供应商及其已登记别名不一致，请人工核实");
 const files=await filesFor(tx,user,input,"INVOICE");
 for(const a of [...input.allocations].sort((a,b)=>a.statementId.localeCompare(b.statementId))){const statement=await tx.supplierStatement.findUnique({where:{id:a.statementId},include:{invoices:true,lines:{where:{kind:"PURCHASE"},include:{document:true}}}});if(!statement||statement.projectId!==input.projectId||statement.supplierId!==input.supplierId)throw new ApiError(400,"发票不能跨项目或供应商");if(statement.lines.some(l=>!l.document||l.document.status!=="APPROVED"||(l.snapshot as {version?:number}).version!==l.document.version))throw new ApiError(409,"来源采购已变化，请更新未开票对账后再保存发票");const remaining=statement.payable.sub(statement.invoices.reduce((s,i)=>s.add(i.amount),new D(0)));positive(new D(a.amount),"分配票额");if(new D(a.amount).greaterThan(remaining))throw new ApiError(400,"分配票额超过该期尚待开票金额");}
 const invoice=await tx.supplierInvoice.create({data:{requestKey:input.requestKey,requestHash,projectId:input.projectId,supplierId:input.supplierId,number:input.number,seller:input.seller,buyer:input.buyer,amount,createdById:user.id,allocations:{create:input.allocations.map(a=>({statementId:a.statementId,amount:new D(a.amount)}))}}});
 await tx.supplierFile.updateMany({where:{id:{in:files.map(f=>f.id)}},data:{invoiceId:invoice.id}});await tx.supplierStatement.updateMany({where:{id:{in:input.allocations.map(a=>a.statementId)}},data:{status:"INVOICED",version:{increment:1}}});await audit(tx,user,"supplierInvoice",invoice.id,"invoice.confirmed",{number:invoice.number,amount:amount.toFixed(2)});return invoice;
 });}
export async function createPayment(user:SessionUser,raw:unknown){const input=paymentInput.parse(raw);need(user,"payment.execute",input.projectId,true);need(user,"payment.view",input.projectId);need(user,"statement.view",input.projectId);const db=await getReadyDb(),requestHash=hash({...input,allocations:[...input.allocations].sort((a,b)=>a.statementId.localeCompare(b.statementId))});return db.$transaction(async tx=>{
 await lock(tx,input.projectId,input.supplierId);await assertCurrentAuthorization(tx,user.id,"payment.execute",input.projectId,true);await assertCurrentAuthorization(tx,user.id,"payment.view",input.projectId);await assertCurrentAuthorization(tx,user.id,"statement.view",input.projectId);const old=await tx.supplierPayment.findUnique({where:{requestKey:input.requestKey},include:{allocations:true}});if(old){if(old.requestHash!==requestHash||old.createdById!==user.id)throw new ApiError(409,"付款请求号相同但内容或操作人不符");return old;}
 let total=new D(0);for(const a of [...input.allocations].sort((a,b)=>a.statementId.localeCompare(b.statementId))){const n=new D(a.amount);positive(n,"付款金额");const row=await tx.supplierStatement.findUnique({where:{id:a.statementId},include:{invoices:true,payments:true}});if(!row||row.projectId!==input.projectId||row.supplierId!==input.supplierId)throw new ApiError(400,"付款不能跨项目或供应商");const invoiced=row.invoices.reduce((s,i)=>s.add(i.amount),new D(0)),paid=row.payments.reduce((s,p)=>s.add(p.amount),new D(0));if(row.status!=="INVOICED"||!invoiced.equals(row.payable))throw new ApiError(409,"所选期发票未齐全或金额不符，不能付款");if(n.greaterThan(row.payable.sub(paid)))throw new ApiError(409,"本次付款超过该期剩余待付");total=total.add(n);}
 const payment=await tx.supplierPayment.create({data:{requestKey:input.requestKey,requestHash,projectId:input.projectId,supplierId:input.supplierId,amount:total,createdById:user.id,allocations:{create:input.allocations.map(a=>({statementId:a.statementId,amount:new D(a.amount)}))}},include:{allocations:true}});await audit(tx,user,"supplierPayment",payment.id,"payment.recorded",{amount:total.toFixed(2),systemOperationTime:payment.createdAt.toISOString()});return payment;
 });}

export async function supplierBusinessData(user:SessionUser,projectId:string,supplierId:string,from:string,to:string){
 if(!projectId||!supplierId)return {documents:[],adjustments:[],statements:[],invoices:[],payments:[]};
 const range=statementInput.parse({projectId,supplierId,from,to,requestKey:"00000000-0000-4000-8000-000000000000"});void range;
 const keys:Permission[]=["statement.view","return.view","deduction.view","invoice.view","payment.view","return.create","deduction.create"];if(!keys.some(k=>hasPermission(user,k,projectId)))throw new ApiError(403,"没有该项目供应商业务权限");
 const db=await getReadyDb(),scope={projectId,supplierId},amount=hasPermission(user,"document.view_amount",projectId),price=hasPermission(user,"document.view_unit_price",projectId),can=(key:Permission)=>hasPermission(user,key,projectId);
 const [documents,adjustments,statements,invoices,payments]=await Promise.all([
  can("statement.view")||can("return.create")||can("deduction.create")?db.document.findMany({where:{...scope,status:"APPROVED",docDate:{lte:new Date(to)}},include:{items:{orderBy:{lineNo:"asc"}},supplierStatementLines:{select:{statementId:true}}},orderBy:[{docDate:"asc"},{id:"asc"}]}):[],
  db.supplierAdjustment.findMany({where:{...scope,kind:{in:[...(can("return.view")?["RETURN"]:[]),...(can("deduction.view")?["DEDUCTION"]:[])]}},include:{lines:{select:{statementId:true,amount:true,statement:{select:{status:true}}}},files:{select:{id:true,fileName:true}}},orderBy:{date:"desc"}}),
  can("statement.view")?db.supplierStatement.findMany({where:scope,include:{lines:true,invoices:true,payments:true},orderBy:{createdAt:"desc"}}):[],
  can("invoice.view")?db.supplierInvoice.findMany({where:scope,include:{files:{select:{id:true,fileName:true}},allocations:true},orderBy:{createdAt:"desc"}}):[],
  can("payment.view")?db.supplierPayment.findMany({where:scope,include:{allocations:true},orderBy:{createdAt:"desc"}}):[]
 ]);
 return {documents:documents.filter(d=>canAccessDocument(user,d)).map(d=>({id:d.id,docNo:d.docNo,date:d.docDate.toISOString().slice(0,10),version:d.version,amount:amount?d.totalAmount.toFixed(2):null,late:d.docDate<new Date(from),statementId:d.supplierStatementLines[0]?.statementId||null,items:d.items.map(i=>({id:i.id,ingredientId:i.ingredientId,name:i.name,spec:i.spec,unit:i.unit,quantity:i.quantity.toString(),unitPrice:price?i.unitPrice.toString():null,amount:amount?i.amount.toFixed(2):null}))})),
 adjustments:adjustments.map(a=>({id:a.id,kind:a.kind,status:a.status,editable:a.kind==="RETURN"?["DRAFT","RETURNED"].includes(a.status):a.lines.every(l=>l.statement.status==="OPEN"),requiresStatementEdit:a.lines.length>0,date:a.date.toISOString().slice(0,10),sourceDocumentId:a.sourceDocumentId,sourceItemId:a.sourceItemId,ingredientId:a.ingredientId,name:a.name,spec:a.spec,unit:a.unit,quantity:a.quantity.toString(),equivalentQuantity:a.equivalentQuantity.toString(),sourceUnit:a.sourceUnit,amount:amount?a.amount.toFixed(2):null,remaining:amount?a.amount.sub(a.lines.reduce((s,l)=>s.add(l.amount),new D(0))).toFixed(2):null,reason:amount&&price?a.reason:"",version:a.version,files:amount&&price?a.files:[]})),
 statements:statements.map(s=>({id:s.id,from:s.from.toISOString().slice(0,10),to:s.to.toISOString().slice(0,10),status:s.status,version:s.version,paymentEligible:s.status==="INVOICED"&&s.invoices.reduce((sum,i)=>sum.add(i.amount),new D(0)).equals(s.payable),gross:amount?s.gross.toFixed(2):null,returns:amount?s.returns.toFixed(2):null,deductions:amount?s.deductions.toFixed(2):null,procurementNet:amount?s.gross.sub(s.returns).toFixed(2):null,payable:amount?s.payable.toFixed(2):null,invoiced:amount&&can("invoice.view")?s.invoices.reduce((n,i)=>n.add(i.amount),new D(0)).toFixed(2):null,paid:amount&&can("payment.view")?s.payments.reduce((n,p)=>n.add(p.amount),new D(0)).toFixed(2):null,balance:amount&&can("payment.view")?s.payable.sub(s.payments.reduce((n,p)=>n.add(p.amount),new D(0))).toFixed(2):null,lines:s.lines.filter(l=>l.kind==="PURCHASE"||l.kind==="RETURN"&&can("return.view")||l.kind==="DEDUCTION"&&can("deduction.view")).map(l=>({id:l.id,documentId:l.documentId,adjustmentId:l.adjustmentId,kind:l.kind,date:l.sourceDate.toISOString().slice(0,10),amount:amount?l.amount.toFixed(2):null,snapshot:can("document.view_others")&&amount&&price?l.snapshot:null}))})),
 invoices:invoices.map(i=>({id:i.id,version:i.version,number:i.number,seller:i.seller,buyer:i.buyer,amount:amount?i.amount.toFixed(2):null,files:can("invoice.file")&&amount?i.files:[],allocations:i.allocations.map(a=>({statementId:a.statementId,amount:amount?a.amount.toFixed(2):null}))})),
 payments:payments.map(p=>({id:p.id,createdAt:p.createdAt.toISOString(),amount:amount?p.amount.toFixed(2):null,allocations:p.allocations.map(a=>({statementId:a.statementId,amount:amount?a.amount.toFixed(2):null}))}))};
}
export type SupplierBusinessData=Awaited<ReturnType<typeof supplierBusinessData>>;

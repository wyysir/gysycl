import crypto from "node:crypto";
import { getReadyDb } from "@/lib/bootstrap";
import { canSubmitRecord, canViewRecord, hasPermission, documentVisibility } from "@/lib/permissions";
import { dateOnly, parseDateOnly } from "@/lib/text";
import { ApiError, type SessionUser } from "./auth";
import { createUploadTarget, readObject, sniffImageMime, writePrivateOriginal, deleteObject } from "./storage";
import { documentDto, enqueueOcr } from "./documents";
import { generateDocumentNumber } from "./document-number";
import { visibleDocument, documentReadScope } from "./read-scope";
import { claimDocumentVersion } from "./document-lock";
import { recomputeDocumentChecksInTransaction } from "./checks";
import { submitDocument } from "./document-service";
import type { Prisma } from "@/generated/prisma/client";

const include = { project: true, supplier: true, items: {orderBy: {lineNo: "asc"}}, pages: {orderBy: {pageNo: "asc"}}, checks: true } satisfies Prisma.DocumentInclude;

async function authorizedBatch(user: SessionUser, id: string, uploading = false) {
  const db = await getReadyDb();
  const batch = await db.uploadBatch.findUnique({ where: { id }, include: { photos: {orderBy: {position: "asc"}} } });
  if (!batch || !canViewRecord(user, batch)) throw new ApiError(404, "批次不存在或无权查看");
  if (uploading && (batch.createdById !== user.id || !hasPermission(user, "document.create", batch.projectId)
    || !hasPermission(user, "document.ocr", batch.projectId))) throw new ApiError(403, "无权继续上传该批次");
  return batch;
}

export async function createBatch(user: SessionUser, input: {requestId: string; projectId: string; docDate: string; fileNames: string[]}) {
  if (!input.fileNames.length || input.fileNames.length > 10) throw new ApiError(400, "每批只能上传 1–10 张独立单据");
  if (!hasPermission(user, "document.create", input.projectId) || !hasPermission(user, "document.ocr", input.projectId)) throw new ApiError(403, "无权在该项目上传识别");
  const docDate = parseDateOnly(input.docDate);
  if (!docDate) throw new ApiError(400, "请选择有效日期");
  const db = await getReadyDb();
  if (!await db.project.findFirst({where: {id: input.projectId, active: true}})) throw new ApiError(400, "项目不存在或已停用");
  const batch = await db.uploadBatch.upsert({where:{requestId: input.requestId}, update:{}, create:{
    requestId: input.requestId, projectId: input.projectId, docDate, createdById: user.id,
    photos: {create: input.fileNames.map((fileName, index) => ({position: index + 1, fileName}))},
  }, include:{photos:{orderBy:{position:"asc"}}}});
  if (batch.createdById !== user.id || batch.projectId !== input.projectId || dateOnly(batch.docDate) !== input.docDate
    || JSON.stringify(batch.photos.map(p => p.fileName)) !== JSON.stringify(input.fileNames)) throw new ApiError(409, "此上传请求已使用，请恢复原批次");
  return {id: batch.id};
}

export async function listBatches(user: SessionUser) {
  const db = await getReadyDb();
  const batches = await db.uploadBatch.findMany({where:{createdById: user.id}, orderBy:{createdAt:"desc"}, take:20, include:{_count:{select:{photos:true,documents:true}}}});
  const projects = await db.project.findMany({where:{id:{in:batches.map(b=>b.projectId)}}});
  return {batches: batches.filter(b=>canViewRecord(user,b)).map(b=>({id:b.id, projectName:projects.find(p=>p.id===b.projectId)?.name || "项目", docDate:dateOnly(b.docDate), createdAt:b.createdAt.toISOString(), count:b._count.photos, uploaded:b._count.documents}))};
}

export async function getBatch(user: SessionUser, id: string) {
  const batch = await authorizedBatch(user, id);
  const db = await getReadyDb();
  const [documents, project] = await Promise.all([
    db.document.findMany({where:{batchId:id, ...documentReadScope(user)}, include, orderBy:{batchPosition:"asc"}}),
    db.project.findUniqueOrThrow({where:{id:batch.projectId}}),
  ]);
  const showImages = documentVisibility(user,batch.projectId).sourceImages;
  return {id, projectId:batch.projectId, projectName:project.name, docDate:dateOnly(batch.docDate), createdAt:batch.createdAt.toISOString(),
    canUpload:batch.createdById===user.id && hasPermission(user,"document.create",batch.projectId) && hasPermission(user,"document.ocr",batch.projectId),
    photos:batch.photos.map(p=>({position:p.position, fileName:showImages?p.fileName:"单据图片", documentId:p.documentId, deleted:!!p.completedAt&&!p.documentId})),
    documents:documents.map(d=>visibleDocument(user,documentDto(d)))};
}

export async function batchUploadTarget(user: SessionUser, id: string, position: number, mime: string) {
  const batch = await authorizedBatch(user,id,true);
  let photo = batch.photos.find(p=>p.position===position);
  if (!photo) throw new ApiError(404,"图片序号不存在");
  if (photo.completedAt) return {documentId:photo.documentId, deleted:!photo.documentId};
  const suffix = {"image/jpeg":"jpg","image/png":"png","image/webp":"webp"}[mime];
  if (!suffix) throw new ApiError(400,"仅支持 JPG、PNG、WebP 图片");
  const db = await getReadyDb();
  if (!photo.objectKey) {
    await db.batchPhoto.updateMany({where:{id:photo.id,objectKey:""},data:{mime, objectKey:`documents/batches/${id}/${position}-${crypto.randomUUID()}.${suffix}`}});
    photo = await db.batchPhoto.findUniqueOrThrow({where:{id:photo.id}});
  }
  if (photo.mime !== mime) throw new ApiError(409,"图片格式已变化，请使用原图片继续上传");
  return {target: await createUploadTarget(mime,suffix,photo.objectKey)};
}

export async function completeBatchPhoto(user: SessionUser, id: string, position: number) {
  const batch = await authorizedBatch(user,id,true);
  const photo = batch.photos.find(p=>p.position===position);
  if (!photo || !photo.objectKey) throw new ApiError(400,"请先上传此图片");
  const db = await getReadyDb();
  let documentId = photo.documentId;
  if (photo.completedAt && !documentId) throw new ApiError(409,"此单据已删除，请另建批次上传");
  if (!documentId) {
    let buffer: Buffer;
    try { buffer = await readObject(photo.objectKey); } catch { throw new ApiError(400,"图片尚未上传完成，请重试本张"); }
    if (!buffer.length || buffer.length > 15*1024*1024 || sniffImageMime(buffer)!==photo.mime) throw new ApiError(400,"图片格式或大小不合要求");
    // Versioned OSS buckets ignore forbid-overwrite. Freeze the exact bytes under a
    // fresh server-only key; an unexpired browser PUT can affect only the staging key.
    const originalKey = `documents/batches/${id}/original-${position}-${crypto.randomUUID()}.${photo.objectKey.split(".").pop()}`;
    await writePrivateOriginal(originalKey, buffer, photo.mime);
    try {
      documentId = await db.$transaction(async tx=>{
        const claimed = await tx.batchPhoto.updateMany({where:{id:photo.id, documentId:null, completedAt:null, version:photo.version}, data:{version:{increment:1}}});
        if (claimed.count!==1) throw new ApiError(409,"图片已由另一请求处理");
        const doc = await tx.document.create({data:{batchId:id, batchPosition:position, projectId:batch.projectId, createdById:user.id, docDate:batch.docDate,
          docNo:generateDocumentNumber(), status:"PROCESSING", pages:{create:{pageNo:1, objectKey:originalKey, mime:photo.mime, fileName:photo.fileName, sha256:crypto.createHash("sha256").update(buffer).digest("hex")}}}});
        await tx.batchPhoto.update({where:{id:photo.id},data:{documentId:doc.id,completedAt:new Date()}});
        await tx.auditLog.create({data:{entityType:"document",entityId:doc.id,documentId:doc.id,userId:user.id,action:"document.created",afterValue:{batchId:id,position,pageCount:1}}});
        return doc.id;
      });
    } catch (error) {
      const winner = await db.batchPhoto.findUnique({where:{id:photo.id}, include:{document:{select:{pages:{select:{objectKey:true}}}}}});
      if (!winner?.document?.pages.some(page=>page.objectKey===originalKey)) await deleteObject(originalKey).catch(()=>{});
      if (!winner?.documentId) throw error;
      documentId = winner.documentId;
    }
    // Best-effort cleanup. Database completion remains authoritative if cleanup fails.
    await deleteObject(photo.objectKey).catch(()=>{});
  }
  // Creation version is fixed: retries cannot launch another inference after a worker has claimed it.
  await enqueueOcr(documentId, 1);
  return {documentId};
}

export async function confirmBatchDocument(user: SessionUser, id: string, documentId: string, version: number) {
  await authorizedBatch(user,id);
  const db = await getReadyDb();
  await db.$transaction(async tx=>{
    const doc = await tx.document.findUnique({where:{id:documentId},include:{items:true}});
    if (!doc || doc.batchId!==id || !canSubmitRecord(user,doc)) throw new ApiError(403,"无权核对该单据或当前状态不允许");
    if (doc.version!==version) throw new ApiError(409,"单据已修改，请重新核对");
    if (doc.checkedVersion===version) return;
    if (doc.ocrError || !doc.supplierId || !doc.items.length || doc.items.some(i=>!i.ingredientId || !i.unit.trim() || !i.name.trim() || Number(i.quantity)<=0)) throw new ApiError(422,"请先完成供应商、材料、单位和数量核对");
    await claimDocumentVersion(tx,doc);
    await recomputeDocumentChecksInTransaction(tx,documentId);
    if (await tx.checkResult.count({where:{documentId,status:"OPEN",severity:"ERROR"}})) throw new ApiError(422,"仍有严重问题，请处理后再确认");
    await tx.document.update({where:{id:documentId},data:{checkedVersion:version+1,checkedById:user.id,checkedAt:new Date()}});
    await tx.auditLog.create({data:{entityType:"document",entityId:documentId,documentId,userId:user.id,action:"document.checked",afterValue:{batchId:id,version:version+1}}});
  });
  return {document:visibleDocument(user,documentDto(await db.document.findUniqueOrThrow({where:{id:documentId},include})))};
}

export async function submitBatch(user: SessionUser, id: string, entries: Array<{id:string;version:number}>) {
  await authorizedBatch(user,id);
  if (!entries.length || entries.length>10 || new Set(entries.map(e=>e.id)).size!==entries.length) throw new ApiError(400,"请选择 1–10 张不同单据");
  const db = await getReadyDb();
  const results: Array<{id:string;ok:boolean;message:string}> = [];
  for (const entry of entries) {
    try {
      const doc = await db.document.findUnique({where:{id:entry.id}});
      if (!doc || doc.batchId!==id || !canViewRecord(user,doc)) throw new ApiError(404,"单据不存在或无权查看");
      const maySubmit = hasPermission(user,"document.submit_project",doc.projectId) || doc.createdById===user.id && hasPermission(user,"document.submit_own",doc.projectId);
      if (!maySubmit) throw new ApiError(403,"无权提交该单据");
      if (doc.status!=="PENDING_REVIEW" && doc.status!=="APPROVED") await submitDocument(user,entry.id,entry.version);
      results.push({id:entry.id,ok:true,message:"已提交审核"});
    } catch (error) { results.push({id:entry.id,ok:false,message:error instanceof ApiError?error.message:"提交未完成，请刷新后重试本张"}); }
  }
  return {results};
}

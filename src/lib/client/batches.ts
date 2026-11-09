import type { DocumentDto } from "./types";
export type Batch = {id:string;projectId:string;projectName:string;docDate:string;createdAt:string;canUpload:boolean;
  photos:Array<{position:number;fileName:string;documentId:string|null;deleted:boolean}>;documents:DocumentDto[]};
export function batchReady(doc:DocumentDto) {
  return ["DRAFT","NEEDS_REVISION"].includes(doc.status) && doc.checkedVersion===doc.version && !doc.ocrError && !!doc.supplierId && doc.items.length>0
    && doc.items.every(i=>!!i.ingredientId && !!i.unit && i.quantity>0) && !doc.checks.some(c=>c.status==="OPEN" && c.severity==="ERROR");
}
export async function compressBatchImage(file: File): Promise<File> {
  if(file.size < 1.2*1024*1024 || typeof createImageBitmap !== "function") return file;
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file,{imageOrientation:"from-image"}); } catch { return file; }
  const canvas=document.createElement("canvas");
  try {
    const scale=Math.min(1,3000/Math.max(bitmap.width,bitmap.height));
    canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
    const context=canvas.getContext("2d");if(!context)return file;
    context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/jpeg",.91));
    return blob && blob.size<file.size ? new File([blob],file.name.replace(/\.[^.]+$/,"")+".jpg",{type:"image/jpeg",lastModified:file.lastModified}):file;
  } finally {bitmap.close();canvas.width=0;canvas.height=0;}
}

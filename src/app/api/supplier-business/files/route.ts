import { NextRequest,NextResponse } from "next/server";
import { requireUser,requireOrigin,ApiError } from "@/server/auth";
import { uploadSupplierFile,supplierFile,recognizeInvoice } from "@/server/supplier-files";
import { binaryResponse,handleApiError } from "@/server/http";
import { readObject } from "@/server/storage";
export const runtime="nodejs";
export async function POST(request:NextRequest){try{const user=await requireUser(request);requireOrigin(request);if(request.headers.get("content-type")?.includes("application/json")){const body=await request.json();if(body.action!=="recognize"||typeof body.fileId!=="string")throw new ApiError(400,"识别参数不合法");return NextResponse.json(await recognizeInvoice(user,body.fileId));}
 if(Number(request.headers.get("content-length"))>16*1024*1024)throw new ApiError(413,"文件超过15MB限制");const data=await request.formData(),file=data.get("file");if(!(file instanceof File))throw new ApiError(400,"请选择原件");return NextResponse.json(await uploadSupplierFile(user,String(data.get("projectId")||""),String(data.get("supplierId")||""),String(data.get("kind")||""),file));
 }catch(e){return handleApiError(e);}}
export async function GET(request:NextRequest){try{const user=await requireUser(request),file=await supplierFile(user,request.nextUrl.searchParams.get("id")||"");return binaryResponse(await readObject(file.objectKey),file.mime,{"Content-Disposition":`inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,"Content-Security-Policy":"sandbox"});}catch(e){return handleApiError(e);}}

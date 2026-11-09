import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getReadyDb } from "@/lib/bootstrap";
import { dateOnly } from "@/lib/text";
import { createSessionToken } from "@/server/auth";
import { GET, PATCH } from "@/app/api/business/route";
import { POST } from "@/app/api/business/review/route";

const marker=`revenue-api-${randomUUID()}`;
let projectId="",staffId="",adminToken="",staffToken="",id="",version=0;
function request(method:string,body?:unknown,token=adminToken,origin="http://localhost:3000") {
  return new NextRequest("http://localhost:3000/api/business",{method,headers:{Cookie:`delivery_session=${token}`,Origin:origin,"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
beforeAll(async()=>{
  const db=await getReadyDb();const admin=await db.user.findFirstOrThrow({where:{active:true,globalRole:"ADMIN"}});
  projectId=(await db.project.create({data:{code:marker,name:marker}})).id;
  staffId=(await db.user.create({data:{employeeNo:marker,name:marker,passwordHash:"no-login-test-fixture",memberships:{create:{projectId,role:"SUBMITTER"}}}})).id;
  adminToken=await createSessionToken(admin.id);staffToken=await createSessionToken(staffId);
});
afterAll(async()=>{
  const db=await getReadyDb();
  await db.auditLog.deleteMany({where:{entityType:"projectDailyRevenue",afterValue:{path:["projectId"],equals:projectId}}});
  await db.projectDailyRevenue.deleteMany({where:{projectId}});await db.user.deleteMany({where:{id:staffId}});await db.project.deleteMany({where:{id:projectId}});
});
it("rejects anonymous requests, cross-origin changes and malformed payloads",async()=>{
  expect((await GET(request("GET",undefined,""))).status).toBe(401);
  expect((await PATCH(request("PATCH",{},adminToken,"https://other.invalid"))).status).toBe(403);
  expect((await POST(request("POST",{id:"x",version:1,action:"APPROVED",note:""}))).status).toBe(400);
  expect((await PATCH(request("PATCH",{projectId,date:dateOnly(new Date()),amount:-1,notes:"",version:0}))).status).toBe(400);
});
it("ignores forged approval fields when staff submit revenue and denies their review",async()=>{
  const response=await PATCH(request("PATCH",{projectId,date:dateOnly(new Date()),amount:1234.56,notes:"测试",version:0,status:"APPROVED",reviewedById:staffId},staffToken));
  expect(response.status).toBe(200);const body=await response.json();id=body.id;version=body.version;expect(body.status).toBe("PENDING_REVIEW");
  expect((await POST(request("POST",{id,version,action:"approve",note:""},staffToken))).status).toBe(403);
  const db=await getReadyDb();expect((await db.projectDailyRevenue.findUniqueOrThrow({where:{id}})).reviewedById).toBeNull();
});
it("reviews the exact version and excludes subsequent staff edits until reviewed again",async()=>{
  const response=await POST(request("POST",{id,version,action:"approve",note:"同意"}));expect(response.status).toBe(200);
  version=(await response.json()).version;
  const saved=await PATCH(request("PATCH",{projectId,date:dateOnly(new Date()),amount:1500,notes:"修正",version},staffToken));
  expect(saved.status).toBe(200);expect((await saved.json()).status).toBe("PENDING_REVIEW");
  expect((await POST(request("POST",{id,version,action:"approve",note:""}))).status).toBe(409);
  const read=await GET(new NextRequest(`http://localhost:3000/api/business?projectId=${projectId}`,{headers:{Cookie:`delivery_session=${staffToken}`}}));
  expect(read.status).toBe(200);const data=await read.json();expect(data.summary.revenue).toBe(0);expect(data.revenues[0].amount).toBe(1500);expect(data.projects.find((p:{id:string})=>p.id===projectId).approve).toBe(false);
});

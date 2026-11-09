import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getReadyDb } from "@/lib/bootstrap";
import { canEditDocument, canReviewDocument, canSubmitProject, canSuperviseProject, createSessionToken, getSessionUser, type SessionUser } from "@/server/auth";
import { POST as createUser } from "@/app/api/users/route";
import { PATCH as updateUser } from "@/app/api/users/[id]/route";
import { POST as presign } from "@/app/api/uploads/presign/route";
import { GET as bootstrap } from "@/app/api/bootstrap/route";

const mixed: SessionUser = { id:"member", employeeNo:"member", name:"员工", globalRole:"STAFF", memberships:[
  {projectId:"a",projectName:"甲",projectCode:"A",roles:["SUPERVISOR"]},
  {projectId:"b",projectName:"乙",projectCode:"B",roles:["SUBMITTER"]},
] };

describe("project-specific employee and supervisor permissions", () => {
  it("allows uploads on both assigned projects, but reviews only the supervised project", () => {
    expect(canSubmitProject(mixed,"a")).toBe(true);
    expect(canSubmitProject(mixed,"b")).toBe(true);
    expect(canSubmitProject(mixed,"c")).toBe(false);
    expect(canSuperviseProject(mixed,"a")).toBe(true);
    expect(canSuperviseProject(mixed,"b")).toBe(false);
    expect(canEditDocument(mixed,{projectId:"a",createdById:"member",status:"DRAFT"})).toBe(true);
    expect(canEditDocument(mixed,{projectId:"a",createdById:"other",status:"DRAFT"})).toBe(false);
    expect(canEditDocument(mixed,{projectId:"a",createdById:"member",status:"APPROVED"})).toBe(false);
    expect(canReviewDocument(mixed,{projectId:"a",status:"PENDING_REVIEW"})).toBe(true);
    expect(canReviewDocument(mixed,{projectId:"b",status:"PENDING_REVIEW"})).toBe(false);
    const finance = {...mixed, globalRole:"FINANCE" as const};
    expect(canSubmitProject(finance,"a")).toBe(false);
    expect(canSuperviseProject(finance,"a")).toBe(false);
  });

  it("creates mixed memberships, edits existing roles atomically, validates input and refreshes active sessions", async () => {
    const db=await getReadyDb();
    const projects=await db.project.findMany({where:{active:true},take:2});
    const admin=await db.user.findFirstOrThrow({where:{globalRole:"ADMIN",active:true}});
    const adminToken=await createSessionToken(admin.id);
    const request=(path:string,token:string,body?:unknown,method="POST")=>new NextRequest(`http://localhost:3000${path}`,{
      method,headers:{Cookie:`delivery_session=${token}`,"Content-Type":"application/json"},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
    });
    const memberships=[{projectId:projects[0].id,role:"SUPERVISOR"},{projectId:projects[1].id,role:"SUBMITTER"}];
    const response=await createUser(request("/api/users",adminToken,{employeeNo:`test_${randomUUID().slice(0,8)}`,name:"权限验收",password:"test-pass-123",globalRole:"STAFF",memberships}));
    expect(response.status).toBe(201);
    const {id}=await response.json();
    try {
      const memberToken=await createSessionToken(id);
      let user=await getSessionUser(request("/api/bootstrap",memberToken,undefined,"GET"));
      expect(user?.memberships).toHaveLength(2);
      expect(canSubmitProject(user!,projects[0].id)).toBe(true);
      const upload=await presign(request("/api/uploads/presign",memberToken,{mime:"image/jpeg",fileName:"test.jpg",size:100}));
      expect(upload.status).toBe(200);
      const light=await bootstrap(request("/api/bootstrap?scope=context",memberToken,undefined,"GET"));
      const data=await light.json();
      expect(data.projects.map((row:{id:string})=>row.id).sort()).toEqual(projects.map(row=>row.id).sort());
      expect(data.suppliers).toEqual([]); expect(data.ingredients).toEqual([]); expect(data.contracts).toEqual([]);
      const patch=(body:unknown,token=adminToken)=>updateUser(request(`/api/users/${id}`,token,body,"PATCH"),{params:Promise.resolve({id})});
      expect((await patch({memberships},memberToken)).status).toBe(403);
      expect((await patch({memberships:[]})).status).toBe(400);
      expect((await patch({memberships:[memberships[0],memberships[0]]})).status).toBe(400);
      expect((await patch({memberships:[{projectId:"missing",role:"SUPERVISOR"}]})).status).toBe(400);
      const next=[{projectId:projects[1].id,role:"SUPERVISOR"}];
      expect((await patch({memberships:next})).status).toBe(200);
      user=await getSessionUser(request("/api/bootstrap",memberToken,undefined,"GET"));
      expect(canSubmitProject(user!,projects[0].id)).toBe(false);
      expect(canSuperviseProject(user!,projects[1].id)).toBe(true);
      // A password/active-only patch must preserve project assignments.
      expect((await patch({active:true})).status).toBe(200);
      expect(await db.projectMembership.count({where:{userId:id}})).toBe(1);
      const audit=await db.auditLog.findFirstOrThrow({where:{entityType:"user",entityId:id,action:"user.updated"},orderBy:{createdAt:"asc"}});
      expect(JSON.stringify(audit)).not.toContain("test-pass-123");
    } finally {
      await db.auditLog.deleteMany({where:{entityType:"user",entityId:id}});
      await db.user.delete({where:{id}});
    }
  });
});

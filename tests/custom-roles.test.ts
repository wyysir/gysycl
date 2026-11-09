import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getReadyDb } from "@/lib/bootstrap";
import { createSessionToken, getSessionUser, canAccessProject, canSubmitProject, type SessionUser } from "@/server/auth";
import { hasPermission, canEditRecord, canDeleteRecord, canSubmitRecord, permissionProjectIds, type Permission } from "@/lib/permissions";
import { POST as createRole, GET as listRoles } from "@/app/api/roles/route";
import { PATCH as updateRole } from "@/app/api/roles/[id]/route";
import { POST as createUser } from "@/app/api/users/route";
import { PATCH as updateUser } from "@/app/api/users/[id]/route";
import { POST as presign } from "@/app/api/uploads/presign/route";
import { getAnalytics } from "@/server/analytics";
import { buildDocumentsWorkbook } from "@/server/excel";
import { reviewDocument, submitDocument } from "@/server/document-service";
import { deleteDraft } from "@/server/document-deletion";

const request=(path:string,token:string,body?:unknown,method="POST")=>new NextRequest(`http://localhost:3000${path}`,{
  method,headers:{Cookie:`delivery_session=${token}`,"Content-Type":"application/json"},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),
});

describe("administrator-defined project roles",()=>{
  it("does not inherit placeholder roles, and separates ownership, submission, review, deletion and finance restrictions",()=>{
    const user:SessionUser={id:"me",employeeNo:"me",name:"自定义",globalRole:"STAFF",memberships:[
      {projectId:"a",projectName:"甲",projectCode:"A",roles:["SUBMITTER"],permissions:["document.delete_own","document.approve"]},
      {projectId:"b",projectName:"乙",projectCode:"B",roles:[],permissions:["document.create","document.edit_own"]},
    ]};
    const own={projectId:"a",createdById:"me",status:"DRAFT"};
    expect(canSubmitProject(user,"a")).toBe(false);
    expect(canEditRecord(user,own)).toBe(false);
    expect(canSubmitRecord(user,own)).toBe(false);
    expect(canDeleteRecord(user,own)).toBe(true);
    expect(canDeleteRecord(user,{...own,createdById:"other"})).toBe(false);
    expect(canDeleteRecord(user,{...own,status:"APPROVED"})).toBe(false);
    expect(hasPermission(user,"document.approve","a")).toBe(true);
    expect(hasPermission(user,"document.return","a")).toBe(false);
    expect(hasPermission(user,"document.override","a")).toBe(false);
    expect(canSubmitProject(user,"b")).toBe(true);
    expect(canEditRecord(user,{...own,projectId:"b"})).toBe(true);
    expect(hasPermission({...user,globalRole:"FINANCE"},"document.create","b")).toBe(false);
    expect(permissionProjectIds(user,"document.create")).toEqual(["b"]);
  });

  it("creates, assigns and edits roles, enforces service permissions and immediately revokes existing sessions",async()=>{
    const db=await getReadyDb();
    const admin=await db.user.findFirstOrThrow({where:{active:true,globalRole:"ADMIN"}});
    const adminToken=await createSessionToken(admin.id);
    const projects=await db.project.findMany({where:{active:true},take:2});
    const permissions:Permission[]=["document.create","document.edit_own","document.export","analytics.view"];
    const name=`权限测试-${randomUUID().slice(0,8)}`;
    const invalid=await createRole(request("/api/roles",adminToken,{name,permissions:["system.admin"]}));
    expect(invalid.status).toBe(400);
    const response=await createRole(request("/api/roles",adminToken,{name,permissions}));
    expect(response.status).toBe(201);
    let {role}=await response.json();
    const readonlyResponse=await createRole(request("/api/roles",adminToken,{name:name+"只读",permissions:[]}));
    const readonlyRole=(await readonlyResponse.json()).role;
    let memberId="",documentId="";
    try {
      const created=await createUser(request("/api/users",adminToken,{employeeNo:`custom_${randomUUID().slice(0,8)}`,name:"自定义角色验收",password:"test-custom-123",memberships:[
        {projectId:projects[0].id,customRoleId:role.id},{projectId:projects[1].id,customRoleId:readonlyRole.id},
      ]}));
      expect(created.status).toBe(201);memberId=(await created.json()).id;
      const token=await createSessionToken(memberId);
      const readUser=async()=> (await getSessionUser(request("/api/bootstrap",token,undefined,"GET")))!;
      let user=await readUser();
      expect(canSubmitProject(user,projects[0].id)).toBe(true);
      expect(canSubmitProject(user,projects[1].id)).toBe(false);
      expect(user.memberships[0].roles).toEqual([]);
      expect(user.memberships.flatMap(m=>m.roleNames)).toContain(name);
      expect((await listRoles(request("/api/roles",token,undefined,"GET"))).status).toBe(403);
      expect((await createRole(request("/api/roles",token,{name:"越权",permissions}))).status).toBe(403);
      const patch=(body:unknown,who=adminToken)=>updateRole(request(`/api/roles/${role.id}`,who,body,"PATCH"),{params:Promise.resolve({id:role.id})});
      const patchData={name:role.name,description:"",permissions:[],active:true,version:role.version};
      expect((await patch(patchData,token)).status).toBe(403);
      expect((await updateUser(request(`/api/users/${memberId}`,adminToken,{memberships:[{projectId:projects[0].id,customRoleId:"missing"}]},"PATCH"),{params:Promise.resolve({id:memberId})})).status).toBe(400);
      const draft=await db.document.create({data:{projectId:projects[0].id,createdById:memberId,status:"DRAFT",docDate:new Date(),docNo:name}});
      documentId=draft.id;
      await expect(submitDocument(user,draft.id)).rejects.toMatchObject({status:403});
      await expect(deleteDraft(user,draft.id,draft.version)).rejects.toMatchObject({status:403});
      await db.document.update({where:{id:draft.id},data:{status:"PENDING_REVIEW"}});
      await expect(reviewDocument(user,draft.id,{action:"approve"})).rejects.toMatchObject({status:403});
      await expect(getAnalytics(user,{projectId:projects[1].id})).rejects.toMatchObject({status:403});
      await expect(buildDocumentsWorkbook(user,{projectId:projects[1].id})).rejects.toMatchObject({status:403});
      const updated=await patch(patchData);expect(updated.status).toBe(200);role=(await updated.json()).role;
      expect((await patch(patchData)).status).toBe(409);
      user=await readUser();
      expect(canSubmitProject(user,projects[0].id)).toBe(false);
      expect((await presign(request("/api/uploads/presign",token,{mime:"image/jpeg",fileName:"test.jpg",size:100}))).status).toBe(403);
      await expect(getAnalytics(user,{})).rejects.toMatchObject({status:403});
      await expect(buildDocumentsWorkbook(user,{})).rejects.toMatchObject({status:403});
      const stopped=await patch({...patchData,version:role.version,active:false});expect(stopped.status).toBe(200);
      user=await readUser();
      expect(canAccessProject(user,projects[0].id)).toBe(false);
      expect(canAccessProject(user,projects[1].id)).toBe(true);
      expect(await db.auditLog.count({where:{entityType:"role",entityId:role.id,action:"role.updated"}})).toBe(2);
    } finally {
      if(documentId)await db.document.delete({where:{id:documentId}});
      if(memberId){await db.auditLog.deleteMany({where:{entityType:"user",entityId:memberId}});await db.user.delete({where:{id:memberId}});}
      await db.auditLog.deleteMany({where:{entityType:"role",entityId:{in:[role.id,readonlyRole.id]}}});
      await db.customRole.deleteMany({where:{id:{in:[role.id,readonlyRole.id]}}});
    }
  });
});

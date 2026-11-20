export const PERMISSION_OPTIONS = [
  {key:"master.view", group:"基础资料", label:"查看公司共享供应商和材料目录"},
  {key:"contract.import", group:"基础资料", label:"导入本项目合同价（另需资料导入权限）"},
  {key:"document.view", group:"查看范围", label:"查看采购单据（基础项目范围）"},
  {key:"document.images", group:"查看范围", label:"查看采购原图（同时需要单价和金额查看）"},
  {key:"project.manage", group:"公司管理", label:"维护项目点（公司级）"},
  {key:"user.manage", group:"公司管理", label:"维护员工账号（公司级）"},
  {key:"grant.manage", group:"公司管理", label:"管理人员独立授权（公司级）"},
  {key:"template.manage", group:"公司管理", label:"维护权限模板（公司级）"},
  {key:"settings.manage", group:"公司管理", label:"维护系统设置及Logo（公司级）"},
  {key:"feedback.view_all", group:"公司管理", label:"查看全部反馈（公司级）"},
  {key:"measurement.history", group:"公司管理", label:"确认历史单位与换算（公司级）"},
  {key:"statement.view", group:"供应商对账", label:"查看供应商对账"},
  {key:"statement.generate", group:"供应商对账", label:"生成对账单"},
  {key:"statement.edit", group:"供应商对账", label:"更新未开票对账"},
  {key:"statement.export", group:"供应商对账", label:"导出供应商对账Excel"},
  {key:"return.view", group:"供应商退货", label:"查看退货"},
  {key:"return.create", group:"供应商退货", label:"登记退货草稿"},
  {key:"return.edit", group:"供应商退货", label:"修改未审核退货"},
  {key:"return.submit", group:"供应商退货", label:"提交退货审核"},
  {key:"return.approve", group:"供应商退货", label:"审核退货"},
  {key:"deduction.view", group:"供应商扣款", label:"查看扣款"},
  {key:"deduction.create", group:"供应商扣款", label:"登记生效扣款"},
  {key:"deduction.edit", group:"供应商扣款", label:"修改未结算扣款"},
  {key:"invoice.view", group:"供应商发票", label:"查看发票信息"},
  {key:"invoice.upload", group:"供应商发票", label:"上传发票原件"},
  {key:"invoice.recognize", group:"供应商发票", label:"识别发票"},
  {key:"invoice.edit", group:"供应商发票", label:"核对保存发票"},
  {key:"invoice.file", group:"供应商发票", label:"查看下载发票原件（含票面金额）"},
  {key:"payment.view", group:"供应商付款", label:"查看已付未付"},
  {key:"payment.execute", group:"供应商付款", label:"登记实际付款"},
  {key:"revenue.view", group:"项目经营", label:"查看项目每日营业额"},
  {key:"revenue.edit_today", group:"项目经营", label:"录入、修改本项目今日营业额"},
  {key:"revenue.edit_history", group:"项目经营", label:"补录、修改历史营业额（须填原因）"},
  {key:"revenue.approve", group:"项目经营", label:"审核通过本项目营业额"},
  {key:"revenue.return", group:"项目经营", label:"退回本项目营业额（须填原因）"},
  {key:"document.view_others", group:"查看范围", label:"查看本项目其他员工的单据"},
  {key:"document.view_unit_price", group:"查看范围", label:"查看采购单价"},
  {key:"document.view_amount", group:"查看范围", label:"查看行金额、税额、总金额及金额统计"},
  {key:"contract.view_price", group:"查看范围", label:"查看本项目合同价"},
  {key:"document.create", group:"单据录入", label:"上传图片、手工新建单据"},
  {key:"document.edit_own", group:"单据录入", label:"修改自己的草稿、退回单据"},
  {key:"document.edit_project", group:"单据录入", label:"修改本项目所有未通过单据"},
  {key:"document.submit_own", group:"单据录入", label:"提交自己的单据审核"},
  {key:"document.submit_project", group:"单据录入", label:"提交本项目其他人的单据"},
  {key:"document.ocr", group:"单据录入", label:"重新识别图片（同时需要单据修改权限）"},
  {key:"document.edit_pending", group:"审核", label:"校正本项目待审核单据"},
  {key:"document.approve", group:"审核", label:"普通审核通过"},
  {key:"document.return", group:"审核", label:"退回补充（必须填写原因）"},
  {key:"document.override", group:"审核", label:"强制通过异常（同时需要通过权限、填写原因）"},
  {key:"document.withdraw", group:"审核", label:"撤回本项目已通过单据（必须填写原因）"},
  {key:"document.delete_own", group:"删除", label:"删除自己的草稿、退回单据及图片"},
  {key:"document.delete_project", group:"删除", label:"删除本项目其他人的草稿、退回单据及图片"},
  {key:"document.export", group:"查询", label:"导出本项目单据 Excel"},
  {key:"analytics.view", group:"查询", label:"查看本项目价格分析"},
  {key:"contract.manage", group:"基础资料", label:"新增、删除本项目合同价"},
  {key:"master.create", group:"基础资料", label:"新建供应商、从单据新建材料（全公司共享）"},
  {key:"master.create_global", group:"基础资料", label:"直接从材料库新建原材料（全公司共享）"},
  {key:"master.manage", group:"基础资料", label:"修改、启停、合并基础资料及删除未使用供应商和原材料（全公司共享）"},
  {key:"master.import", group:"基础资料", label:"导入共享基础资料（合同另需项目导入权限）"},
] as const;

export type Permission = typeof PERMISSION_OPTIONS[number]["key"];
export const PERMISSION_KEYS = PERMISSION_OPTIONS.map(row=>row.key) as [Permission, ...Permission[]];
export const READ_PERMISSIONS: Permission[] = ["document.view_others","document.view_unit_price","document.view_amount","contract.view_price"];
export const EMPLOYEE_PERMISSIONS: Permission[] = [...READ_PERMISSIONS,"revenue.view","revenue.edit_today","document.create","document.edit_own","document.submit_own",
  "document.ocr","document.delete_own","document.export","analytics.view","master.create"];
export const SUPERVISOR_PERMISSIONS: Permission[] = [...EMPLOYEE_PERMISSIONS,"revenue.edit_history","revenue.approve","revenue.return","document.edit_pending",
  "document.approve","document.return","document.override","document.withdraw"];
const FINANCE_PERMISSIONS: Permission[] = [...READ_PERMISSIONS,"revenue.view","document.export","analytics.view"];

export type PermissionUser = {
  id?: string;
  globalRole: "ADMIN" | "FINANCE" | "STAFF";
  grants?: PermissionGrant[] | null;
  memberships: Array<{projectId: string; roles: readonly string[]; permissions?: readonly string[]; roleNames?: string[]}>;
};

export type PermissionGrant = {key: Permission; scope: string};
export const COMPANY_PERMISSIONS: readonly Permission[] = ["master.view","project.manage","user.manage","grant.manage","template.manage","settings.manage","feedback.view_all","measurement.history","master.create","master.create_global","master.manage","master.import"];
export function companyPermission(key: Permission) { return COMPANY_PERMISSIONS.includes(key); }

/** Only used to preserve pre-migration capabilities. Saved grants never inherit role changes. */
export function legacyGrants(user: PermissionUser): PermissionGrant[] {
  const oldKeys = PERMISSION_KEYS.filter(key=>!key.startsWith("statement.")&&!key.startsWith("return.")&&!key.startsWith("deduction.")&&!key.startsWith("invoice.")&&!key.startsWith("payment."));
  if(user.globalRole === "ADMIN") return oldKeys.map(key=>({key,scope:"*"}));
  if(user.globalRole === "FINANCE") return [...FINANCE_PERMISSIONS,"document.view","document.images","master.view" as Permission].map(key=>({key:key as Permission,scope:"*"}));
  const grants:PermissionGrant[] = user.memberships.flatMap(m=>[...new Set([...(m.permissions??builtinPermissions(m.roles)),"document.view"])].filter((key):key is Permission=>PERMISSION_KEYS.includes(key as Permission)).map(key=>({key,scope:companyPermission(key)?"*":m.projectId})));
  for(const m of user.memberships) if((m.permissions??builtinPermissions(m.roles)).includes("document.view_amount")&&(m.permissions??builtinPermissions(m.roles)).includes("document.view_unit_price")) grants.push({key:"document.images",scope:m.projectId});
  for(const m of user.memberships) if((m.permissions??builtinPermissions(m.roles)).includes("master.import")) grants.push({key:"contract.import",scope:m.projectId});
  grants.push({key:"master.view",scope:"*"});
  return [...new Map(grants.map(g=>[g.key+":"+g.scope,g])).values()];
}

export function effectiveGrants(user: PermissionUser): PermissionGrant[] { return user.grants ?? legacyGrants(user); }

export function builtinPermissions(roles: readonly string[]): Permission[] {
  return [...new Set(roles.flatMap(role=>role === "SUPERVISOR" ? SUPERVISOR_PERMISSIONS : role === "SUBMITTER" ? EMPLOYEE_PERMISSIONS : []))];
}
export function hasPermission(user: PermissionUser, permission: Permission, projectId?: string): boolean {
  if(user.grants != null) return user.grants.some(g=>g.key===permission && (companyPermission(permission)?g.scope==="*":!projectId||g.scope==="*"||g.scope===projectId));
  if(permission==="master.view")return true;
  if (user.globalRole === "ADMIN") return true;
  if (user.globalRole === "FINANCE") return FINANCE_PERMISSIONS.includes(permission);
  if(permission==="contract.import")return user.memberships.some(m=>(!projectId||m.projectId===projectId)&&(m.permissions??builtinPermissions(m.roles)).includes("master.import"));
  return user.memberships.some(membership => (!projectId || membership.projectId === projectId)
    && (membership.permissions ?? builtinPermissions(membership.roles)).includes(permission));
}
export function permissionProjectIds(user: PermissionUser, permission: Permission): string[] | null {
  if(user.grants != null) { const grants=user.grants.filter(g=>g.key===permission);return grants.some(g=>g.scope==="*")?null:[...new Set(grants.map(g=>g.scope))]; }
  if (user.globalRole === "ADMIN" || user.globalRole === "FINANCE" && hasPermission(user, permission)) return null;
  return user.memberships.filter(membership=>hasPermission(user, permission, membership.projectId)).map(row=>row.projectId);
}

type PermissionDocument = {projectId: string; createdById: string; status: string};
export function canViewRecord(user: PermissionUser, document: {projectId:string;createdById:string}): boolean {
  const access = user.grants != null ? hasPermission(user,"document.view",document.projectId) : user.globalRole !== "STAFF" || user.memberships.some(row=>row.projectId === document.projectId);
  return access && (document.createdById === user.id || hasPermission(user,"document.view_others",document.projectId));
}
export function documentVisibility(user: PermissionUser, projectId:string) {
  const unitPrice=hasPermission(user,"document.view_unit_price",projectId);
  const amount=hasPermission(user,"document.view_amount",projectId);
  const contractPrice=hasPermission(user,"contract.view_price",projectId);
  const others=hasPermission(user,"document.view_others",projectId);
  return {unitPrice,amount,contractPrice,others,sourceImages:unitPrice && amount && (user.grants==null||hasPermission(user,"document.images",projectId)),
    sensitiveDetails:unitPrice && amount && contractPrice && others};
}
export function canEditRecord(user: PermissionUser, document: PermissionDocument): boolean {
  if (!canViewRecord(user,document)) return false;
  if (document.status === "APPROVED") return false;
  if (document.status === "PENDING_REVIEW") return hasPermission(user,"document.edit_pending",document.projectId)
    || hasPermission(user,"document.edit_project",document.projectId);
  return hasPermission(user,"document.edit_project",document.projectId)
    || document.createdById === user.id && hasPermission(user,"document.edit_own",document.projectId);
}
export function canSubmitRecord(user: PermissionUser, document: PermissionDocument): boolean {
  if (!canViewRecord(user,document)) return false;
  return ["DRAFT","NEEDS_REVISION"].includes(document.status) && (hasPermission(user,"document.submit_project",document.projectId)
    || document.createdById === user.id && hasPermission(user,"document.submit_own",document.projectId));
}
export function canDeleteRecord(user: PermissionUser, document: PermissionDocument): boolean {
  if (!canViewRecord(user,document)) return false;
  return ["DRAFT","NEEDS_REVISION"].includes(document.status) && (hasPermission(user,"document.delete_project",document.projectId)
    || document.createdById === user.id && hasPermission(user,"document.delete_own",document.projectId));
}
export function canReviewRecord(user: PermissionUser, document: {projectId:string;status:string;createdById?:string}): boolean {
  if (!canViewRecord(user,{...document,createdById:document.createdById || ""})) return false;
  return document.status === "PENDING_REVIEW" && (hasPermission(user,"document.approve",document.projectId)
    || hasPermission(user,"document.return",document.projectId));
}

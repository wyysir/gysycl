export const PERMISSION_OPTIONS = [
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
  {key:"master.manage", group:"基础资料", label:"修改、启停、合并原材料与供应商（全公司共享）"},
  {key:"master.import", group:"基础资料", label:"导入基础资料（全公司供应商、材料；仅授权项目合同）"},
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
  memberships: Array<{projectId: string; roles: readonly string[]; permissions?: readonly string[]; roleNames?: string[]}>;
};

export function builtinPermissions(roles: readonly string[]): Permission[] {
  return [...new Set(roles.flatMap(role=>role === "SUPERVISOR" ? SUPERVISOR_PERMISSIONS : role === "SUBMITTER" ? EMPLOYEE_PERMISSIONS : []))];
}
export function hasPermission(user: PermissionUser, permission: Permission, projectId?: string): boolean {
  if (user.globalRole === "ADMIN") return true;
  if (user.globalRole === "FINANCE") return FINANCE_PERMISSIONS.includes(permission);
  return user.memberships.some(membership => (!projectId || membership.projectId === projectId)
    && (membership.permissions ?? builtinPermissions(membership.roles)).includes(permission));
}
export function permissionProjectIds(user: PermissionUser, permission: Permission): string[] | null {
  if (user.globalRole === "ADMIN" || user.globalRole === "FINANCE" && hasPermission(user, permission)) return null;
  return user.memberships.filter(membership=>hasPermission(user, permission, membership.projectId)).map(row=>row.projectId);
}

type PermissionDocument = {projectId: string; createdById: string; status: string};
export function canViewRecord(user: PermissionUser, document: {projectId:string;createdById:string}): boolean {
  const access = user.globalRole !== "STAFF" || user.memberships.some(row=>row.projectId === document.projectId);
  return access && (document.createdById === user.id || hasPermission(user,"document.view_others",document.projectId));
}
export function documentVisibility(user: PermissionUser, projectId:string) {
  const unitPrice=hasPermission(user,"document.view_unit_price",projectId);
  const amount=hasPermission(user,"document.view_amount",projectId);
  const contractPrice=hasPermission(user,"contract.view_price",projectId);
  const others=hasPermission(user,"document.view_others",projectId);
  return {unitPrice,amount,contractPrice,others,sourceImages:unitPrice && amount,
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

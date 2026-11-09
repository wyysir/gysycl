import type { Prisma } from "@/generated/prisma/client";
import { hasPermission, documentVisibility } from "@/lib/permissions";
import type { SessionUser } from "./auth";
import type { DocumentDto } from "./documents";

// AND this with all caller filters; never replace its ownership OR with search OR.
export function documentReadScope(user:SessionUser):Prisma.DocumentWhereInput {
  if(user.globalRole !== "STAFF") return {};
  return {OR:user.memberships.map(row=>({projectId:row.projectId,
    ...(hasPermission(user,"document.view_others",row.projectId)?{}:{createdById:user.id})}))};
}

// These rules use company-wide records that may belong to inaccessible projects.
export function canViewCheckDetails(user:SessionUser, projectId:string, type:string) {
  return documentVisibility(user,projectId).sensitiveDetails && (user.globalRole !== "STAFF"
    || !["duplicate_document","duplicate_image","cross_supplier_price","benchmark_insufficient"].includes(type));
}

export function visibleDocument(user:SessionUser, dto:DocumentDto) {
  const visibility=documentVisibility(user,dto.projectId);
  return {...dto,visibility,
    subtotal:visibility.amount?dto.subtotal:null,taxAmount:visibility.amount?dto.taxAmount:null,
    totalAmount:visibility.amount?dto.totalAmount:null,
    notes:visibility.sensitiveDetails?dto.notes:"",reviewNote:visibility.sensitiveDetails?dto.reviewNote:"",
    overrideReason:visibility.sensitiveDetails?dto.overrideReason:"",ocrError:visibility.sensitiveDetails?dto.ocrError:(dto.ocrError?"识别失败，请联系有查看权限的人员处理":""),
    items:dto.items.map(item=>({...item,unitPrice:visibility.unitPrice?item.unitPrice:null,
      amount:visibility.amount?item.amount:null,
      roundingAdjustment:visibility.unitPrice && visibility.amount?item.roundingAdjustment:null,
      roundingConfirmed:visibility.unitPrice && visibility.amount?item.roundingConfirmed:false,
      sourcePageNo:visibility.sourceImages?item.sourcePageNo:null})),
    pages:visibility.sourceImages?dto.pages:[],
    checks:dto.checks.map(check=>({...check,
      detail:canViewCheckDetails(user,dto.projectId,check.type)?check.detail:"详细核对依据已按查看权限隐藏",
      expectedValue:canViewCheckDetails(user,dto.projectId,check.type)?check.expectedValue:null,
      actualValue:canViewCheckDetails(user,dto.projectId,check.type)?check.actualValue:null})),
  };
}

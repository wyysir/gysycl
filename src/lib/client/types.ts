import type { Permission } from "@/lib/permissions";
import type { RoundingAdjustment } from "@/domain/rounding";
export type User = {
  id: string;
  employeeNo: string;
  name: string;
  globalRole: "ADMIN" | "FINANCE" | "STAFF";
  memberships: Array<{
    projectId: string;
    projectName: string;
    projectCode: string;
    roles: Array<"SUBMITTER" | "SUPERVISOR">;
    permissions?: Permission[];
    roleNames?: string[];
  }>;
};

export type Bootstrap = {
  user: User;
  projects: Array<{ id: string; code: string; name: string; region: string; active?: boolean }>;
  suppliers: Array<{
    id: string;
    name: string;
    contactName: string;
    contactPhone: string;
  }>;
  ingredients: Array<{
    id: string;
    name: string;
    spec: string;
    unit: string;
    category: string;
  }>;
  contracts: Array<{
    id: string;
    updatedAt?: string;
    projectId: string;
    projectName: string;
    supplierId: string;
    supplierName: string;
    ingredientId: string;
    ingredientName: string;
    spec: string;
    unit: string;
    unitPrice: number;
    startsOn: string;
    endsOn: string | null;
  }>;
  system: {
    ocrMode: "mock" | "aliyun";
    confidenceThreshold: number;
    wechatConfigured: boolean;
    storageDriver: "local" | "oss";
    thresholds: {
      crossPriceTolerance: number;
      historyPriceTolerance: number;
      quantityOutlierMultiplier: number;
      minBenchmarkSamples: number;
    };
  };
};

export type CheckResult = {
  id: string;
  itemId: string | null;
  dimension: string;
  type: string;
  severity: "ERROR" | "WARNING" | "INFO";
  status: "OPEN" | "RESOLVED";
  title: string;
  detail: string;
  expectedValue: number | null;
  actualValue: number | null;
};

export type DocumentItem = {
  id: string;
  lineNo: number;
  rawName: string;
  name: string;
  spec: string;
  unit: string;
  quantity: number;
  unitPrice: number | null;
  amount: number | null;
  confidence: number;
  roundingConfirmed?: boolean;
  roundingAdjustment?: RoundingAdjustment | null;
  sourcePageNo?: number | null;
  ingredientId: string | null;
  matchStatus: "MATCHED" | "SIMILAR" | "NEW" | "UNMATCHED";
  matchScore: number | null;
};

export type DocumentDto = {
  batchId?: string | null;
  batchPosition?: number | null;
  checkedVersion?: number | null;
  checkedAt?: string | null;
  id: string;
  docNo: string;
  docDate: string;
  projectId: string;
  projectName: string;
  supplierId: string | null;
  supplierName: string;
  ocrSupplierName: string;
  supplierMatchStatus: "MATCHED" | "SIMILAR" | "NEW" | "UNMATCHED";
  supplierMatchScore: number | null;
  status: "PROCESSING" | "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "NEEDS_REVISION";
  visibility?: {unitPrice:boolean;amount:boolean;contractPrice:boolean;others:boolean;sourceImages:boolean;sensitiveDetails:boolean};
  subtotal: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  notes: string;
  reviewNote: string;
  overrideReason: string;
  version: number;
  ocrError: string;
  ocrWarnings?: string[];
  duplicateSources?: Array<{id:string;date:string;status:string;projectName:string}>;
  createdById: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  items: DocumentItem[];
  pages: Array<{
    id: string;
    pageNo: number;
    fileName: string;
    url: string;
    status: string;
    width: number | null;
    height: number | null;
    sourceDocNo?: string;
    sourceDocDate?: string;
  }>;
  checks: CheckResult[];
};

export type DocumentDetail = {
  document: DocumentDto;
  audit: Array<{
    id: string;
    action: string;
    userName: string;
    detail: unknown;
    createdAt: string;
  }>;
  approvals: Array<{
    id: string;
    action: "APPROVE" | "RETURN" | "OVERRIDE_APPROVE";
    reviewerName: string;
    note: string;
    createdAt: string;
  }>;
};

export type DocumentListItem = {
  previewImageUrl?: string | null;
  id: string;
  docNo: string;
  docDate: string;
  projectId: string;
  projectName: string;
  supplierId: string | null;
  supplierName: string;
  status: DocumentDto["status"];
  totalAmount: number | null;
  itemCount: number;
  errorCount: number;
  warningCount: number;
  createdAt: string;
};

export type SupplierSuggestion = {
  id: string;
  name: string;
  score: number;
  matchStatus: "MATCHED" | "SIMILAR" | "NEW";
  exact: boolean;
  matchedAlias?: string;
  contactName?: string;
  contactPhone?: string;
};

export type IngredientSuggestion = {
  id: string;
  name: string;
  spec: string;
  unit: string;
  category: string;
  score: number;
  matchStatus: "MATCHED" | "SIMILAR" | "NEW";
  exact: boolean;
  matchedAlias?: string;
};

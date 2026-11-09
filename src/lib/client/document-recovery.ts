import type { DocumentDto } from "./types";
export type DocumentRecovery = {
  version: number; status: DocumentDto["status"]; dirty: boolean; reviewNote: string;
  fields: Pick<DocumentDto, "id" | "docNo" | "docDate" | "projectId" | "supplierId" | "supplierName" | "supplierMatchStatus" | "supplierMatchScore" | "subtotal" | "totalAmount" | "notes" | "items">;
};
export function documentRecovery(document: DocumentDto, dirty: boolean, reviewNote: string): DocumentRecovery {
  const { id, docNo, docDate, projectId, supplierId, supplierName, supplierMatchStatus, supplierMatchScore, subtotal, totalAmount, notes, items } = document;
  return { version: document.version, status: document.status, dirty, reviewNote, fields: { id, docNo, docDate, projectId, supplierId, supplierName, supplierMatchStatus, supplierMatchScore, subtotal, totalAmount, notes, items } };
}
export function canRestoreDocument(saved: DocumentRecovery, current: DocumentDto, editable: boolean) {
  return editable && current.visibility?.sensitiveDetails !== false && saved.fields.id === current.id && saved.version === current.version && saved.status === current.status;
}

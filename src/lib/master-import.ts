export const importTypes = ["all", "ingredients", "suppliers", "contracts"] as const;
export type MasterImportType = typeof importTypes[number];
export const importSheets: Record<Exclude<MasterImportType, "all">, string> = {
  ingredients: "原材料", suppliers: "供应商", contracts: "项目合同价",
};

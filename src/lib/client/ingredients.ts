export type IngredientRecord = {
  id: string;
  name: string;
  spec: string;
  unit: string;
  category: string;
  notes: string;
  active: boolean;
  version: number;
  aliases: string[];
  referenced: boolean;
  legacySpec: boolean;
  createdAt: string;
  updatedAt: string;
};
export type IngredientList = {
  items: IngredientRecord[];
  total: number;
  page: number;
  pageSize: number;
  units: string[];
  categories: string[];
};
export type IngredientDetail = {
  ingredient: IngredientRecord;
  contracts: Array<{
    id: string;
    projectName: string;
    supplierName: string;
    spec: string;
    unit: string;
    unitPrice: number;
    startsOn: string;
    endsOn: string | null;
  }>;
};
export type IngredientHistory = {
  total: number;
  page: number;
  pageSize: number;
  items: Array<{
    id: string;
    documentId: string;
    docNo: string;
    docDate: string;
    projectName: string;
    supplierName: string;
    name: string;
    spec: string;
    unit: string;
    quantity: number;
    unitPrice: number | null;
    amount: number | null;
  }>;
};

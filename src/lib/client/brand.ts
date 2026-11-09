export type BrandInfo = {
  logoUrl: string | null;
  version: number;
  width: number;
  height: number;
  viewBox: string;
};

export const emptyBrand: BrandInfo = {
  logoUrl: null, version: 0, width: 1, height: 1, viewBox: "0 0 1 1",
};

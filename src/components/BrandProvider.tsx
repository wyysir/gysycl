"use client";
import { createContext, useContext, useState } from "react";
import type { BrandInfo } from "@/lib/client/brand";
const BrandContext = createContext<{ brand: BrandInfo; setBrand: (value: BrandInfo) => void } | null>(null);
export function BrandProvider({ initialBrand, children }: { initialBrand: BrandInfo; children: React.ReactNode }) {
  const [brand, setBrand] = useState(initialBrand);
  return <BrandContext.Provider value={{ brand, setBrand }}>{children}</BrandContext.Provider>;
}
export function useBrand() {
  const value = useContext(BrandContext);
  if (!value) throw new Error("BrandProvider is required");
  return value;
}
export function BrandLogo({ compact = false }: { compact?: boolean }) {
  const { brand } = useBrand();
  return <div className={`company-brand ${compact ? "company-brand--compact" : ""}`}>
    {brand.logoUrl ? <svg className="company-logo" viewBox={brand.viewBox} role="img" aria-label="公司Logo" preserveAspectRatio="xMidYMid meet">
      <image href={brand.logoUrl} width={brand.width} height={brand.height} />
    </svg> : <strong className="brand-fallback">食安链</strong>}
    {!compact && <span className="company-product">食安链 · 单据核验</span>}
  </div>;
}

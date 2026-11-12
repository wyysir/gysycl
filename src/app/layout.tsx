import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./extra.css";
import "./design.css";
import "./ledger.css";
import "./compact-review.css";
import "./business.css";
import "./batches.css";
import "./review-workspace.css";
import { ToastProvider } from "@/components/ToastProvider";
import { BrandProvider } from "@/components/BrandProvider";
import { getBrand } from "@/server/brand";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "食安链 · 送货单识别与比价",
  description: "餐饮原材料送货单识别、智能建档与多项目比价系统",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#775740",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const brand = await getBrand();
  return (
    <html lang="zh-CN">
      <body>
        <BrandProvider initialBrand={brand}><ToastProvider>{children}</ToastProvider></BrandProvider>
      </body>
    </html>
  );
}

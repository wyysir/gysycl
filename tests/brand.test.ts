import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { getReadyDb } from "@/lib/bootstrap";
import { getBrand, getBrandImage, inspectLogo, maxLogoBytes, saveBrand } from "@/server/brand";
import { getAnalytics } from "@/server/analytics";
import { ingredientHistory } from "@/server/ingredients";
import type { SessionUser } from "@/server/auth";
const admin: SessionUser = { id:"usr_admin", employeeNo:"admin", name:"管理员", globalRole:"ADMIN", memberships:[] };
const finance: SessionUser = { ...admin, id:"usr_finance", globalRole:"FINANCE" };
async function logo() { return sharp({ create:{ width:16, height:12, channels:4, background:{ r:119,g:87,b:64,alpha:1 } } }).png().toBuffer(); }
afterEach(async () => { const db=await getReadyDb(); await db.systemSetting.deleteMany({where:{key:"company.brand"}}); await db.auditLog.deleteMany({where:{entityType:"brand"}}); });
describe("company logo and evidence navigation", () => {
  it("returns a safe empty brand without exposing stored image bytes", async () => {
    expect(await getBrand()).toEqual({logoUrl:null,version:0,width:1,height:1,viewBox:"0 0 1 1"});
    expect(await getBrandImage()).toBeNull();
  });
  it("rejects unknown, corrupt, invisible and oversized images", async () => {
    await expect(inspectLogo(Buffer.from("<svg></svg>"))).rejects.toMatchObject({status:400});
    await expect(inspectLogo(Buffer.from([255,216,255,0]))).rejects.toMatchObject({status:400});
    await expect(inspectLogo(Buffer.alloc(maxLogoBytes+1))).rejects.toMatchObject({status:413});
    const white=await sharp({create:{width:4,height:4,channels:3,background:"white"}}).png().toBuffer();
    await expect(inspectLogo(white)).rejects.toMatchObject({status:400});
  });
  it("rejects finance writes and invalid versions before changing the setting", async () => {
    await expect(saveBrand(finance,await logo(),0)).rejects.toMatchObject({status:403});
    await expect(saveBrand(admin,await logo(),NaN)).rejects.toMatchObject({status:400});
    expect((await getBrand()).version).toBe(0);
  });
  it("stores original bytes, audits only metadata, and rejects stale changes", async () => {
    const bytes=await logo(); const saved=await saveBrand(admin,bytes,0);
    expect(saved.logoUrl).toBe("/api/brand/logo?v=1"); expect(saved.width).toBe(16);
    expect((await getBrandImage())?.bytes.equals(bytes)).toBe(true);
    expect(JSON.stringify(await getBrand())).not.toContain(bytes.toString("base64"));
    await expect(saveBrand(admin,null,0)).rejects.toMatchObject({status:409});
    const db=await getReadyDb(), audit=await db.auditLog.findFirstOrThrow({where:{entityType:"brand"}});
    expect(JSON.stringify(audit)).not.toContain(bytes.toString("base64"));
    const cleared=await saveBrand(admin,null,1); expect(cleared.version).toBe(2); expect(cleared.logoUrl).toBeNull();
    expect(await getBrandImage()).toBeNull();
  });
  it("measures outer whitespace without modifying the original image", async () => {
    const bytes=await sharp({create:{width:100,height:100,channels:4,background:"white"}}).composite([{input:await logo(),left:40,top:30}]).png().toBuffer();
    const bounds=await inspectLogo(bytes); expect(bounds.viewBox).toBe("39 29 18 14");
    await saveBrand(admin,bytes,0); expect((await getBrandImage())?.bytes.equals(bytes)).toBe(true);
  });
  it("allows only one concurrent replacement for the same version", async () => {
    const bytes=await logo(); await saveBrand(admin,bytes,0);
    const results=await Promise.allSettled([saveBrand(admin,bytes,1),saveBrand(admin,bytes,1)]);
    expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);
    const rejected=results.find(result=>result.status==="rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({status:409});
    expect((await getBrand()).version).toBe(2);
  });
  it("provides stable material identifiers and filters history by exact specification", async () => {
    const data=await getAnalytics(admin,{from:"2020-01-01",to:"2030-12-31"});
    expect(data.priceMatrix.length).toBeGreaterThan(0);
    const row=data.priceMatrix[0]; expect(row.ingredientId).toBeTruthy();
    const history=await ingredientHistory(admin,row.ingredientId,{unit:row.unit,spec:row.spec});
    expect(history.items.every(item=>item.spec===row.spec && item.unit===row.unit)).toBe(true);
    const missing=await ingredientHistory(admin,row.ingredientId,{spec:"nonexistent-spec-for-isolation"});
    expect(missing.total).toBe(0);
  });
});

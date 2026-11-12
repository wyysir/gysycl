import { describe, expect, it } from "vitest";
import { itemEditPatch, reviewIssues } from "@/lib/client/item-editing";
import type { CheckResult, DocumentItem } from "@/lib/client/types";
import { formatMoney } from "@/components/ui";
const item: DocumentItem = { id:"line",lineNo:1,name:"测试材料",rawName:"原文",spec:"袋装",unit:"kg",quantity:42.2,unitPrice:1.2,amount:50.6,ingredientId:"ingredient",matchStatus:"MATCHED",matchScore:1,confidence:.7,roundingConfirmed:true };
describe("direct review editing preserves accounting and access semantics", () => {
  it("recalculates ordinary quantities and prices with the original cent rounding", () => {
    expect(itemEditPatch(item,"quantity",42.3,false)).toEqual({ quantity:42.3,amount:50.76 });
    expect(itemEditPatch(item,"unitPrice",1.25,false)).toEqual({ unitPrice:1.25,amount:52.75 });
  });
  it("keeps original batch amounts and explicit user-entered amounts", () => {
    expect(itemEditPatch(item,"quantity",50,true)).toEqual({ quantity:50 });
    expect(itemEditPatch(item,"amount",49.99,false)).toEqual({ amount:49.99 });
  });
  it("does not derive hidden or missing amounts from prices or use hidden prices as zero", () => {
    expect(itemEditPatch({...item,amount:null},"quantity",50,false)).toEqual({ quantity:50 });
    expect(itemEditPatch({...item,unitPrice:null},"quantity",50,false)).toEqual({ quantity:50 });
  });
  it("keeps unit and specification independent and clears stale material matching on name/unit edits", () => {
    expect(itemEditPatch(item,"unit","桶",false)).toMatchObject({unit:"桶",ingredientId:null,matchStatus:"UNMATCHED"});
    expect(itemEditPatch(item,"unit","桶",false)).not.toHaveProperty("spec");
    expect(itemEditPatch(item,"spec","大包装",false)).toEqual({spec:"大包装"});
    expect(itemEditPatch(item,"name","新名称",false).ingredientId).toBeNull();
    expect(itemEditPatch(item,"quantity",Number.NaN,false)).toEqual({});
  });
  it("keeps contract errors in the issue list after a row is inspected", () => {
    const check={id:"error",itemId:item.id,type:"contract_price",status:"OPEN",severity:"ERROR",title:"超合同价"} as CheckResult;
    expect(reviewIssues([item],[check],.9)).toMatchObject([{id:item.id,label:"超合同价",error:true}]);
    expect(reviewIssues([{...item,confidence:1,ingredientId:null}],[],.9)[0].label).toBe("待匹配");
  });
  it("distinguishes missing amounts, legitimate zero, and denied access", () => {
    expect(formatMoney(null)).toBe("—"); expect(formatMoney(undefined)).toBe("—");
    expect(formatMoney(0)).toBe("0.00"); expect(formatMoney(123,false)).toBe("未授权");
    expect(formatMoney(null,false)).toBe("未授权");
  });
});

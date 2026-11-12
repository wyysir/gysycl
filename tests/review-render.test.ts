import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DocumentItemsEditor } from "@/components/DocumentItemsEditor";
import { ToastProvider } from "@/components/ToastProvider";
import type { DocumentItem } from "@/lib/client/types";

const item: DocumentItem = {id:"row",lineNo:1,name:"测试材料",rawName:"原文",spec:"袋装",unit:"kg",quantity:2,unitPrice:864.72,amount:10,confidence:1,ingredientId:"i",matchStatus:"MATCHED",matchScore:1};
function render(editable: boolean, visibility = { unitPrice:true, amount:true }) {
  return renderToStaticMarkup(createElement(ToastProvider, { children: createElement(DocumentItemsEditor, {
    items:[item], batch:true, editable, visibility, threshold:.9, canCreate:false,
    onChange:()=>{},onRemove:()=>{},onNew:()=>{},onAdd:()=>{},onSave:async()=>true,
  }) }));
}
describe("review UI respects edit and monetary permissions", () => {
  it("does not expose batch save/delete controls on read-only documents", () => {
    const html = render(false);
    expect(html).not.toContain("保存本行"); expect(html).not.toContain("删除此行");
    expect(render(true)).toContain("保存本行");
  });
  it("does not render denied prices or arithmetic hints even if stale numeric values are supplied", () => {
    const html = render(true,{unitPrice:false,amount:false});
    expect(html).toContain("未授权"); expect(html).not.toContain("864.72"); expect(html).not.toContain("1729.44");
  });
});

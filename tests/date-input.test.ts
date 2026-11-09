import { describe, expect, it } from "vitest";
import { dateInputValue } from "@/components/ui";
import { parseDateOnly } from "@/lib/text";

describe("维护弹窗的北京时间日期", () => {
  it("UTC前一天时间应回填为北京时间原日期", () => {
    expect(dateInputValue("2026-11-06T16:00:00.000Z")).toBe("2026-11-07");
  });
  it("连续五次保存和读取不改变合同日期", () => {
    let value = "2026-11-07";
    for (let index = 0; index < 5; index++) value = dateInputValue(parseDateOnly(value)!.toISOString());
    expect(value).toBe("2026-11-07");
  });
  it("空截止日期保持空值", () => {
    expect(dateInputValue(null)).toBe("");
  });
});

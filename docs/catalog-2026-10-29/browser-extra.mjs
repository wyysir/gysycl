import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
const base = "http://localhost:3107",
  results = [];
const browser = await chromium.launch({ headless: true, channel: "msedge" }),
  context = await browser.newContext({ viewport: { width: 390, height: 844 } }),
  page = await context.newPage();
page.setDefaultTimeout(15000);
try {
  await page.goto(base + "/login");
  await page.getByLabel("员工号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录系统", exact: true }).click();
  await page.waitForURL("**/dashboard");
  const name = "并发界面验收" + Date.now();
  const created = await page.request.post(
    base + "/api/master-data/ingredients",
    {
      data: { name, unit: "斤", spec: "斤", notes: "旧备注", confirmNew: true },
    },
  );
  assert.equal(created.status(), 201);
  const { id } = await created.json();
  await page.goto(base + "/ingredients");
  await page.getByLabel("搜索原材料").fill(name);
  await page.getByRole("button", { name: "查看 / 编辑", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "材料详情" });
  await dialog.getByLabel("备注", { exact: true }).waitFor();
  await dialog.getByLabel("备注", { exact: true }).fill("过期窗口修改");
  const current = (
    await (
      await page.request.get(base + "/api/master-data/ingredients/" + id)
    ).json()
  ).ingredient;
  const winner = await page.request.patch(
    base + "/api/master-data/ingredients/" + id,
    { data: { ...current, notes: "另一窗口已保存" } },
  );
  assert.equal(winner.status(), 200);
  await dialog.getByRole("button", { name: "保存材料", exact: true }).click();
  await dialog.getByRole("alert").waitFor();
  assert.match(await dialog.getByRole("alert").innerText(), /刷新|重新打开/);
  assert(
    await dialog
      .getByRole("button", { name: "保存材料", exact: true })
      .isDisabled(),
  );
  assert.equal(
    (
      await (
        await page.request.get(base + "/api/master-data/ingredients/" + id)
      ).json()
    ).ingredient.notes,
    "另一窗口已保存",
  );
  results.push("并发保存提示409且保留胜出版本");
  await dialog.getByRole("button", { name: "关闭材料详情" }).click();
  await page.getByRole("button", { name: "查看 / 编辑", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "材料详情" });
  await dialog.getByLabel("备注", { exact: true }).waitFor();
  assert.equal(
    await dialog.getByLabel("备注", { exact: true }).inputValue(),
    "另一窗口已保存",
  );
  await dialog.getByRole("checkbox").uncheck();
  await dialog.getByRole("button", { name: "保存材料", exact: true }).click();
  await page.getByText("原材料已保存", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "关闭材料详情" }).click();
  await page.getByLabel("状态", { exact: true }).selectOption("inactive");
  await page
    .getByRole("button", { name: "查看 / 编辑", exact: true })
    .waitFor();
  results.push("停用保存并可按停用状态筛选");
  await page.goto(base + "/settings");
  await page.getByPlaceholder("编码，如 SH-HQ").fill("UI-" + Date.now());
  await page
    .getByPlaceholder("项目点名称", { exact: true })
    .fill("设置迁移验收项目" + Date.now());
  await page.getByRole("button", { name: "新增", exact: true }).click();
  await page.getByText("项目点已新增", { exact: true }).waitFor();
  await page
    .locator(".project-chip-list")
    .getByText("设置迁移验收项目", { exact: false })
    .first()
    .waitFor();
  results.push("系统设置实际新增项目并刷新列表");
  await fs.writeFile(
    new URL("browser-extra-results.json", import.meta.url),
    JSON.stringify({ status: "PASS", checks: results }, null, 2),
  );
  console.log(results);
} catch (error) {
  await page
    .screenshot({
      path: new URL("failure-extra.png", import.meta.url).pathname.slice(1),
      fullPage: true,
    })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
}

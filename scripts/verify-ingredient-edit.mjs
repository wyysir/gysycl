import assert from "node:assert/strict";
import fs from "node:fs/promises";
import nodePath from "node:path";
import { chromium } from "playwright-core";

const base = process.env.INGREDIENT_TEST_URL || "http://localhost:3237";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Use an isolated local demo only");
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const checks = [], errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const get = async (path) => {
  const response = await context.request.get(base + path);
  assert.equal(response.status(), 200);
  return response.json();
};
try {
  assert.equal((await context.request.post(base + "/api/auth/login", {
    data: { employeeNo: "admin", password: "admin123" }, headers: { Origin: base },
  })).status(), 200);
  assert.equal((await get("/api/bootstrap")).system.ocrMode, "mock");
  const item = (await get("/api/master-data/ingredients")).items.find((item) => item.referenced);
  assert(item, "A referenced demo material is required");
  const path = "/api/master-data/ingredients/" + item.id;
  const before = await get(path), historyBefore = await get(path + "/history");
  const documentsBefore = await Promise.all([...new Set(historyBefore.items.map((row) => row.documentId))]
    .map(async (id) => [id, await get("/api/documents/" + id)]));
  await page.goto(base + "/ingredients", { waitUntil: "networkidle" });
  await page.locator("article.catalog-item").filter({ has: page.getByRole("heading", { name: item.name, exact: true }) })
    .getByRole("button", { name: "查看 / 编辑", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "材料详情", exact: true });
  const spec = dialog.getByLabel("规格", { exact: true });
  const unit = dialog.getByLabel("计量单位 *", { exact: true });
  assert(await spec.isEditable()); assert(await unit.isEditable());
  await spec.fill("500克/袋"); await unit.fill("袋");
  assert.equal(await spec.inputValue(), "500克/袋");
  const saved = page.waitForResponse((response) => response.url().endsWith(path) && response.request().method() === "PATCH");
  await dialog.getByRole("button", { name: "保存材料", exact: true }).click();
  assert.equal((await saved).status(), 200);
  await page.reload({ waitUntil: "networkidle" });
  await spec.waitFor();
  assert.equal(await spec.inputValue(), "500克/袋"); assert.equal(await unit.inputValue(), "袋");
  checks.push("电脑编辑已引用材料的规格和单位，保存并刷新后保留自定义规格");
  await page.setViewportSize({ width: 390, height: 844 });
  await spec.fill("1公斤/箱"); await unit.fill("箱");
  const mobileSaved = page.waitForResponse((response) => response.url().endsWith(path) && response.request().method() === "PATCH");
  await dialog.getByRole("button", { name: "保存材料", exact: true }).click();
  assert.equal((await mobileSaved).status(), 200);
  await page.reload({ waitUntil: "networkidle" }); await spec.waitFor();
  assert.equal(await spec.inputValue(), "1公斤/箱"); assert.equal(await unit.inputValue(), "箱");
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  checks.push("390px手机布局可编辑、保存并刷新规格和单位，无整页横向溢出");
  assert.deepEqual((await get(path)).contracts, before.contracts);
  assert.deepEqual(await get(path + "/history"), historyBefore);
  for (const [id, snapshot] of documentsBefore) assert.deepEqual(await get("/api/documents/" + id), snapshot);
  checks.push("修改材料后，关联合同、已通过采购历史及单据快照保持一致");
  const latest = (await get(path)).ingredient;
  const invalid = await context.request.patch(base + path, {
    headers: { Origin: base }, data: { ...latest, spec: "a".repeat(101) },
  });
  assert.equal(invalid.status(), 400);
  assert.equal((await get(path)).ingredient.version, latest.version);
  checks.push("接口接收规格字段，并拒绝超过100字的规格且不修改版本");
  await dialog.getByRole("button", { name: "关闭材料详情", exact: true }).click();
  await page.getByRole("button", { name: "新增原材料", exact: true }).click();
  const create = page.getByRole("dialog", { name: "新增原材料", exact: true });
  await create.getByLabel("规范品名 *", { exact: true }).fill("规格单位回归" + Date.now());
  await create.getByLabel("计量单位 *", { exact: true }).fill("袋");
  assert.equal(await create.getByLabel("规格", { exact: true }).inputValue(), "袋");
  await create.getByLabel("规格", { exact: true }).fill("250克/袋");
  const created = page.waitForResponse((response) => response.url().endsWith("/api/master-data/ingredients") && response.request().method() === "POST");
  await create.getByRole("button", { name: "保存材料", exact: true }).click();
  const createdResponse = await created; assert.equal(createdResponse.status(), 201);
  const createdItem = await createdResponse.json();
  assert.equal((await get("/api/master-data/ingredients/" + createdItem.id)).ingredient.spec, "250克/袋");
  checks.push("新增材料默认规格随单位填写，手动填写的规格保存后不被单位覆盖");
  assert.deepEqual(errors, []);
  const result = { status: "PASS", checkedAt: new Date().toISOString(), checks, pageErrors: errors, paidOcrCalls: 0, environment: "Isolated local mock only" };
  const output = process.env.INGREDIENT_TEST_REPORT || ".tmp/ingredient-edit-browser-results.json";
  await fs.mkdir(nodePath.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}

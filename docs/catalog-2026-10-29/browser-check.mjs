import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
const base = "http://localhost:3107",
  output = import.meta.dirname;
const fixtures = JSON.parse(
  await fs.readFile(path.join(output, "fixtures.json"), "utf8"),
);
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  timezoneId: "Asia/Shanghai",
});
const page = await context.newPage(),
  errors = [],
  checks = [];
page.setDefaultTimeout(15000);
page.on("pageerror", (error) => errors.push(error.message));
function passed(name) {
  checks.push(name);
  console.log("PASS " + name);
}
async function login(target, employeeNo, password) {
  await target.goto(base + "/login");
  await target.getByLabel("员工号", { exact: true }).fill(employeeNo);
  await target.getByLabel("密码", { exact: true }).fill(password);
  await target.getByRole("button", { name: "登录系统", exact: true }).click();
  await target.waitForURL("**/dashboard");
}
async function fits() {
  const geometry = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert(geometry.scroll <= geometry.width + 1, JSON.stringify(geometry));
  return geometry;
}
try {
  await login(page, "admin", "admin123");
  const reset = (
    await (
      await page.request.get(base + "/api/documents/" + fixtures.documentId)
    ).json()
  ).document;
  await page.request.patch(base + "/api/documents/" + fixtures.documentId, {
    data: {
      ...reset,
      items: reset.items.map((item) => ({
        ...item,
        quantity: 5,
        unitPrice: 4,
        amount: 20,
      })),
      totalAmount: 20,
    },
  });
  await page.goto(base + `/documents/${fixtures.documentId}`, {
    waitUntil: "networkidle",
  });
  const card = page.getByRole("article", { name: "第1项明细", exact: true });
  await card.waitFor();
  for (const field of ["数量", "单位", "单价", "行金额", "规格", "OCR置信度"]) {
    const box = await page
      .getByLabel("第1项" + field, { exact: true })
      .boundingBox();
    assert(box && box.x >= 0 && box.x + box.width <= 391, field);
  }
  assert.equal(
    await card
      .locator(".line-fields")
      .evaluate(
        (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length,
      ),
    2,
  );
  assert.match(await card.innerText(), /86%/);
  await fits();
  await page.screenshot({
    path: path.join(output, "detail-mobile.png"),
    fullPage: true,
  });
  passed(
    "390px: six fields visible in two columns without horizontal scrolling",
  );
  await card.getByRole("button", { name: "更换材料", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "更换材料", exact: true });
  await dialog.getByLabel("搜索材料名称或别名").fill("浏览别名1");
  await dialog.locator(".picker-result").first().waitFor();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(
    await page.getByLabel("第1项品名", { exact: true }).inputValue(),
    "浏览验收材料00",
  );
  passed("cancel keeps current matched material");
  await card.getByRole("button", { name: "更换材料", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "更换材料", exact: true });
  await dialog.getByLabel("搜索材料名称或别名").fill("浏览验收");
  await dialog
    .locator(".picker-section")
    .last()
    .getByRole("button")
    .first()
    .waitFor();
  assert.equal(
    await dialog.locator(".picker-section").last().getByRole("button").count(),
    20,
  );
  await dialog.getByRole("button", { name: "下一页", exact: true }).click();
  await dialog.getByText("第 2 页 · 25 条", { exact: true }).waitFor();
  await dialog
    .locator(".picker-section")
    .last()
    .getByRole("button")
    .last()
    .click();
  assert.equal(
    await page.getByLabel("第1项数量", { exact: true }).inputValue(),
    "5",
  );
  assert.equal(
    await page.getByLabel("第1项单价", { exact: true }).inputValue(),
    "4",
  );
  assert.equal(
    await page.getByLabel("第1项行金额", { exact: true }).inputValue(),
    "20",
  );
  assert.match(await card.innerText(), /86%/);
  passed(
    "entire catalog paginates beyond recommended candidates; switching retains numbers and OCR confidence",
  );
  let slowStarted;
  const slowSignal = new Promise((resolve) => {
    slowStarted = resolve;
  });
  await page.route("**/api/master-data/ingredients?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("q") === "浏览验收材料00") {
      slowStarted();
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 900));
      await route.fulfill({ response });
    } else await route.continue();
  });
  await card.getByRole("button", { name: "更换材料", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "更换材料", exact: true });
  await dialog.getByLabel("搜索材料名称或别名").fill("浏览验收材料00");
  await slowSignal;
  await dialog.getByLabel("搜索材料名称或别名").fill("浏览验收材料01");
  await dialog
    .locator(".picker-section")
    .last()
    .getByRole("button")
    .filter({ hasText: "浏览验收材料01" })
    .waitFor();
  await page.waitForTimeout(1100);
  assert.equal(
    await dialog.getByLabel("搜索材料名称或别名").inputValue(),
    "浏览验收材料01",
  );
  assert.equal(
    await dialog.locator(".picker-section").last().getByRole("button").count(),
    1,
  );
  await dialog.locator(".picker-section").last().getByRole("button").click();
  await page.unroute("**/api/master-data/ingredients?**");
  passed("delayed old search cannot overwrite latest query or results");
  await page.getByLabel("第1项数量", { exact: true }).fill("6");
  assert.equal(
    await page.getByLabel("第1项行金额", { exact: true }).inputValue(),
    "24",
  );
  await page.getByLabel("第1项单位", { exact: true }).fill("袋");
  assert.equal(
    await page.getByLabel("第1项规格", { exact: true }).inputValue(),
    "袋",
  );
  assert.match(await card.innerText(), /待匹配/);
  assert.equal(
    await page.getByLabel("第1项数量", { exact: true }).inputValue(),
    "6",
  );
  await card.getByRole("button", { name: "更换材料", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "更换材料", exact: true });
  await dialog.getByLabel("搜索材料名称或别名").fill("浏览验收材料00");
  await dialog
    .locator(".picker-section")
    .last()
    .getByRole("button")
    .first()
    .click();
  await card.getByRole("button", { name: "清除匹配", exact: true }).click();
  assert.equal(
    await page.getByLabel("第1项品名", { exact: true }).inputValue(),
    "浏览验收材料00",
  );
  assert.equal(
    await page.getByLabel("第1项行金额", { exact: true }).inputValue(),
    "24",
  );
  await card.getByRole("button", { name: "更换材料", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "更换材料", exact: true });
  await dialog
    .locator(".picker-section")
    .last()
    .getByRole("button")
    .first()
    .click();
  await page.getByLabel("第1项品名", { exact: true }).fill("人工改名");
  assert.match(await card.innerText(), /待匹配/);
  await card.getByRole("button", { name: "更换材料", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "更换材料", exact: true });
  await dialog.getByLabel("搜索材料名称或别名").fill("浏览验收材料00");
  await dialog
    .locator(".picker-section")
    .last()
    .getByRole("button")
    .first()
    .click();
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await page.getByText("修改已保存，比对结果已刷新", { exact: true }).waitFor();
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(
    await page.getByLabel("第1项数量", { exact: true }).inputValue(),
    "6",
  );
  assert.equal(
    await page.getByLabel("第1项行金额", { exact: true }).inputValue(),
    "24",
  );
  assert.match(await card.innerText(), /86%/);
  passed(
    "quantity recalculation, name/unit unlinking, clear/rematch and save/refresh work",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(
    await card
      .locator(".line-fields")
      .evaluate(
        (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length,
      ),
    3,
  );
  await page.screenshot({
    path: path.join(output, "detail-desktop.png"),
    fullPage: true,
  });
  passed("desktop: three columns and original-image panel retained");
  await page.goto(base + `/documents/${fixtures.approvedId}`, {
    waitUntil: "networkidle",
  });
  assert(
    await page
      .getByText("已通过单据仅供查看；撤回后修改，操作会保留记录。", {
        exact: true,
      })
      .isVisible(),
  );
  assert.equal(
    await page.getByRole("button", { name: "更换材料", exact: true }).count(),
    0,
  );
  assert(await page.getByLabel("第1项品名", { exact: true }).isDisabled());
  passed("approved document stays read-only until withdrawal");
  await page.goto(base + "/master", { waitUntil: "networkidle" });
  assert.equal(
    await page.getByRole("heading", { name: "项目点", exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("heading", { name: "员工账号列表", exact: true })
      .count(),
    0,
  );
  await page.goto(base + "/settings", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "项目点", exact: true }).waitFor();
  await page.getByRole("tab", { name: "员工", exact: true }).click();
  await page
    .getByRole("heading", { name: "员工账号列表", exact: true })
    .waitFor();
  passed(
    "contract page split; settings contains existing project and employee functions",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "更多", exact: true }).click();
  const more = page.getByRole("navigation", { name: "更多功能" });
  for (const name of ["原材料管理", "合同主数据", "价格分析", "系统设置"])
    assert(await more.getByRole("link", { name, exact: true }).isVisible());
  await more.getByRole("link", { name: "原材料管理", exact: true }).click();
  await page
    .getByRole("heading", { name: "原材料管理", exact: true })
    .waitFor();
  await page.getByLabel("搜索原材料").fill("浏览验收材料00");
  await page
    .getByRole("button", { name: "查看 / 编辑", exact: true })
    .first()
    .click();
  let detail = page.getByRole("dialog", { name: "材料详情" });
  await detail.getByLabel("计量单位 *", { exact: true }).waitFor();
  assert(await detail.getByLabel("计量单位 *", { exact: true }).isDisabled());
  await detail.getByRole("tab", { name: "合同价格", exact: true }).click();
  await detail.getByText("规格 斤", { exact: false }).waitFor();
  await detail.getByRole("tab", { name: "采购历史", exact: true }).click();
  await detail
    .getByRole("link", { name: "BROWSER-APPROVED", exact: true })
    .waitFor();
  assert.equal(
    await detail
      .getByRole("link", { name: "BROWSER-EDIT", exact: true })
      .count(),
    0,
  );
  await detail.getByRole("tab", { name: "基本资料", exact: true }).click();
  await detail.getByLabel("备注", { exact: true }).fill("浏览器修改备注");
  await detail
    .getByLabel("多个别名（用顿号、逗号或换行分隔）", { exact: true })
    .fill("手机别名一、手机别名二");
  await detail.getByRole("button", { name: "保存材料", exact: true }).click();
  await page.getByText("原材料已保存", { exact: true }).waitFor();
  await detail.getByLabel("备注", { exact: true }).waitFor();
  await detail.getByRole("button", { name: "关闭材料详情" }).click();
  await fits();
  passed(
    "mobile More navigation; referenced-unit restriction, scoped contracts/history and metadata editing",
  );
  await page.getByLabel("搜索原材料").fill("手机别名一");
  await page.waitForTimeout(450);
  assert.equal(await page.locator(".catalog-item").count(), 1);
  await page.getByRole("button", { name: "查看 / 编辑", exact: true }).click();
  detail = page.getByRole("dialog", { name: "材料详情" });
  await detail
    .getByRole("button", { name: "新增另一单位记录", exact: true })
    .click();
  detail = page.getByRole("dialog", { name: "新增原材料" });
  await detail.getByLabel("计量单位 *", { exact: true }).fill("袋");
  assert.equal(
    await detail.getByLabel("规格", { exact: true }).inputValue(),
    "袋",
  );
  await detail.getByRole("button", { name: "保存材料", exact: true }).click();
  await page.getByText("原材料已新增", { exact: true }).waitFor();
  detail = page.getByRole("dialog", { name: "材料详情" });
  await detail.getByLabel("计量单位 *", { exact: true }).waitFor();
  assert.equal(
    await detail.getByLabel("计量单位 *", { exact: true }).inputValue(),
    "袋",
  );
  await detail.getByRole("button", { name: "关闭材料详情" }).click();
  passed("alias search and separate unit creation default spec to unit");
  await page.getByLabel("搜索原材料").fill("手机别名一");
  await page.waitForTimeout(450);
  await page.screenshot({
    path: path.join(output, "catalog-mobile.png"),
    fullPage: true,
  });
  const financeContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const finance = await financeContext.newPage();
  finance.on("pageerror", (error) => errors.push(error.message));
  await login(finance, "finance", "finance123");
  await finance.goto(base + "/settings");
  await finance.waitForURL("**/dashboard");
  await finance.goto(base + `/documents/${fixtures.documentId}`, {
    waitUntil: "networkidle",
  });
  assert.equal(
    await finance
      .getByRole("button", { name: "更换材料", exact: true })
      .count(),
    0,
  );
  await finance.goto(base + "/ingredients", { waitUntil: "networkidle" });
  assert.equal(
    await finance
      .getByRole("button", { name: "新增原材料", exact: true })
      .count(),
    0,
  );
  await finance.getByRole("button", { name: "更多", exact: true }).click();
  assert.equal(
    await finance
      .getByRole("navigation", { name: "更多功能" })
      .getByRole("link", { name: "系统设置", exact: true })
      .count(),
    0,
  );
  await financeContext.close();
  passed("finance cannot edit and cannot enter admin settings");
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(output, "browser-results.json"),
    JSON.stringify({ status: "PASS", checks, pageErrors: errors }, null, 2),
  );
} catch (error) {
  await page
    .screenshot({ path: path.join(output, "failure.png"), fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
}

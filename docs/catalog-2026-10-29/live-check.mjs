// Read-only verification of the deployed trial. Credentials stay in memory.
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";
const base = "https://42.121.106.105";
const remote =
  "import json,pathlib; p=pathlib.Path('/opt/delivery-audit/admin.private.env'); a=dict(x.split('=',1) for x in p.read_text().splitlines() if '=' in x); print(json.dumps({'employeeNo':a['ADMIN_EMPLOYEE_NO'],'password':a['ADMIN_PASSWORD']}))";
const command = `python3 -c "import base64;exec(base64.b64decode('${Buffer.from(remote).toString("base64")}'))"`;
const account = JSON.parse(
  execFileSync(
    "C:/Windows/System32/OpenSSH/ssh.exe",
    [
      "-i",
      "C:/Users/Administrator/.ssh/gysycl_42_121_106_105",
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "UserKnownHostsFile=C:/Users/Administrator/.ssh/gysycl_known_hosts",
      "root@42.121.106.105",
      command,
    ],
    { encoding: "utf8", timeout: 30000 },
  ),
);
const browser = await chromium.launch({ headless: true, channel: "msedge" }),
  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    timezoneId: "Asia/Shanghai",
  }),
  page = await context.newPage();
page.setDefaultTimeout(15000);
const checks = [],
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(base + "/login", { waitUntil: "networkidle" });
  await page.getByLabel("员工号", { exact: true }).fill(account.employeeNo);
  await page.getByLabel("密码", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "登录系统", exact: true }).click();
  await page.waitForURL("**/dashboard");
  checks.push("真实HTTPS与现有管理员登录通过");
  const response = await page.request.get(
    base + "/api/master-data/ingredients?status=all",
  );
  assert.equal(response.status(), 200);
  const list = await response.json();
  assert.equal(list.pageSize, 20);
  for (const item of list.items) {
    assert.equal(typeof item.notes, "string");
    assert(Number.isInteger(item.version) && item.version >= 1);
  }
  checks.push("线上新材料接口与新增字段正常");
  await page.goto(base + "/ingredients", { waitUntil: "networkidle" });
  await page
    .getByRole("heading", { name: "原材料管理", exact: true })
    .waitFor();
  if (list.items.length) {
    await page
      .getByRole("button", { name: "查看 / 编辑", exact: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog", { name: "材料详情" });
    await dialog.getByLabel("备注", { exact: true }).waitFor();
    await dialog.getByRole("tab", { name: "合同价格", exact: true }).click();
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/history?") && r.status() === 200,
      ),
      dialog.getByRole("tab", { name: "采购历史", exact: true }).click(),
    ]);
    await dialog.getByRole("button", { name: "关闭材料详情" }).click();
  }
  const geometry = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert(geometry.scroll <= 391);
  await page.screenshot({
    path: new URL("catalog-live-mobile.png", import.meta.url).pathname.slice(1),
    fullPage: true,
  });
  checks.push("手机材料页、资料/合同/采购历史页签正常，无横向溢出");
  await page.getByRole("button", { name: "更多", exact: true }).click();
  const menu = page.getByRole("navigation", { name: "更多功能" });
  for (const name of ["原材料管理", "合同主数据", "价格分析", "系统设置"])
    assert(await menu.getByRole("link", { name, exact: true }).isVisible());
  await menu.getByRole("link", { name: "系统设置", exact: true }).click();
  await page.getByRole("heading", { name: "项目点", exact: true }).waitFor();
  await page.getByRole("tab", { name: "员工", exact: true }).click();
  await page
    .getByRole("heading", { name: "员工账号列表", exact: true })
    .waitFor();
  checks.push("更多菜单和系统设置两个页签正常");
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
  checks.push("旧合同地址保留，项目员工已迁出");
  const documents = (
    await (await page.request.get(base + "/api/documents")).json()
  ).documents;
  const candidate = documents.find((d) => d.status === "DRAFT") || documents[0];
  if (candidate) {
    await page.goto(base + "/documents/" + candidate.id, {
      waitUntil: "networkidle",
    });
    const cards = page.locator(".line-card");
    if (await cards.count()) {
      for (const field of [
        "数量",
        "单位",
        "单价",
        "行金额",
        "规格",
        "OCR置信度",
      ]) {
        const box = await page
          .getByLabel("第1项" + field, { exact: true })
          .boundingBox();
        assert(box && box.x >= 0 && box.x + box.width <= 391);
      }
      assert.match(await cards.first().innerText(), /OCR置信度/);
      await cards
        .first()
        .screenshot({
          path: new URL(
            "detail-live-mobile.png",
            import.meta.url,
          ).pathname.slice(1),
        });
      if (candidate.status === "DRAFT") {
        await cards
          .first()
          .getByRole("button", { name: "更换材料", exact: true })
          .click();
        await page
          .getByRole("dialog", { name: "更换材料", exact: true })
          .getByRole("button", { name: "取消", exact: true })
          .click();
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      assert.equal(
        await cards
          .first()
          .locator(".line-fields")
          .evaluate(
            (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length,
          ),
        3,
      );
    }
    checks.push("现有真实单据卡片手机/电脑检查，打开搜索后取消，未保存修改");
  }
  assert.deepEqual(errors, []);
  const result = {
    status: "PASS",
    base,
    readOnly: true,
    checks,
    materialCount: list.total,
    documentCount: documents.length,
    mobileGeometry: geometry,
    pageErrors: errors,
  };
  await fs.writeFile(
    new URL("live-results.json", import.meta.url),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}

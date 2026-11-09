import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const baseUrl = process.env.APP_URL || "http://localhost:3000";
const outputDir = path.join(process.cwd(), ".data", "screenshots");
await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath:
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  timezoneId: "Asia/Shanghai",
  locale: "zh-CN",
});
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
await page.screenshot({
  path: path.join(outputDir, "login.png"),
  fullPage: true,
});
await page.getByLabel("员工号").fill("admin");
await page.getByLabel("密码").fill("admin123");
await page.getByRole("button", { name: "登录系统" }).click();
await page.waitForURL("**/dashboard", { timeout: 20_000 });
await page.waitForLoadState("networkidle");
await page.waitForTimeout(1000);
await page.screenshot({
  path: path.join(outputDir, "dashboard.png"),
  fullPage: true,
});
await page.goto(`${baseUrl}/documents/doc_demo_002`, {
  waitUntil: "networkidle",
});
await page.waitForTimeout(1000);
await page.screenshot({
  path: path.join(outputDir, "document.png"),
  fullPage: true,
});
await page.goto(`${baseUrl}/analytics`, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
await page.screenshot({
  path: path.join(outputDir, "analytics.png"),
  fullPage: true,
});

const mobile = await context.newPage();
await mobile.setViewportSize({ width: 390, height: 844 });
await mobile.goto(`${baseUrl}/documents/doc_demo_002`, {
  waitUntil: "networkidle",
});
await mobile.waitForTimeout(1000);
await mobile.screenshot({
  path: path.join(outputDir, "document-mobile.png"),
  fullPage: true,
});

console.log(
  JSON.stringify(
    {
      outputDir,
      errors,
      title: await page.title(),
    },
    null,
    2,
  ),
);
await browser.close();

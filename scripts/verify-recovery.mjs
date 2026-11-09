// Local isolated demo only. Does not target production or call real OCR.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium, webkit } from "playwright-core";
import sharp from "sharp";
const base = process.env.RECOVERY_TEST_URL || "http://localhost:3236";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Only a local isolated demo may be tested");
const engine = process.argv[2] || "chromium";
const browser = await (engine === "webkit" ? webkit.launch({ headless: true }) : chromium.launch({ headless: true, channel: "msedge" }));
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage(); page.setDefaultTimeout(15000); page.on("dialog", d => d.accept());
const errors = [], checks = []; page.on("pageerror", e => errors.push({ url: page.url(), step: checks.length, name: e.name, message: e.message, stack: e.stack }));
const get = async path => (await (await page.request.get(base + path)).json());
const dialog = page.getByRole("dialog", { name: "未保存的内容", exact: true });
const notes = () => page.locator(".editor-evidence textarea").first();
async function revealNotes() {
  await notes().waitFor({ state: "attached" });
  if (!await notes().isVisible()) {
    await page.getByRole("button", { name: "更多单据操作", exact: true }).click();
    await page.getByRole("button", { name: "处理依据与记录", exact: true }).click();
  }
  await notes().waitFor();
}
const readDrafts = () => page.evaluate(() => new Promise((resolve, reject) => {
  const req = indexedDB.open("delivery-edit-recovery-v1"); req.onerror = reject;
  req.onsuccess = () => { const db = req.result, request = db.transaction("drafts").objectStore("drafts").getAll(); request.onsuccess = async () => {
    const rows = await Promise.all(request.result.map(async row => ({ scope: row.scope, owner: row.owner, value: { ...row.value, images: row.value.images && await Promise.all(row.value.images.map(async i => { const bytes = i.file.bytes || await i.file.arrayBuffer(); return { name: i.file.name, size: bytes.byteLength, sha256: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))), type: i.file.type }; })) } })));
    resolve(rows); db.close();
  }; };
}));
async function waitDraft(scope) { await page.waitForFunction(async scope => { const rows = await new Promise(resolve => { const req = indexedDB.open("delivery-edit-recovery-v1"); req.onsuccess = () => { const db = req.result, r = db.transaction("drafts").objectStore("drafts").getAll(); r.onsuccess = () => { resolve(r.result); db.close(); }; }; }); return rows.some(row => row.scope === scope); }, scope); }
// Local production builds set Secure cookies; WebKit requires HTTPS for them even
// on localhost. Only this isolated HTTP test context relaxes the cookie flag.
async function localCookies() { await ctx.addCookies((await ctx.cookies()).map(cookie => ({ ...cookie, secure: false }))); }
async function login() { assert.equal((await page.request.post(base + "/api/auth/login", { headers: { Origin: base }, data: { employeeNo: "admin", password: "admin123" } })).status(), 200); await localCookies(); assert.equal((await get("/api/bootstrap")).system.ocrMode, "mock"); }
async function openDocument(id) {
  await page.goto(base + "/dashboard", { waitUntil: "networkidle" });
  await page.locator('a[href="/documents"]:visible').first().click(); await page.waitForURL("**/documents");
  await page.locator(`a[href="/documents/${id}?from=documents"]`).first().click(); await page.waitForURL("**/documents/" + id + "*"); await revealNotes();
}
async function back() { await page.evaluate(() => history.back()); await dialog.waitFor(); }
try {
  await login();
  const owner = (await get("/api/bootstrap")).user.id;
  const docs = (await get("/api/documents?status=DRAFT")).documents;
  const id = docs[0].id, scope = "/documents/" + id;
  await openDocument(id);
  const originalHref = page.url();
  const note = "B06 recovery " + engine + " " + Date.now(); await notes().fill(note); await waitDraft(scope);
  const historyLength = await page.evaluate(() => history.length);
  for (let i = 0; i < 3; i++) { await back(); assert.equal(page.url(), originalHref); await dialog.getByRole("button", { name: "取消", exact: true }).click(); assert.equal(await notes().inputValue(), note); }
  assert.equal(await page.evaluate(() => history.length), historyLength); checks.push("连续后退并取消：URL、输入、历史长度保持一致");
  await page.evaluate(() => { history.back(); history.back(); }); await dialog.waitFor(); await page.waitForTimeout(200);
  assert.equal(page.url(), originalHref); await dialog.getByRole("button", { name: "取消", exact: true }).click(); assert.equal(await notes().inputValue(), note); checks.push("快速重复后退不叠加弹窗或损坏历史栈");
  await page.evaluate(() => history.go(-2)); await dialog.waitFor(); assert.equal(page.url(), originalHref); await dialog.getByRole("button", { name: "取消", exact: true }).click(); checks.push("跨两条站内历史返回可取消并保留原位置");
  await back(); await dialog.getByRole("button", { name: "暂存并离开", exact: true }).click(); await page.waitForURL("**/documents");
  await page.evaluate(() => history.forward()); await revealNotes(); await page.waitForFunction(note => document.querySelector(".editor-evidence textarea")?.value === note, note); checks.push("历史前进重入详情仍恢复未保存内容");
  await back(); await dialog.getByRole("button", { name: "暂存并离开", exact: true }).click(); await page.waitForURL("**/documents");
  await page.locator(`a[href="/documents/${id}?from=documents"]`).first().click(); await revealNotes(); await page.waitForFunction(note => document.querySelector(".editor-evidence textarea")?.value === note, note); checks.push("暂存后返回列表，再进入恢复完整备注");
  await page.reload({ waitUntil: "networkidle" }); await page.waitForFunction(note => document.querySelector(".editor-evidence textarea")?.value === note, note); checks.push("刷新恢复，不依赖 React 内存");
  await page.goto("about:blank"); await page.goBack({ waitUntil: "networkidle" }); await revealNotes(); await page.waitForFunction(note => document.querySelector(".editor-evidence textarea")?.value === note, note); checks.push("跨文档离开后返回也能从恢复副本找回输入");
  await page.route("**/api/documents/" + id, route => route.request().method() === "PATCH" ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "模拟保存失败" }) }) : route.continue());
  await back(); await dialog.getByRole("button", { name: "保存并离开", exact: true }).click(); await dialog.getByRole("alert").waitFor(); assert.equal(page.url(), originalHref); assert.equal(await notes().inputValue(), note); checks.push("保存失败停留原页，数据和恢复副本保留");
  await page.unroute("**/api/documents/" + id);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.evaluate(() => { window.originalDraftPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function () { throw new DOMException("模拟存储已满", "QuotaExceededError"); }; });
  await back(); await dialog.getByRole("button", { name: "暂存并离开", exact: true }).click(); await dialog.getByRole("alert").waitFor(); assert.equal(page.url(), originalHref); assert.equal(await notes().inputValue(), note); checks.push("存储配额失败拒绝暂存离开，错误可见且原输入仍在");
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.originalDraftPut; });
  await dialog.getByRole("button", { name: "保存并离开", exact: true }).click(); await page.waitForURL("**/documents"); assert.equal((await get("/api/documents/" + id)).document.notes, note); assert(!(await readDrafts()).some(r => r.scope === scope)); checks.push("保存成功后按原目标后退一次并清理副本");
  // Forward traversal must be protected too.
  await page.evaluate(() => history.forward()); await revealNotes();
  await page.getByRole("link", { name: "返回列表", exact: true }).click(); await page.waitForURL("**/documents"); await page.evaluate(() => history.back()); await revealNotes();
  await notes().fill(note + " forward"); await page.evaluate(() => history.forward()); await dialog.waitFor(); await dialog.getByRole("button", { name: "取消", exact: true }).click(); assert.equal(await notes().inputValue(), note + " forward"); checks.push("前进导航也保留未保存内容");
  await page.getByRole("link", { name: "返回列表", exact: true }).click(); await dialog.getByRole("button", { name: "放弃修改并离开", exact: true }).click(); await page.waitForURL("**/documents"); assert(!(await readDrafts()).some(r => r.scope === scope)); checks.push("明确放弃才清理，保存值不被覆盖");
  // Server changed since the local snapshot: preserve a visible conflict copy.
  await openDocument(id); await notes().fill(note + " conflict"); await waitDraft(scope);
  const current = (await get("/api/documents/" + id)).document;
  const concurrentSave = await page.request.patch(base + "/api/documents/" + id, { data: { ...current, notes: note + " server" } });
  assert.equal(concurrentSave.status(), 200, await concurrentSave.text());
  await page.reload({ waitUntil: "networkidle" }); await page.getByText("恢复副本与服务器版本或权限不一致", { exact: true }).waitFor();
  await page.getByText("查看原输入", { exact: true }).click(); assert((await page.locator(".recovery-content").innerText()).includes(note + " conflict")); assert.equal(await notes().inputValue(), note + " server");
  await page.getByRole("button", { name: "放弃恢复副本", exact: true }).click(); checks.push("服务器版本变化显示冲突原文，不覆盖新数据");
  await page.goto(base + "/dashboard", { waitUntil: "networkidle" }); await page.getByRole("link", { name: "录入送货单", exact: true }).click(); await page.waitForURL("**/upload*"); await page.locator("input[type=file]").first().waitFor({ state: "attached" });
  const sample = await sharp(await fs.readFile("public/sample-delivery.svg")).png().toBuffer();
  await page.locator("input[type=file]").first().setInputFiles([{ name: "page1.png", mimeType: "image/png", buffer: sample }, { name: "page2.png", mimeType: "image/png", buffer: sample }]);
  await page.locator('input[type="date"]').fill("2026-10-20"); const project = await page.locator("select").first().inputValue(); await waitDraft("/upload");
  await back(); await dialog.getByRole("button", { name: "暂存并离开", exact: true }).click(); await page.waitForURL("**/dashboard");
  await page.getByRole("link", { name: "录入送货单", exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll(".upload-thumb").length === 2);
  assert.equal(await page.locator('input[type="date"]').inputValue(), "2026-10-20"); assert.equal(await page.locator("select").first().inputValue(), project);
  await page.reload({ waitUntil: "networkidle" }); await page.waitForFunction(() => document.querySelectorAll(".upload-thumb").length === 2); assert.equal(await page.locator('input[type="date"]').inputValue(), "2026-10-20");
  const upload = (await readDrafts()).find(r => r.scope === "/upload"); assert.deepEqual(upload.value.images.map(i => i.name), ["page1.png", "page2.png"]); assert.equal(upload.value.images[0].size, sample.length); checks.push("手机录入后退与刷新恢复两页原始File、顺序、项目和日期");
  assert.equal(Buffer.from(upload.value.images[0].sha256).toString("hex"), createHash("sha256").update(sample).digest("hex")); assert.equal(upload.value.images[0].type, "image/png");
  await page.waitForFunction(() => Array.from(document.querySelectorAll(".upload-thumb img")).every(image => image.complete && image.naturalWidth > 0)); checks.push("恢复原图 SHA-256 字节一致，缩略图正常显示");
  const second = await ctx.newPage(); await second.goto(base + "/upload", { waitUntil: "networkidle" }); await second.getByRole("button", { name: "上传并识别 0 页", exact: true }).waitFor(); assert.equal(await second.locator(".upload-thumb").count(), 0); await second.close(); checks.push("独立标签页不混入本页的未上传文件");
  await page.route("**/api/uploads/presign", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "模拟上传失败" }) }));
  await page.getByRole("button", { name: "上传并识别 2 页", exact: true }).click(); await page.getByText("模拟上传失败", { exact: true }).waitFor(); assert.equal(await page.locator(".upload-thumb").count(), 2); assert((await readDrafts()).some(r => r.scope === "/upload")); await page.unroute("**/api/uploads/presign"); checks.push("上传失败保留两张图片及恢复副本");
  // Account-scoped data must never rehydrate for a different authenticated user.
  await page.request.post(base + "/api/auth/login", { data: { employeeNo: "site_sh", password: "site123" } });
  await localCookies();
  await page.reload({ waitUntil: "networkidle" }); assert.equal(await page.locator(".upload-thumb").count(), 0); checks.push("切换账号不恢复其他账号的图片");
  await login(); await page.reload({ waitUntil: "networkidle" }); await page.waitForFunction(() => document.querySelectorAll(".upload-thumb").length === 2);
  await page.getByRole("button", { name: "账号菜单", exact: true }).click(); await page.getByRole("button", { name: /退出登录/ }).last().click(); await dialog.waitFor(); assert.equal(await dialog.getByRole("button", { name: "暂存并离开", exact: true }).count(), 0);
  await dialog.getByRole("button", { name: "放弃修改并离开", exact: true }).click(); await page.waitForURL("**/login"); assert.equal((await readDrafts()).filter(r => r.owner === owner).length, 0); checks.push("退出前明确提醒，确认放弃后清理当前账号副本");
  // A successful upload while Back is pending must close the old leave dialog,
  // clear its recovery record and never recreate the same document on return.
  await login(); await page.goto(base + "/dashboard", { waitUntil: "networkidle" }); await page.getByRole("link", { name: "录入送货单", exact: true }).click(); await page.waitForURL("**/upload*");
  await page.locator("input[type=file]").first().setInputFiles({ name: "complete.png", mimeType: "image/png", buffer: sample });
  let releaseUpload, reachedUpload;
  const uploadGate = new Promise(resolve => { releaseUpload = resolve; }), uploadReached = new Promise(resolve => { reachedUpload = resolve; });
  await page.route("**/api/documents", async route => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch(); reachedUpload(); await uploadGate; await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "上传并识别 1 页", exact: true }).click(); await uploadReached; await back();
  assert(await dialog.getByRole("button", { name: "暂存并离开", exact: true }).isDisabled()); releaseUpload();
  await page.waitForURL(/\/documents\/[^/?]+$/); await dialog.waitFor({ state: "hidden" }); assert(!(await readDrafts()).some(r => r.scope === "/upload"));
  await page.evaluate(() => history.back()); await page.waitForURL("**/dashboard");
  await page.getByRole("link", { name: "录入送货单", exact: true }).click(); await page.waitForURL("**/upload*");
  await page.getByRole("button", { name: "上传并识别 0 页", exact: true }).waitFor(); assert.equal(await page.locator(".upload-thumb").count(), 0); checks.push("上传成功替换录入页，后退回工作台，再次录入无旧图片或恢复副本");
  await page.unroute("**/api/documents");
  // Expired records are not offered as a recovery option.
  await page.locator('input[type="date"]').fill("2026-10-01"); await waitDraft("/upload");
  await page.evaluate(() => new Promise(resolve => {
    const req = indexedDB.open("delivery-edit-recovery-v1"); req.onsuccess = () => {
      const db = req.result, tx = db.transaction("drafts", "readwrite"), store = tx.objectStore("drafts"), cursor = store.openCursor();
      cursor.onsuccess = () => { const row = cursor.result; if (row) { row.update({ ...row.value, expiresAt: Date.now() - 1 }); row.continue(); } };
      tx.oncomplete = () => { db.close(); resolve(); };
    };
  }));
  await page.reload({ waitUntil: "networkidle" }); await page.getByRole("button", { name: "上传并识别 0 页", exact: true }).waitFor(); assert.notEqual(await page.locator('input[type="date"]').inputValue(), "2026-10-01"); assert.equal((await readDrafts()).length, 0); checks.push("过期副本不恢复且在下次页面访问清理");
  assert.deepEqual(errors, []);
  await fs.mkdir(".tmp/b06-results", { recursive: true }); await fs.writeFile(`.tmp/b06-results/${engine}.json`, JSON.stringify({ status: "PASS", engine, browserVersion: browser.version(), checkedAt: new Date().toISOString(), viewport: "390x844, touch/mobile emulation", checks, pageErrors: errors, paidOcrCalls: 0 }, null, 2)); console.log(JSON.stringify({ status: "PASS", engine, checks }));
} catch (error) { console.error(error); console.error(page.url()); console.error((await page.locator("body").innerText()).slice(-2000)); process.exitCode = 1; }
finally { await browser.close(); }

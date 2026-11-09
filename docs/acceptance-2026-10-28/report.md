# 项目稳定性测试与修复报告

日期：2026-10-28（Asia/Shanghai）。项目：餐饮原材料送货单识别与多项目比价系统。

后续更新：用户已确认“同供应商、同单号跨日期，只提醒重复，可以提交和审核”，现已实现。新增 9 项专项测试，全部 59 项自动化测试、类型检查、生产构建通过。原报告和 JSON 保留此前验收时的记录；B07 待确认项已关闭。详见 [重复单号规则确认与回归.md](重复单号规则确认与回归.md)。

本地回归通过。已修复本轮复现的技术缺陷，保留现有业务状态机和低置信度提交方式。另有 1 项重复单号的业务规则需要确认，尚未改动。真实云服务和正式部署仍需联调，本报告不等同于生产环境或真实手写识别准确率验收。

## 测试结果

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| 自动化测试 | 50 / 50 通过，原有 16 项，新增 34 项 | [unit-results.json](unit-results.json)、[unit.log](unit.log) |
| 主 HTTP 验收 | 43 组通过，1 组待业务决定，0 组技术失败；385 次请求 | [api-results.json](api-results.json) |
| 新发现问题的 HTTP 回归 | 6 / 6 通过 | [supplementary-api-results.json](supplementary-api-results.json) |
| 会话、重新识别、主数据新建与合并 | 4 / 4 通过 | [remaining-results.json](remaining-results.json) |
| Excel、金额及跨供应商价格矩阵核对 | 3 / 3 通过 | [reconciliation-results.json](reconciliation-results.json) |
| 服务重启后持久化 | 通过：23 张单据及详情、审计、审批、主数据、仪表盘一致，40 个上传文件的 SHA-256 一致 | [persistence-results.json](persistence-results.json) |
| 桌面与手机浏览器 | 19 / 19 通过；1440×1000、390×844；无未捕获页面异常或 5xx | [ui-results.json](ui-results.json)、同目录截图 |
| 原有上传→OCR→候选匹配冒烟脚本 | 通过，草稿两行，错字匹配到青菜、土豆 | [smoke-results.json](smoke-results.json) |
| 生产构建 | 通过：Next.js 16.4.2，默认 Turbopack | [build.log](build.log) |
| TypeScript | 通过 | [typecheck.log](typecheck.log) |
| Prisma 模型检查 | `prisma validate` 通过 | `prisma/schema.prisma`，本次未修改数据库结构 |

性能采样：本机嵌入式数据库，100 次混合只读请求、并发 10，失败 0；P50 59.99ms，P95 113.05ms，最大 128.90ms。单据数量前后均为 21。该结果是本机短时采样，不代表生产吞吐量或长期运行保证。[performance.json](performance.json)

浏览器覆盖登录、经营总览、单据中心、单据详情、上传、审核中心、价格分析、合同主数据；验证手机实际选择图片、上传、识别轮询、保存，以及财务只读和导航权限。

## 已修复问题

| 问题 | 修复后的行为 | 主要位置 |
| --- | --- | --- |
| 并发通过和退回都能成功，产生两个审核结论 | 在同一事务内按版本和状态抢占单据，只有一个请求生效，另一请求返回冲突 | `src/server/document-lock.ts`、`document-service.ts` |
| 并发提交生成重复审计和通知 | 状态修改和提交审计原子执行，重复请求不再重复提交 | `src/server/document-service.ts` |
| 同版本同时保存可能抛 Prisma 错误并返回 500 | 删除明细前先抢占版本，冲突返回 409；保留成功请求的明细 | `src/server/document-service.ts` |
| 保存、检查结果更新和审核之间存在时间窗口 | 明细及检查在同一事务内更新，审核前重新计算检查，金额异常继续阻止普通通过 | `src/server/checks.ts`、`document-service.ts` |
| 延迟重比对可能重新打开已通过单据的历史异常 | 已通过单据保留原检查及关闭状态 | `src/server/checks.ts` |
| 从单据新建主数据时，来源单据可能已被其他人审核 | 绑定主数据前校验来源版本和状态，冲突整笔回滚，并同步更新检查 | `src/server/master-commands.ts` |
| 过期 OCR 的成功或失败回调覆盖新保存或新审核 | 开始识别和写入结果都校验版本；旧任务不能覆盖新版本；识别期间禁止保存或绑定新主数据，避免任务失效后卡住 | `src/server/documents.ts`、`document-service.ts`、单据详情页面 |
| OCR 明确识别为 0 的总价被小计替代 | 保留 0，总价与明细不符时仍产生严重异常 | `src/server/ocr.ts`、`documents.ts` |
| 价格分析越权返回 500，非法日期悄悄退回默认区间 | 越权返回 403，非法日期及反向区间返回 400 | `src/server/analytics.ts` |
| 多字节上传签名使定时安全比较抛异常 | 先检查字节长度，无效签名返回 403 | `src/server/storage.ts` |
| 合同非法截止日期变成长期有效；Excel 接受无穷单价 | 创建和导入均校验截止日期，导入拒绝非有限或越界单价 | 合同 API、`src/server/excel.ts` |
| 引用其他项目已有图片建立本项目单据，可绕过图片权限 | 创建时检查图片既有关联项目，无权限引用返回 403 | `src/app/api/documents/route.ts` |
| 超大数量或金额使数据库溢出并返回 500 | 写入前校验数值、合计及行计算范围，返回 400 且保留原数据 | 单据 API、`document-service.ts`、合同 API |
| 错误密码或绑定失败被误判为会话过期 | 认证表单显示真实错误；业务请求会话过期仍返回登录页 | `src/lib/client/api.ts` |
| 视觉检查依赖未声明，干净安装可能无法运行 | 声明并锁定 `playwright-core` 开发依赖；排除临时测试目录；更新测试命令说明 | `package.json`、`package-lock.json`、`tsconfig.json`、`.gitignore`、`README.md` |

并发缺陷使用同步屏障强制两个请求都完成预读后再写入，覆盖偶发竞争情形；OCR 使用延迟成功与延迟失败两种故障注入。云识别故障测试使用模拟通道，没有调用收费云 API。问题修复前的 HTTP 和浏览器结果保存在 `*-baseline-results.json`，源码修改可查看 [source-changes.patch](source-changes.patch)。

## 业务流程与待确认事项

1. **已按用户决定保持：** OCR 置信度低于 90% 时提示人工复核，允许提交主管审核；本轮没有增加人工确认字段或提交门槛。严重金额、合同价或重复图片异常仍按现有规则阻止普通通过，保留填原因强制通过的方式。
2. **待确认，尚未修改：** 同供应商、同单号跨日期是否也应提醒重复？当前代码按日期检测；已有架构说明写的是“同供应商同号”，两者范围不完全一致。本轮保持现状，测试 B07 标记为 `PENDING_DECISION`。如果供应商每天复用编号，扩大范围会增加提醒，需由业务决定；此处不建议擅自升级为阻断。

## 环境、数据与范围

- Windows、Node.js 24.21.0、Next.js 16.4.2、PGlite、本地文件、Mock OCR；测试服务使用 `127.0.0.1:3107`。
- HTTP 和浏览器测试数据位于 `.tmp/acceptance-2026-10-28/.data`；自动化测试使用测试数据库。恢复测试的存储边界已隔离，早期运行生成的 48 个测试图片已归档到 `.tmp/earlier-ocr-test-fixtures-2026-10-28`。
- 未清空或重置现有开发业务数据库 `.data/pglite/dev`。源码修改前备份位于 `.tmp/before-stability-fixes-2026-10-28`。测试服务在交付前关闭。
- 已读取项目 `AGENTS.md` 及本机 Next.js 随包文档；未新增业务审批、权限角色或数据库迁移。
- 尚未验证真实阿里云 OCR / Qwen-VL 的字段准确率、微信授权与模板消息、OSS、真实 PostgreSQL / Redis 队列、多实例部署、云端恢复和长期压力。需真实配置及脱敏单据再完成生产验收。
- 当前目录未提供 Git 仓库，本轮没有创建提交、推送或部署。

## 复测

`npm test`、`npm run typecheck`、`npm run build` 可直接复跑。HTTP 全量脚本需要一套全新的隔离演示数据库；不得对业务库运行，它会新增并修改测试单据、员工和主数据。`start-server.mjs` 仅供本次已有隔离目录使用；API 验收脚本不是幂等脚本。

完整文件及校验摘要见 [summary.json](summary.json)、[source-manifest.json](source-manifest.json)。

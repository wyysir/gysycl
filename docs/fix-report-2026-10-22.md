# 会议结论落实与修复报告（第 2 版）

| 项目 | 内容 |
| --- | --- |
| 报告日期 | 2026-10-22，Asia/Shanghai |
| 本版变更 | 补充 2026-10-22 业务确认后的增量修复：重复单提醒级别、撤回审核、合并口径、详情页日期、手机端退出菜单 |
| 依据 | [测试验收报告](acceptance-report-2026-10-22.md)（第 1 节会议结论、第 4 节 13 项缺陷台账与 4 项建议） |
| 技术基线 | [验收清单](acceptance.md)、[架构与接口说明](architecture.md)、[缺陷台账](acceptance-2026-10-22/issues.json) |
| 修复范围 | 11 项缺陷闭环；DEF-06 待迁移实现；DEF-07 查重范围待样例、提醒级别已按确认调整；SUG-01~03 完成，SUG-04 已按产品确认实现退出菜单；F3 合并口径及其边界（停用引用、导入/查重过滤、别名迁移、事务一致性）已收口 |
| 验证方式 | 静态代码审查 + 独立只读复审（2 轮，另待对增量改动复审）。本机 `pwsh` 不可用（exit code 0xC0000142），未执行 tsc/vitest/build/worker |

## 0. 业务确认记录（2026-10-22）

| 议题 | 决定 |
| --- | --- |
| DEF-06 确认粒度 | 整单确认一次（所有低置信内容一次确认后才能提交） |
| DEF-06 确认人 | 只有录单的采购可确认；财务只读，主管可通过退回复核 |
| DEF-06 确认失效 | 任一低置信行字段被改动即失效，需重新确认 |
| DEF-06 阈值 | 沿用 `<90%` 才需确认；正好 90% 视为达标 |
| DEF-07 重复级别 | 同供应商同号重复只提醒（WARNING），不阻止普通通过 |
| DEF-07 空单号 | 空单号不参与同号查重 |
| DEF-07 查重范围 | 跨天/跨项目范围待供应商真实单号样例后再定，本轮继续挂起 |
| 更正机制 | 撤回审核：主管/管理员填写原因，已通过单据退回待审核，修改后重新审核并留痕 |
| 主数据合并（F3） | 历史已通过单据保留原样；只合并主数据本身与未审单据；源记录停用不删除 |
| 详情页日期（F9） | 本轮修复（选 10-19 必须存 10-19） |
| SUG-04 手机端 | 手机端不承担主数据维护（不加入口）；退出登录放右上角头像/名字菜单 |
| 额外技术项 | F2/F4/F6/F7 全部先记入问题台账，下轮统一处理 |

## 1. 读取范围与判定依据

会议结论只存在于 [验收报告](acceptance-report-2026-10-22.md)（第 1 节“会议结论与关键风险”、第 4 节问题清单与建议项、第 5 节流程），并引用 `docs/acceptance-2026-10-22/` 的实测证据与 `issues.json`/`issues.csv` 台账。范围判定：

1. 以第 4 节 **13 项缺陷（DEF-01~13）** 与 **4 项建议（SUG-01~04）** 为会议结论全集；第 2.3 节待补验项（真实 OCR、微信实号、RDS/Redis/OSS、Docker、盲测等）属 G3 现场补验，不是代码差异。
2. 依据 `issues.json` 的 `source` 字段定位模块/函数：权限（`auth.ts`、`document-service.ts`、`master-commands.ts`）、规则（`domain/checks.ts`、`server/checks.ts`）、导出与 Excel（`server/excel.ts`）、上传（`server/documents.ts`、`storage.ts`）、日期（`lib/text.ts`）、配置（`lib/config.ts`、`docker-compose.yml`）、接口契约（`app/api/contracts/route.ts`）。
3. 以 [验收清单](acceptance.md) 与 [架构说明](architecture.md) 作为“应当如何”的判定依据。
4. 排除：`.data/pglite/**`（运行数据）、`docs/acceptance-2026-10-22/*.json/log/png`（验收证据）、`src/generated/prisma/**`（生成产物）。

## 2. 差异清单（会议结论 vs 修复前实现）

| 编号 | 差异描述 | 涉及文件/函数/配置项 | 判断依据 |
| --- | --- | --- | --- |
| DEF-01 | 导出 `?projectId=` 覆盖权限范围，采购可导出其他项目 | `server/excel.ts` `buildDocumentsWorkbook` | S01：200 + 跨项目 2 条 |
| DEF-02 | 非零明细配 0 元总价可普通通过 | `domain/checks.ts` 总价勾稽 | B06；验收清单第 3 节 |
| DEF-03 | 以 `sourceDocumentId` 指向已通过单据绕过审批替换供应商 | `server/master-commands.ts` 来源回写 | M02；架构“已通过不可编辑” |
| DEF-04 | 财务可提交草稿 | `document-service.ts` `submitDocument` | S02；验收清单第 4 节 |
| DEF-05 | ADMIN 可原地 PATCH 已通过单据 | `auth.ts` `canEditDocument` | S03；架构第 36 行 |
| DEF-06 | 低置信未经人工确认即可提交 | `submitDocument`、详情页、无确认字段 | B05；验收清单第 1 节 |
| DEF-07 | 同供应商同号跨日期不报重复；重复级别为严重异常 | `server/checks.ts` `findDuplicateDocument` | B07；验收清单第 40 行 |
| DEF-08 | Excel 合同引用同名多规格时取错材料 | `server/excel.ts` 合同写入 | M08 |
| DEF-09 | 图片对象不存在返回 500 且可能留下半成品 | `server/documents.ts` `createDocument` | U03 |
| DEF-10 | 非法日期被静默归一化 | `lib/text.ts` `parseDateOnly` | B02 |
| DEF-11 | 非法 status 筛选/导出返回 500 | `document-service.ts`、`excel.ts` | B03 |
| DEF-12 | 架构声明 GET/POST 合同接口，实际 GET 405 | `app/api/contracts/route.ts` | M07；架构第 66 行 |
| DEF-13 | confidence=0 不产生低置信告警 | `domain/checks.ts` | D05 |
| SUG-01 | 生产缺少 SESSION_SECRET 防误配检查 | `lib/config.ts`、`lib/bootstrap.ts` | 报告建议项 |
| SUG-02 | Compose 固定 `STORAGE_DRIVER=local`、缺 OSS/OCR 参数 | `docker-compose.yml` | 报告建议项 |
| SUG-03 | README 测试数过期 | `README.md` | 报告第 1 节 |
| SUG-04 | 移动端无退出入口、主数据入口被隐藏 | `components/AppShell.tsx`、`globals.css` | 报告 SUG-04 |
| F9 | 详情页日期少一天（UTC 截断） | `documents/[id]/page.tsx` 日期 onChange | 复审额外发现（会议未列） |

## 3. 修复明细

| 编号 | 修复内容 | 文件:行 |
| --- | --- | --- |
| DEF-01 | 导出统一取 `allowedProjectIds`，越权 403，与授权集合取交集 | `src/server/excel.ts:476-504` |
| DEF-02 | 有明细即比较小计/总价，0 值不再豁免 | `src/domain/checks.ts:294-325` |
| DEF-03 | 来源单据改用 `canEditDocument`（APPROVED→403）；回写递增 version | `src/server/master-commands.ts:5-27` |
| DEF-04 | 提交前增加 `canEditDocument`（财务/越权 403，先于写操作） | `src/server/document-service.ts:340-367` |
| DEF-05 | APPROVED→false 提前到 ADMIN 判断之前 | `src/server/auth.ts:236-252` |
| DEF-06 | 确认口径已定，实现待数据库迁移（见第 4 节） | `prisma/schema.prisma`、`document-service.ts` |
| DEF-07 | 同号重复级别按业务确认改为 `WARNING`（只提醒，不阻止普通通过）；查重范围待样例；主数据重复检查/Excel 导入/合同创建均过滤 `active:true`，避免回落到停用记录 | `src/server/checks.ts:130-140`；`master-commands.ts:56-74,156-174`；`excel.ts:204-216,298-352,395-413`；`app/api/contracts/route.ts:74-82` |
| F3 边界 | 合并后停用引用不再阻断“撤回→修改”保存（原有供应商/材料允许保留）；源名称与全部别名迁移到目标；事务内二次确认可写单据；重算逐单容错；源记录停用不删除 | `document-service.ts:215-247`；`master-commands.ts:274-443` |
| DEF-08 | 材料引用改“名称+规格+单位”解析；dryRun 同校验；写入用真实材料/spec | `src/server/excel.ts:49-95, 141-290, 387-447` |
| DEF-09 | 缺失/读取失败→ApiError(400)；先读全部图再建单 | `src/server/documents.ts:24-78` |
| DEF-10 | 日期回比校验，非法年月日返回 null | `src/lib/text.ts:159-170` |
| DEF-11 | 列表与导出用生成枚举校验（400），日期/limit 校验 | `src/server/document-service.ts:51-70,93`；`excel.ts:487-498` |
| DEF-12 | 新增带权限 GET /api/contracts | `src/app/api/contracts/route.ts:22-62` |
| DEF-13 | 0/缺失置信度按低于阈值告警 | `src/domain/checks.ts:141-152` |
| 更正流程 | 新增撤回审核：主管/管理员填原因→已通过退回待审核→修改→重新审核；写审计日志并通知录单人；财务显式 403；`updateMany` 状态 CAS 防并发双撤回 | `src/server/document-service.ts:524-591`；`app/api/documents/[id]/withdraw/route.ts`；详情页“撤回审核”弹窗 |
| 合并口径 | 合并时已通过单据引用/金额不变；只改未审单据与合同价引用；源主数据停用（不删除）；受影响未审单据升版本并重算异常；别名整体迁移；重算逐单容错 | `src/server/master-commands.ts:248-444` |
| F9 | 详情页日期直接保存 `YYYY-MM-DD`，消除 UTC 截断少一天 | `documents/[id]/page.tsx` 日期 onChange |
| SUG-01 | 生产防误配校验（仅 production 且 DEMO_MODE=false；占位密钥也拒绝） | `src/lib/config.ts:67-94`、`src/lib/bootstrap.ts:12-24` |
| SUG-02 | Compose 透传 STORAGE_DRIVER/OSS/OCR/阈值参数 | `docker-compose.yml` |
| SUG-03 | README 测试数校正（新增 3 个回归测试后为 16） | `README.md` |
| SUG-04 | 手机端右上角头像菜单（含退出登录）；手机端不加主数据入口（产品确认） | `src/components/AppShell.tsx`、`src/app/globals.css` |
| 补充加固 | OCR 状态守卫，非可编辑状态 409 | `src/server/documents.ts:79-90`；`app/api/documents/[id]/ocr/route.ts:30-35` |
| 回归测试 | 新增非法日期、0 总价、0 置信度 3 个用例 | `tests/domain.test.ts:38-49,182-239` |
| F1 收口 | 主数据接口返回 `documentVersion`，前端同步版本 | `src/server/master-commands.ts:120,236-242`；`documents/[id]/page.tsx:275-340` |
| F5 收口 | ApiError 拆到无框架依赖模块，Worker 不再加载 Next 模块 | `src/server/errors.ts`、`auth.ts:7-9`、`documents.ts:3` |
| 文档同步 | 架构状态机与接口表补充“撤回审核” | `docs/architecture.md`；`README.md` |

## 4. 未处理项、冲突点与待确认清单

| 项 | 类型 | 原因/待确认问题 | 处理建议 |
| --- | --- | --- | --- |
| DEF-06 实现 | 待迁移（口径已定） | 整单确认需要“确认人+确认时间+确认时低置信内容指纹”字段，属数据库结构变更，需新增迁移并执行 `prisma generate`；本环境无 shell，手改生成客户端不安全 | 提供可执行环境：加 schema 字段 → 生成迁移 → `prisma generate` → submit 校验 + 详情页确认按钮 → B05 复测 |
| DEF-07 查重范围 | 待业务样例 | 跨天/跨项目是否算重复取决于供应商单号规则；业务承诺提供真实单号样例后再定 | 样例齐后确定“全历史/最近 N 天/仅同日”与“是否跨项目”，再改 `findDuplicateDocument` |
| DEF-07 级联影响 | 已决策 | 重复单降为提醒后，主管不填原因也能通过；防重复结算主要依赖提醒与人工复核 | 写入复测点，G2 验证提醒可见性 |
| F3 统计口径（已知影响） | 已决策（业务知悉） | 合并后历史已审单据保留源引用，统计/价格矩阵按供应商名称或材料 ID 分组时，同一供应商/材料可能分成“历史源”和“目标”两行，历史基准样本不再参与新单据中位价 | 业务确认接受（历史不动）；后续可评估按规范化名称聚合，或在上线说明中标注 |
| 额外技术项 F2/F4/F6/F7 | 台账（已确认下轮） | Excel 预校验不完整、并发提交/审核无 CAS、OCR 重识别把退回补充变草稿、价格分析错误码/日期 | 下轮统一处理并补测试 |
| 会议 2.3 待补验 | 现场验证 | 真实 OCR 盲测、微信实号、RDS/Redis/OSS、Docker/HTTPS、监控备份 | 在预发布环境按 G3 执行 |
| 旧库数据兼容 | 变更说明 | 升级前已落库的 `duplicate_document` ERROR 行不会自动降为 WARNING；需 recheck 或新库才按新级别展示 | 在发布说明中注明，G2 用干净库验证或逐单 recheck |

## 5. 验证情况与限制

- 本轮累计改动文件：`src/server/errors.ts`（新增）、`auth.ts`、`documents.ts`、`document-service.ts`、`master-commands.ts`、`checks.ts`、`excel.ts`、`src/domain/checks.ts`、`src/lib/text.ts`、`src/lib/config.ts`、`src/lib/bootstrap.ts`、`src/app/api/contracts/route.ts`、`src/app/api/documents/[id]/ocr/route.ts`、`src/app/api/documents/[id]/withdraw/route.ts`（新增）、`src/app/api/reviews/route.ts`、`src/app/(workspace)/documents/[id]/page.tsx`、`src/app/(workspace)/master/page.tsx`、`src/components/AppShell.tsx`、`src/app/globals.css`、`docker-compose.yml`、`README.md`、`docs/architecture.md`、`tests/domain.test.ts`。
- 独立只读复审 3 轮：第 1 轮确认 11/13 闭环并指出 F1（版本同步）、F5（Worker 依赖）；两项已修复并确认闭环。第 3 轮复审增量修复（DEF-07 级别、F9、F3 合并、撤回审核、SUG-04），其 M1/M2/M4/M5/M6/M7/M8/M9/M10/M11 已收口（停用引用保存放行、active 过滤、事务内二次确认+UPDATE 状态条件、重算容错、别名迁移、文档/文案、财务 403、状态 CAS、菜单路由关闭、FINANCE 误配导航与审核入口排除）；M12 采用“路由切换关闭菜单”（外部点击关闭列为可选优化），M3 统计口径作为已知影响记录，M13 升级兼容写入发布说明。
- **未执行**：`npm run typecheck`、`npm test`、`npm run build`、`npm run worker`。原因：本机 `pwsh` 全部命令返回 `[exit code: 3221225794]`（0xC0000142），无可用 shell；未改 schema/迁移/依赖。
- 需在可执行环境补跑：`npm run typecheck` → `npm test`（预期 16/16）→ `npm run build` → `npm run worker` + 一次 OCR 队列任务；再按 `api-acceptance.mjs` 复测：S01/S02/S03 403、B02/B03 400、B06 422、M02 403、M07 200、M08/A08/D05 通过；**B05（DEF-06）与 B07（DEF-07 跨日部分）预期仍失败，属未闭环项而非回归**。
- 新增行为需同步契约记录：`GET /api/contracts` 200、`POST /api/documents/:id/withdraw`、导出非法 status/日期 400、OCR 非可编辑状态 409、Excel 同名多规格未填规格整批拒绝。
- 新增 UI（撤回审核弹窗、手机端头像菜单）未做浏览器实测，需在 G2 做 390px 视口冒烟。
- 本轮新增功能（撤回审核、合并边界、DEF-07 级别、F9 日期修复）暂无自动化用例，测试仍为 16 个；G2 建议补“合并→撤回→修改→重新审核”“合并后新建/导入同名主数据”“10-19 日期往返”三组回归。

# 系统设计与接口说明

## 运行组件

```text
微信服务号 H5
   │
   ▼
Next.js Web / API ───── PostgreSQL（业务数据、审计、规则结果）
   │        │
   │        └────────── Redis + BullMQ（OCR 任务）
   │                         │
   │                         ▼
   └── 私有 OSS / 本地存储    OCR Worker
                              └─ 百炼 Qwen3.6-Flash（每图单次请求）
```

Web 和 Worker 使用同一套 TypeScript 服务代码。生产环境使用 PostgreSQL；本地不配置数据库时使用 PGlite 嵌入式 PostgreSQL。

2026-10-31：传统OCR及固定二次校读已移除，新队列任务 `attempts=1`；主动重试重新计费，多页任一页失败不保存部分识别结果。当前约束见[单次识别维护](ocr-single-2026-10-31/使用与维护.md)。单号由系统生成，不从原图提取；模板通知已取消，微信实号接入仍待备案与验收。

## 单据状态机

```text
PROCESSING（识别中）
    │ OCR 完成/失败转人工
    ▼
DRAFT（草稿） ──提交──▶ PENDING_REVIEW（待主管审核）
    ▲                         │
    │                         ├─通过──▶ APPROVED（已通过）
    └────修改后重提────────────┤
                              └─退回──▶ NEEDS_REVISION（退回补充）
```

- 项目采购只能在草稿、退回补充状态修改。
- 项目主管在待审核状态可直接修改并留痕。
- 已通过单据不可编辑。
- 已通过单据可由项目主管/管理员填写原因撤回审核，回到待审核状态修改后重新审核，撤回操作写入审计日志。
- 金额勾稽、重复图片、合同价超标阻止普通通过；同供应商同号重复（包括跨日期、跨项目）只提醒，不阻止提交或普通审核通过；主管填写原因后可强制通过严重异常。

## 核心接口

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| POST | `/api/auth/login` | 员工号密码登录 |
| GET | `/api/auth/wechat/start` | 发起微信网页授权 |
| GET | `/api/auth/wechat/callback` | 微信 openid 回调与自动登录 |
| POST | `/api/auth/wechat/bind` | 首次微信绑定员工号 |
| GET | `/api/bootstrap` | 初始化用户、项目、主数据和系统配置 |
| GET | `/api/dashboard` | 仪表盘指标、趋势、风险和最近单据 |
| GET/POST | `/api/documents` | 查询单据 / 创建多页单据并加入 OCR 队列 |
| GET/PATCH | `/api/documents/:id` | 获取详情 / 校正保存（带版本号） |
| POST | `/api/documents/:id/submit` | 提交主管审核 |
| POST | `/api/documents/:id/review` | 通过、退回或强制通过 |
| POST | `/api/documents/:id/withdraw` | 主管/管理员填写原因撤回已通过单据 |
| POST | `/api/documents/:id/recheck` | 重新执行比对规则 |
| POST | `/api/documents/:id/ocr` | 重新识别 |
| POST | `/api/uploads/presign` | 获取图片直传地址 |
| GET | `/api/files?key=` | 权限校验后读取私有原图 |
| GET | `/api/master-data/suggest` | 供应商/品名前 3 候选 |
| POST | `/api/master-data/suppliers` | 确认后新建供应商 |
| POST | `/api/master-data/ingredients` | 确认后新建原材料 |
| GET | `/api/master-data/ingredients` | 按名称、别名、单位、分类、状态查询，每页 20 条 |
| GET/PATCH | `/api/master-data/ingredients/:id` | 材料详情、项目授权合同价格；管理员按版本编辑并留痕 |
| GET | `/api/master-data/ingredients/:id/history` | 仅有权限的已通过单据，按单位/日期等筛选，每页 20 条 |
| POST | `/api/master-data/merge` | 管理员合并重复主数据 |
| GET | `/api/master-data/template` | 下载 Excel 模板 |
| POST | `/api/master-data/import` | 校验/导入主数据 |
| GET/POST | `/api/users` | 管理员查询/创建员工 |
| PATCH | `/api/users/:id` | 启停员工或重置密码 |
| POST | `/api/projects` | 管理员新增项目点 |
| GET/POST | `/api/contracts` | 查询/新增项目合同价 |
| DELETE | `/api/contracts/:id` | 删除合同价 |
| GET | `/api/analytics` | 跨项目价格矩阵、供应商和异常分析 |
| GET | `/api/export/documents` | 导出 Excel |
| GET | `/api/health` | 健康检查 |

所有写接口校验 `Origin`；所有业务接口校验登录与项目点权限。

2026-11-02起，`CustomRole`保存管理员配置的权限，`ProjectMembership.customRoleId`关联项目自定义角色；空值继续采用内置员工/主管权限。请求从数据库读取当前角色与启停状态，`src/lib/permissions.ts`统一计算具体操作和项目范围，界面与服务端分别校验。自定义角色不继承兼容字段中的内置权限。系统管理员保留系统管理权，财务固定只读。角色管理接口为管理员专用`GET/POST /api/roles`与带版本校验的`PATCH /api/roles/:id`；员工接口支持修改项目角色。配置范围和旧应用回退限制见[维护说明](performance-roles-2026-11-02/使用与维护.md)。

`GET /api/bootstrap?scope=context`只返回用户、项目和系统上下文，供应商、材料、合同数组留空；完整主数据页面继续使用无参数接口。上传和查询页面使用精简接口，单据识别轮询复用已有上下文。

页面拆分：`/master` 保留合同和供应商工具；`/ingredients` 独立维护原材料；`/settings` 仅管理员访问，包含项目点、员工两个页签。手机底部“更多”提供入口。明细采用卡片，OCR置信度与匹配状态独立，已审核仍先撤回再修改。材料规格与单位现可编辑，保留版本和审计；跨单位合并禁止，历史金额不批量改写。见[材料维护说明](ingredient-edit-2026-10-30/使用与维护说明.md)。

## 关键类型

- `DocumentStatus`：`PROCESSING | DRAFT | PENDING_REVIEW | APPROVED | NEEDS_REVISION`
- `MatchStatus`：`MATCHED | SIMILAR | NEW | UNMATCHED`
- `CheckSeverity`：`ERROR | WARNING | INFO`
- `ProjectRole`：`SUBMITTER | SUPERVISOR`
- `GlobalRole`：`ADMIN | FINANCE | STAFF`

## 比对规则

- 识别字段（2026-10-29 用户确认）：数量保留独立数值，单位保留计量单位，规格自动按单位填写；例如“5斤”对应数量 5、单位“斤”、规格“斤”。数量、包装数量或整行算式不写入规格。
- 合同价键：项目点 + 供应商 + 原材料 + 规格 + 单位 + 生效区间。
- 跨供应商基准键：规范原材料 + 规格 + 单位，不包含供应商。
- 市场基准：近 30 天已通过单据中位价，样本少于 3 条标记“样本不足”。
- 历史基准：同项目、同供应商、同品同规格近 30 天均价。
- 重复校验：图片 SHA-256 或同供应商同号单据。单号重复不限制日期和项目，仅产生 WARNING 提醒，不要求强制通过；其他严重异常仍按原规则处理。
- OCR 复核阈值默认 0.90，可配置。

## 数据保留与备份

- 在线原图和结构化数据：5 年。
- RDS 每日自动备份：30 天。
- 月度加密快照：写入 OSS 归档，建议保留 5 年。
- OSS Bucket 必须私有，图片访问通过短时签名或受权限保护的接口。

## 项目经营与营业额审核（2026-11-02）

`GET /api/business?from=YYYY-MM-DD&to=YYYY-MM-DD&projectId=...`返回授权项目、卡片及当前项目经营数据；省略项目显示卡片入口，前端详情必须携带项目ID。`PATCH /api/business`保存项目/日期/金额/原因/版本，新建版本0，已有记录必须匹配版本；保存统一进入PENDING_REVIEW。`POST /api/business/review`提交id/version/action(approve或return)/note，退回须原因，按项目校验审核权限，状态变更与审计同事务。APPROVED营业额参与分析，NEEDS_REVISION退回后可修改重提；修改已通过记录同样重新待审。采购成本延续已通过＋待审核暂估口径。

0006只增加审核字段；旧营业额默认待审，既有字段和图片不改。旧镜像不能安全理解审核状态，禁止直接裸回退。演示升级与范围、验证、备份及回退限制见[本轮维护](audit-fixes-2026-11-02/使用与验证.md)。

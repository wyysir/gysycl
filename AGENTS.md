<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Git 与更新节点（用户于 2026-10-29 要求）

- 开始工作先检查 `git status`、最近提交和版本标签。不要覆盖其他会话或用户尚未提交的无关改动。
- 每次完成一项有意义且已授权的更新，运行适用检查，更新 `CHANGELOG.md` 和相关使用/维护说明，并创建 Git 提交；尚未验证的内容明确标记，不写成已上线。
- 每次上线建立独立、不可挪动的注释标签，命名 `release/YYYY-MM-DD-简短名称`；同日再次更新使用不同名称或递增后缀，不覆盖旧标签。
- 在 `docs/releases/` 保存该节点的功能、验证、数据库迁移、部署镜像、源包摘要、备份与回退依据；Git 标签指向实际提交，提交号用 Git 查询，避免自引用。
- 过去没有提交的上线只登记已有镜像/源包和实际记录，不伪造历史提交或倒填提交时间。界面回退与数据库恢复分别处理。
- 密钥、真实密码、私有配置、数据库/图片备份和业务原图不进入 Git。演示凭据及空白配置示例可保留。提交前检查暂存内容，不使用 `git add .` 盲目纳入产物。
- 没有远程仓库时如实说明“仅本地 Git”；不擅自创建或公开远程仓库，不推送至未经确认的地址。

## 回答与资料核验（用户于 2026-11-02 要求）

- 用户明确要求后续回答先查询最新资料，不凭旧印象给出操作步骤。外部产品、控制台菜单、配置与规则以回答时查阅的官方资料为依据，附可核对的来源；项目代码与服务器状态以当前只读核查为依据。
- 区分官方文档记载、实际界面观察和推断；未看到用户控制台时，不把菜单显示或权限原因写成已确认事实。资料无法核实时明确说明，不编造入口或更新时间。

## UI统一约定（用户于2026-11-03要求）

- 本项目后续UI使用“一级展示分类、列表和选择；二级弹窗完成具体输入、编辑与配置”。系统设置先展示分类入口，进入后查看列表，新增/编辑等具体操作在弹窗内完成。
- 保留用户选定的A版暖白棕色、B版校对明细弹出编辑；校对页优先显示更多明细，保持原图入口明显、连续修改方便。
- 新功能沿用上述风格；删除已废弃的选型原型与无引用样式，不用原型替换真实权限、保存、审核及草稿恢复逻辑。
- 删除员工账号采用保留历史归属的逻辑删除，禁止删除当前登录账号，禁止借界面清理删除真实单据或代用户操作实际员工账号。

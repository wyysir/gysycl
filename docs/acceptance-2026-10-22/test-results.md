# 逐项验收结果与证据索引

日期：2026-10-22；以下为测试项级记录，不能替代主报告的范围和交付结论。

## 主HTTP验收：44组

请求序号是api-results.json.requests的一基索引；预期的401/403/409/422不是服务故障。

| ID | 验收项 | 结果 | 实际表现 | 请求序号 | 问题 |
| --- | --- | --- | --- | --- | --- |
| A01 | 健康检查及首次建库 | 通过 | 200，数据库up；冷请求耗时见请求记录。 | 1–1 | — |
| A02 | 未登录业务读取接口返回401 | 通过 | 11个业务读取路径均401。 | 2–12 | — |
| A03 | 四种演示角色登录和12小时安全Cookie | 通过 | 4个角色200；Cookie HttpOnly/Secure/SameSite=lax/Max-Age=43200。 | 13–16 | — |
| A04 | 账号密码错误、非法JSON和跨源请求 | 通过 | 错误密码401、坏JSON400、外域Origin403。 | 17–19 | — |
| A05 | 项目采购列表和初始化数据按项目隔离 | 通过 | 初始化仅上海项目，列表仅上海；指定杭州列表及杭州详情403。 | 20–23 | — |
| A06 | 候选匹配返回前三及错字首选正确 | 通过 | 两类错字均返回3个候选；首选青菜/土豆。 | 24–25 | — |
| A07 | 仪表盘、分析、审核队列可读取 | 通过 | 总览、分析、管理员审核队列200；采购审核队列403、财务用户管理403；未来空区间200。 | 26–31 | — |
| A08 | Excel三工作表模板和财务导出 | 通过 | 模板和导出均3表；初始8张演示单据，汇总金额与列表一致。 | 32–34 | — |
| S01 | 导出指定其他项目必须拒绝且不泄漏数据 | 不通过 | expected 403, actual 200; unauthorized project rows=2; project=杭州园区食堂 | 35–35 | DEF-01 |
| U01 | 三种图片格式上传和无登录图片访问拒绝 | 通过 | 3种编码图片上传成功，匿名图片读取401。 | 36–42 | — |
| U02 | 上传格式、大小、令牌、文件内容校验 | 通过 | 非法格式、0大小、15MB+1声明400；15MB声明200；伪内容400、坏签名403、财务申请上传403。 | 43–50 | — |
| U03 | 0页和6页拒绝；不存在图片应返回业务错误 | 不通过 | expected 4xx, actual 500: {"error":"服务器内部错误"} | 51–53 | DEF-09 |
| U04 | 5页上传顺序、预处理、异步Mock及私有图片权限 | 通过 | 创建201；5页按1–5排序且COMPLETED；Mock2行、无ocrError；管理员私有图200、跨项目采购403。 | 54–68 | — |
| U05 | 越权创建和财务创建均拒绝 | 通过 | 采购越项目和财务创建均403。 | 69–72 | — |
| F01 | 采购草稿校正保存与过期版本409 | 通过 | 保存200；重复旧version保存409，42元金额保持。 | 73–79 | — |
| F02 | 财务保存、审核、重比对和重识别拒绝 | 通过 | 财务PATCH、review、recheck、ocr均403。 | 80–84 | — |
| F03 | 提交、主管修改、退回、重提和普通通过闭环 | 通过 | 提交、主管保存、退回补充、采购补充、重提、普通通过均按状态完成；缺退回原因400、采购改待审和已审403。 | 85–99 | — |
| F04 | 严重异常阻止普通通过且强制通过必须原因 | 通过 | 严重异常普通通过422；无原因强制通过400；有原因200并记录OVERRIDE_APPROVE。 | 100–109 | — |
| S02 | 财务只读：不得提交已有草稿 | 不通过 | {"method":"POST","path":"/api/documents/cmvj4dtmk004e3o85otaoc05g/submit","role":"finance","status":200,"ms":20.81}<br><br>200 !== 403<br> | 110–115 | DEF-04 |
| S03 | 已通过单据管理员也不得原地修改 | 不通过 | expected 403/409, actual 200, version 9 -> 10 | 116–118 | DEF-05 |
| B01 | 非法数量、空明细、无供应商和200行上限 | 通过 | 负数量及201行400；可保存空草稿，未填供应商/明细提交422。 | 119–128 | — |
| B02 | 不存在的日期必须拒绝 | 不通过 | actual 200; saved date=2026-03-02<br><br>200 !== 400<br> | 129–130 | DEF-10 |
| B03 | 非法状态筛选必须返回4xx | 不通过 | actual 500: {"error":"服务器内部错误"} | 131–131 | DEF-11 |
| B04 | 同版本并发保存返回一个200和一个409 | 通过 | 同版本2并发得到200、409。 | 132–138 | — |
| B05 | 低置信度未经人工确认不得直接提交 | 不通过 | expected confirmation rejection, actual 200: {"id":"cmvj4du4p005t3o85itif2kel","status":"PENDING_REVIEW"} | 139–144 | DEF-06 |
| B06 | 非零明细与0总价不一致应阻止普通通过 | 不通过 | actual 200; subtotal=42, total=0, checks=<br><br>200 !== 422<br> | 145–153 | DEF-02 |
| B07 | 同供应商同号跨日期应触发重复单告警 | 不通过 | checks=contract_price,contract_price,low_confidence,low_confidence | 154–168 | DEF-07 |
| M01 | 新建主数据需确认、单位必填、重复名称409 | 通过 | 缺确认400；新建供应商及材料201；重复供应商409；空单位400。 | 169–173 | — |
| M02 | 关联已通过单据新建主数据不能绕过只读 | 不通过 | actual 201; status=APPROVED; supplier sup_sh->cmvj4dur3007t3o856w285dtv; version 10->10 | 174–176 | DEF-03 |
| M03 | 管理员合并供应商保留单据金额且普通员工禁止 | 通过 | 普通员工合并403；管理员供应商合并200；合并自身400。实际引用/金额保持另由I06/I07验证。 | 177–179 | — |
| M04 | 实际Excel导入、dryRun无写入与非法文件处理 | 通过 | dryRun校验成功且供应商数不变；实际导入新增1供应商、1材料、1合同；非法文件400。 | 180–185 | — |
| M05 | 错误工作簿整批回滚并提供行级错误 | 通过 | 200携带工作表/第2行错误，整批供应商数不变。 | 186–188 | — |
| M06 | 合同新增删除、项目创建和账号管理 | 通过 | 项目201/重复409；员工201、重置200、旧密码401、新密码200、停用200/旧会话401；合同201/删除200。 | 189–200 | — |
| M07 | 架构文档声明的GET合同列表接口可用 | 不通过 | {"method":"GET","path":"/api/contracts","role":"admin","status":405,"ms":1.72}<br><br>405 !== 200<br> | 201–201 | DEF-12 |
| M08 | Excel合同引用按品名规格单位正确选择 | 不通过 | contract.spec=规格B; referenced ingredient.spec=规格A<br><br>'规格A' !== '规格B'<br> | 202–203 | DEF-08 |
| B08 | 连续10轮真实并发保存冲突全部返回409 | 通过 | 10轮×3请求，每轮1个200、2个409。 | 204–243 | — |
| B09 | 同一图片重复使用触发重复图片报警 | 通过 | 相同原图重复建立第二张单据产生duplicate_image。 | 244–252 | — |
| B10 | 并发通过和退回必须只有一个生效 | 通过 | 并发审核通过/退回本轮仅1个成功；另一方拒绝，未产生两个成功审核结果。 | 253–263 | — |
| U06 | 上传已过期签名及实际超过15MB文件拒绝 | 通过 | 过期地址403；实际发送15MB+1字节413。 | 264–266 | — |
| F05 | 具备单一项目主管角色时不能审核其他项目 | 通过 | 仅上海主管审核杭州单据403。 | 267–269 | — |
| W01 | 未配置微信时入口降级、伪造绑定凭证拒绝 | 通过 | 未配置微信307回员工号入口；伪造绑定票据400。 | 270–271 | — |
| P01 | 100次10并发混合只读稳定性采样 | 通过 | 100次10并发读取全部200，P50=38.65ms/P95=72.89ms/max=77.76ms，21张单据前后不变。 | 272–373 | — |
| S04 | 登录连续10次失败后第11次限流 | 通过 | 10次401后第11次429（独立测试IP键）。 | 374–384 | — |
| S05 | 注销清除Cookie | 通过 | 注销200，Cookie Max-Age=0。 | 385–385 | — |

## 单元、数据库、规则和离线故障注入：27项

其中13项为原有测试，14项为本轮新增；26通过、1不通过。离线通道使用Mock模拟，未调用真实云API。

| 文件 | 测试项 | 结果 | 证据/差异 |
| --- | --- | --- | --- |
| database.test.ts | seeds projects, documents and checks | 通过 | 断言全部成立；测试输入及期望见对应脚本。 |
| database.test.ts | returns the correct top suggestion for handwritten OCR errors | 通过 | 断言全部成立；测试输入及期望见对应脚本。 |
| database.test.ts | generates a three-sheet Excel template | 通过 | 断言全部成立；测试输入及期望见对应脚本。 |
| database.test.ts | validates and imports a complete master-data workbook | 通过 | 断言全部成立；测试输入及期望见对应脚本。 |
| database.test.ts | rejects an invalid workbook as a whole | 通过 | 断言全部成立；测试输入及期望见对应脚本。 |
| domain.test.ts | normalizes punctuation, width and common OCR confusions | 通过 | 断言全部成立；测试输入及期望见对应脚本。 |
| domain.test.ts | scores exact aliases and similar names higher than unrelated names | 通过 | 断言全部成立；测试输入及期望见对应脚本。 |
| domain.test.ts | parses common Chinese date formats without timezone drift | 通过 | 断言全部成立；测试输入及期望见对应脚本。 |
| domain.test.ts | passes a clean, contract-compliant document | 通过 | 断言全部成立；测试输入及期望见对应脚本。 |
| domain.test.ts | detects line arithmetic, total and contract overruns | 通过 | 断言全部成立；测试输入及期望见对应脚本。 |
| domain.test.ts | warns when cross-supplier median is exceeded by more than 10% | 通过 | 断言全部成立；测试输入及期望见对应脚本。 |
| domain.test.ts | keeps decimals stable for catering quantities | 通过 | 断言全部成立；测试输入及期望见对应脚本。 |
| domain.test.ts | only allows valid transitions | 通过 | 断言全部成立；测试输入及期望见对应脚本。 |
| extended.test.ts | O01 both channels succeed and keep structured values | 通过 | 断言全部成立；测试输入及期望见对应脚本。 |
| extended.test.ts | O02 OCR channel rejection preserves VLM result | 通过 | 断言全部成立；测试输入及期望见对应脚本。 |
| extended.test.ts | O03 simulated VLM timeout preserves OCR raw text and indicates manual entry | 通过 | 断言全部成立；测试输入及期望见对应脚本。 |
| extended.test.ts | O04 both channels failing produces recoverable error | 通过 | 断言全部成立；测试输入及期望见对应脚本。 |
| extended.test.ts | O05 malformed VLM JSON does not invent structured rows | 通过 | 断言全部成立；测试输入及期望见对应脚本。 |
| extended.test.ts | O06 corrupt image raises an error before cloud access | 通过 | 断言全部成立；测试输入及期望见对应脚本。 |
| extended.test.ts | O07 preprocessing limits pixels and converts to JPEG | 通过 | 断言全部成立；测试输入及期望见对应脚本。 |
| extended.test.ts | D01 one cent is tolerated; two cents is an ERROR | 通过 | 断言全部成立；测试输入及期望见对应脚本。 |
| extended.test.ts | D02 contracts from another project or different spec/unit/period are not used | 通过 | 断言全部成立；测试输入及期望见对应脚本。 |
| extended.test.ts | D03 two market samples are insufficient; three allow warning | 通过 | 断言全部成立；测试输入及期望见对应脚本。 |
| extended.test.ts | D04 historical overprice and quantity above double generate warnings | 通过 | 断言全部成立；测试输入及期望见对应脚本。 |
| extended.test.ts | D05 zero confidence must be flagged for manual review | 不通过 | AssertionError: expected false to be true // Object.is equality<br>    at C:/Users/Administrator/AppData/Local/Temp/gysycl-acceptance-a6d8894aab17430fbc715428555aae42/tests/extended.test.ts:86:116<br>    at file:///D:/codex/gysycl/node_modules/vitest/dist/chunks/run.BPv-BBRv.js:1632:35<br>    at file:///D:/codex/gysycl/node_modules/vitest/dist/chunks/run.BPv-BBRv.js:2801:26；DEF-13 |
| recovery.test.ts | R01 failure keeps original, moves to editable draft and retries successfully | 通过 | 断言全部成立；测试输入及期望见对应脚本。 |
| recovery.test.ts | R02 manual save after failure records both field snapshots and creates supervisor notice | 通过 | 断言全部成立；测试输入及期望见对应脚本。 |

## 数据勾稽与补充API：7项

| ID | 验收项 | 结果 | 实际表现 |
| --- | --- | --- | --- |
| I01 | Excel单据、明细和异常逐行与详情数据勾稽 | 通过 | {"documents":22,"items":40,"checks":67} |
| I02 | 价格分析项目和供应商汇总与已通过单据一致 | 通过 | {"approved":9,"total":7837.5} |
| I03 | 规范品名规格单位分组与跨供应商价格矩阵勾稽 | 通过 | {"groups":7,"multiSupplierGroups":2} |
| I04 | 会话查询的登录及未登录行为 | 通过 | 未登录user=null；登录后employeeNo=admin。 |
| I05 | 草稿重新比对和重新识别成功恢复 | 通过 | 重新比对成功；重新识别后等待version递增，DRAFT、2行、无ocrError。 |
| I06 | 从明细新建材料并合并后金额保持一致 | 通过 | 明细关联新材料后管理员合并到目标材料，关联更新，行金额和整单金额保持。 |
| I07 | 合并已引用供应商后历史单据金额保持一致 | 通过 | 已引用供应商合并到sup_sh后，关联更新，明细/整单金额保持；初轮亦验证已审单供应商合并。 |

## 页面和交付物

| 检查 | 结果与证据 |
| --- | --- |
| 构建/类型检查/依赖树 | 命令退出码0，见build.log、typecheck.log、dependencies.json。新增验收代码纳入后的类型检查亦通过，见artifact-typecheck.log。 |
| Prisma模型/客户端 | validate/generate均退出0，在隔离副本生成，不等于生产迁移执行。 |
| 原有smoke | 输出ok=true、DRAFT、青莱/士豆匹配青菜/土豆，见smoke.log。 |
| 七个工作页面 | 均能加载，390px视口中document.scrollWidth=375；ui-results.json保留每页测量。 |
| 移动详情底部操作 | 保存按钮底边626.5px，固定导航顶边774px；无遮挡，见detail-mobile-footer.png。 |
| 浏览器错误 | 本次页面访问捕获到的console error为空；不等于全部交互都无错误。 |
| 停服后数据库读取 | 单据/明细22/40、4条正常修改有前后快照、6条MOCKED通知，见persistence-results.json。后续补充主数据测试产生了不同快照。 |

## 已排除的脚本误报

api-initial-results.json中U04使用了未公开的objectKey字段，后改为DTO的pages.url并通过；remaining-initial-results.json中异步重识别未等新版本完成，后修正等待条件并通过。这两项不计产品缺陷。所有最终失败仍保留严格预期，未放宽业务标准。

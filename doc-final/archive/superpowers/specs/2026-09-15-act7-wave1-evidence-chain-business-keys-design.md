# 第七幕波一 · 证据链修复 + 业务键换装 —— 设计稿

> 总纲：`2026-09-15-act7-audit-campaign-charter.md`（波一/三波）｜ 依据体检：`checkups/2026-09-15-act7-audit-traceability.md` ｜ 基线 main `8a6390fa`
> 业主拍板在案：岔口① Raw Record 乙案过滤、③ 账本跳转不做（`decisions.md` 2026-09-15）；证据包**加进第七幕剧本**（2026-09-15 波一脑暴，波一按"演得出"验收、剧本文字波三收口）。
> 设计讨论 2026-09-15 当日业主全案通过。

## 0. 本波做 / 不做

**做**：① 证据包三域快照链修通（充值/提现照 swap 先例 + 三域幽灵段全删）② 审计域两详情端点/路由/行点击换业务号 ③ UUID 卫生四件（含 Raw Record 乙案）④ 证据包详情渲染审批背书 ⑤ 按未来剧本预演验收。

**不做**（对照总纲 §2 与 CLAUDE.md §2）：写入面 subjects / 归因（波二）｜ 筛选栏、URL 参数、实体页深链（波三）｜ **不新增任何快照段**（如 withdraw 报价快照——修复以现有真实段为限）｜ 包格式/导出增强 ｜ InternalFundAuditLog ｜ schema / seed（全波零触碰，不触 ⑧）。

## 1. 证据链修复（后端，`audit-logs.service.ts`）

**病灶**（体检红 1，业主 2026-09-13 拍板归本轮）：
- `buildDepositSnapshots`（:1342-1597）/ `buildWithdrawSnapshots`（:1598-1916）把审计事件里的**业务号**直接塞进 `where: { id: { in: workflowIds } }`（:1373-1374 / :1634-1635）——按 UUID 列匹配业务号恒空；
- 三域共引 5 个 schema 里不存在的幽灵模型（`kytCase`/`travelRuleCase`/`workflowDecisionRecord`/`complianceAlert`/`complianceIncident`；deposit :1397-1496、withdraw :1673-1773、swap :2063-2123），可选链守卫恒走空数组分支——包体里一堆永远空的误导键。

**修法（甲案，乙案"只改 where 留幽灵"已否）**：
1. 新增 `resolveDepositExportSelectionContext` / `resolveWithdrawExportSelectionContext`，逐字镜像 `resolveSwapExportSelectionContext`（:401-）：从选中审计事件筛 `primarySubjectType = DEPOSIT_TRANSACTION` / `WITHDRAW_TRANSACTION` 的 `primarySubjectNo`，按 `depositNo`/`withdrawNo` 查回内部 id，供快照查询。
2. `depositTransaction.findMany` / `withdrawTransaction.findMany` 改用解析出的真 id 集；现有 select 字段形状不动。
3. **幽灵段三域全删**：查询分支与输出键一并删——deposit/withdraw 各 5 段、swap 的 `swapRiskDecisionRecords`/`swapAlerts`/`swapCases` 3 个恒空键。swap 的真实段（`swapTransactions`/`swapQuotes`/`swapJournals`/`swapEvidenceChain`）不动。包体 `snapshots` 从此只含真段。
4. 事件本体（`records`）、`recordDigests`（:785-789，含 eventNo + 摘要）、`manifest.approval`（:805-813）等既有结构一律不动。

**测试反转**（这条链坏两个月没被发现的根因就是测试测的恰恰是空数组兜底路径）：`audit-logs.service.spec.ts` 三域 `buildEvidencePackageArtifacts` 用例（deposit :584-806 / swap :807-1111 / withdraw :1112-1468）升级为：铺真单据行 → 断言对应快照段**非空**且键值对得上；并断言幽灵键**不存在于包体**。改完先反向验一次（把解析步故意断掉应转红）。

## 2. 业务键换装（前后端）

| 位置 | 现状 | 改为 |
|---|---|---|
| `audit-logs.controller.ts:93-98` | `GET /admin/audit-logs/:id`（UUID） | `:eventNo`，按 `eventNo @unique`（schema :377）查 |
| `audit-evidence-package.controller.ts:63-77` | `GET .../:id`、`GET .../:id/download` | `:packageNo`（schema :497）+ `:packageNo/download`，下载链路 `downloadEvidencePackage` 查找同步换 |
| `admin-web/src/App.tsx:269/271` | `audit/logs/:id`、`audit/evidence-packages/:id` | `:eventNo` / `:packageNo` |
| `AuditLogsPage.tsx:481` | `navigate(.../${item.id})` | `item.eventNo` |
| `EvidenceExportsPage.tsx:274` | `navigate(.../${item.id})` | `item.packageNo`；:216 起的 `lastExportId`「View package」按钮若涉导航同步换 |
| 两详情页 fetch（`AuditLogDetailPage.tsx:183`、`EvidenceExportDetailPage.tsx:210-222`） | 按 id 请求 | 按业务号请求 |

**当场核的技术点**：RBAC 权限码（`permissions.ts:99-104`，如 `api.get.admin_audit_logs_id`）是否随路径参数名连动——变了就同步 `rbac.catalog.ts` 登记 + 前端权限表；合并后照惯例重启 + `npm run db:base:sync`。按业务号查不到 → 404 语义照旧。

## 3. UUID 卫生（前端）

1. `AuditLogDetailPage.tsx:362` Owner ID 字段删（Owner No 保留）。
2. actorId 兜底两处清：详情 :313 `{actorNo ?? actorId}` 与列表 :551 `actorId.slice(0,8)+'…'` → actorNo 缺失显 `—`。
3. Selected Event IDs（`EvidenceExportDetailPage.tsx:441-457`）：数据源改 `manifest.recordDigests[].eventNo`（**零后端改动**），标题改 "Selected Events"。
4. **Raw Record 乙案**：新建共用小工具 `stripInternalIds(obj)`——递归剔除匹配 `/^id$|Id$|Ids$/` 的键，**放行名单**（是旅程/链路标识、页面本就展示）：`traceId`、`correlationId`、`causationId`、`requestId`、`sessionId`。两详情页 Raw Record 的渲染与 Copy（`AuditLogDetailPage.tsx:138-168/420`、`EvidenceExportDetailPage.tsx:489`）以及 Filter Snapshot JsonBlock（:437-439，内含 `selectedEventIds` UUID 数组）统一过滤。

## 4. 证据包背书渲染（前端）

`EvidenceExportDetailPage.tsx` 补「Approval」区：Approval No（可点，链去审批中心详情——审批详情本按 `:approvalNo` 路由）+ Status 徽章 + Approved By + Decided At。数据源 `manifest.approval`（接口已回传的 `approvalCase` 字段作补充，取更全者），零后端改动。

## 5. 验收与闸

**演法（按剧本收编拍板预演，剧本文字波三改）**：
1. `auditor@` 审计页定位第三幕那笔冻结→处置充值单的事件（Advanced · Entity No）→ 建证据包
2. `mlro@` 审批中心批准
3. `auditor@` 证据包详情：状态 READY、**Approval 区四件齐**、Selected Events 全业务号 → Download
4. 打开 JSON：`snapshots.depositTransactions` 非空、幽灵键不存在、URL 栏是 `packageNo`
5. 提现单同法抽验一张（`snapshots.withdrawTransactions` 非空）

**判据**：战役判据 1 + 4（证据链非空 ｜ 审计四页零 UUID 落屏与落 URL）。
**闸**：①②③ tsc + ④ jest（audit-logging 目录，含反转后新断言全绿）+ ⑤ preview 截图四页 + ⑥ `on-stack demo:all`。不动 schema/seed，⑦⑧ 不触发。

**收尾**：BACKLOG §H 销 4 条（幽灵模型 / UUID 路由 / UUID 落屏三处 / 证据包背书）；按 `delivery-checklist.md` 立波二骨架 + 承接记录；总纲状态行回写。

## 6. 风险与开口

- 权限码连动是本波唯一的"改一处动三处"点（catalog / 前端权限表 / base:sync），列为独立任务防漏。
- jest 用例反转工作量最大（三域 describe 各一段铺数据），是本波任务量主体。
- swap 删空键属跨域顺手（同一函数族、同一病灶），符合"连带孤儿"判例，不算越界。

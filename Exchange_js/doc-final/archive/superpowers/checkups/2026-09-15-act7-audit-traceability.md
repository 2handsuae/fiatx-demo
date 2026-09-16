# 第七幕「事后说得清」（V1 审计追溯）· 体检报告（主会话判读版）

2026-09-15 ｜ 体检对象 main `8a6390fa` ｜ 目的：第七幕优化轮开工前摸底——审计追溯的后端底盘 / 管理台可见面 / 全仓写入覆盖面三条线，并复核 BACKLOG §H 台账 ｜ 方法：三名 sonnet 取数员交「数字 + 复现命令」（A 后端审计域 / B 管理台可见面 / C 全仓写入面），红级指控与全部否定性结论由主会话逐条复现后才采信（复现记录见附录）。体检零代码改动，随手闸不适用。

判色口径同前：**红** = 违反铁律或挡第七幕讲清 ｜ **黄** = 漂移、死码、不一致，不挡主线 ｜ **绿** = 逐项核过有证据。

**一句话总评：第七幕剧本里写的五步走查（按单号拉链 / 按客户查 Carol / 账本核对 / 按 actorNo 查越权 / 关联单号跨主体）今天全部演得出来——三域交易审计 owner+subjects 齐、冻结链完整、越权留痕真实；病灶集中在三处：① 证据包导出的充值/提现证据链从出生就没工作过（5 个幽灵 Prisma 模型 + 业务号错配 id 列，业主已拍板归本轮修）；② V1 治理域约 29 码审计不写 subjects 子表，「按 Related No 索档一个管理员的一生」不成立——且台账 §H 记的「36 码」数字已过期（角色定义修改、角色绑定两族已带 subjects，本次订正）；③ 审计域自己是铁律⑥重灾区——两条 UUID 路由、行点击 UUID 跳转、actorId 兜底落屏、证据包详情整列事件 UUID。另有一条文档承诺与界面不符：v1-governance §4 承诺「按 correlationId 看完整旅程」，前端零入口。**

## 一、底盘数字（现状地图）

- **模块体量**：`src/modules/audit-logging/` 18 文件 7140 行；核心 `audit-logs.service.ts` 2409 行、常量表 1063 行、DTO 409 行
- **词表**：`AuditActions` 现役 **180 码**（`audit-actions.constant.ts:140-448`；按前缀 DEPOSIT 36 / WITHDRAW 31 / SWAP 25 / INCIDENT 11 / CUSTOMER 9 / RECON 8 / ONBOARDING 8 / 其余长尾——注意前缀计数 ≠ 域名册计数，V4/V5/V6 名册实数 47/33/26 含 INBOUND_* 等非同前缀码）；退役 **114 码** 进 `DEPRECATED_AUDIT_ACTIONS`（:984-1063）+ 动态迁移码退役正则（:981-983）
- **拒写闸**：`assertActionSpec`（`audit-logs.service.ts:868-936`）单点把守，`recordByActor`（:943 调用）与 `recordSystem`（内部委托 recordByActor）两个写入口全过闸——退役码命中即抛
- **全仓写入点**：`recordByActor` 118 + `recordSystem` 91 = **209 处**；分布 identity 74 / trading 39 / audit-logging 34 / asset-treasury 26 / governance 14 / clearing-settle 12 / 三个 sumsub 模块 9 / funds-orders 1
- **查询面**：`AuditLogQueryDto` 18 个参数（`audit-log.dto.ts:275-358`）；`subjectNo` 走子表（service :1078-1083 `subjects: { some }`）；`keyword` 实现覆盖 7 列（action / primarySubjectType / primarySubjectNo / actorNo / ownerCustomerNo / traceId / reason，:525-537）——与 script.md 站 4「afterData 搜不到」的警告一致
- **schema**：`AuditLogEvent` 有 `eventNo @unique`（schema :377）、`AuditEvidencePackage` 有 `packageNo @unique`（:497）——**业务号都在库，只是路由与详情端点没用**（见红 4）
- **校验器**：`verify:audit` = `scripts/verify-audit.ts`（95 行）：Q2 按单据查 / Q4 按客户查 / Q5 拒绝有痕 / Q6 谁查过日志 + 3 条不变量（PRIMARY 至多一 / INHERIT 必有 correlationId / 退役码零写入）+ V1 词表覆盖率；**无 Q1/Q3**（`grep -n "Q[0-9]" scripts/verify-audit.ts` 仅命中 Q2/Q4/Q5/Q6）
- **写入位置守则有测试闸**：`audit-write-position.spec.ts` 断言 V1 领域服务零直写、controller 层唯一例外是 `audit-logs.controller.ts`

## 二、第七幕走查五步支撑度（逐步判色）

| 步骤（script.md 第七幕） | 判色 | 依据 |
|---|---|---|
| ① 按单号拉充值冻结全链 + Entity No 跳回单据 | **绿** | `DEPOSIT_FROZEN` 已入链（波三修，销账在案）；跳转甲案映射表含 DEPOSIT_TRANSACTION（`auditEntityRoutes.ts:6-26`） |
| ② 按客户号查 Carol 名下所有被动过的事 | **绿** | 三域集中审计助手全带 `ownerCustomerNo` + OWNER subject（deposit :1816/1825、withdraw :1948/1957、swap :1465/1474，抽查 6 点全中） |
| ③ 点进账本凭证核对钱的去向 | **黄·观察** | 审计四页 + 映射表 `grep -in "ledger"` 零命中——审计与账本两套入口互不连通，走查靠手动切账本页；现行剧本讲得通，但「从证据链一键到凭证」这条线不存在 |
| ④ 按 actorNo 查内审的 `ADMIN_ACCESS_DENIED` | **绿** | 唯一写入点 `admin-permission.guard.ts:148-176`，带 actorNo / reasonCode / sourceIp，两个 deny 分支都记 |
| ⑤ 关联单号跨主体（提现单 + 它闯的大额审批单同屏） | **绿** | Advanced「Related No」→ `subjectNo` 子表检索；`approvals.service.ts` 7 处调用全带 subjects（:193-196 样板） |

**动线之外的一条承诺缺口**：`modules/v1-governance.md` §4 第七幕段承诺「按 correlationId 看『一次邀请』的完整旅程」——后端 DTO 支持（`audit-log.dto.ts:314-315`），**前端零入口**：列表页筛选无此栏、详情页接口与渲染均无此字段（`grep -n "correlationId" admin-web/src/pages/AuditLogsPage.tsx AuditLogDetailPage.tsx` 零命中，主会话复现）。演示时这句讲不出。

## 三、红项（挡讲清 / 铁律正犯——4 条全在 BACKLOG §H 有账，本次逐条复现仍真）

1. 🔴 **证据包导出的充值/提现证据链从出生未工作**（业主 2026-09-13 已拍板归第七幕轮修）：`buildDepositSnapshots`/`buildWithdrawSnapshots` 引用 `db.kytCase`/`travelRuleCase`/`workflowDecisionRecord`/`complianceAlert`/`complianceIncident` 共 5 个模型（deposit :1397-1496、withdraw :1673-1773 十处），schema 里一个都不存在（`grep -cE "model (KytCase|TravelRuleCase|WorkflowDecisionRecord|ComplianceAlert|ComplianceIncident) " prisma/schema.prisma` = 0，主会话复现）；且 `depositTransaction.findMany`/`withdrawTransaction.findMany` 的 where 按 `id`（UUID 列）匹配业务号输入（:1373-1374 / :1634-1635），恒空。**对照**：swap 链有 `resolveSwapExportSelectionContext`（:401-）先把业务号解析成内部 id，已真修复——照抄即是修法。spec 层佐证：三个 build 函数只被 `buildEvidencePackageArtifacts` 间接测，测的是 fallback 空数组路径，测不出错配。
2. 🔴 **V1 治理域 subjects 子表大面积缺席，「按 Related No 索档管理员的一生」不成立**——**且台账数字过期，本次订正**：仍零 subjects 的是 users/ 六个 workflow（invite 9 / suspension 3 / reactivation 3 / password-reset 7 / mfa-reset 4 / mfa-binding 11，共 **37 处**调用，六文件 `grep -c "subjects"` 全 0，主会话复现）+ `role-definition-create`（4 处）+ `approval-policy-change`（3 处）+ 证据包导出族（`grep -n "subjects" audit-evidence-export-workflow.service.ts` 零命中）+ `ADMIN_ACCESS_DENIED`（guard 无 subjects）。**但 BACKLOG §H 说的「ROLE_DEFINITION_*/APPROVAL_POLICY_CHANGE_* 共 8 码从不传」已不全对**：`role-definition-modify-workflow.service.ts`（:246 等 4 处 `subjects: this.roleRelatedSubject(role.code)`）与 `admin-role-binding-change-workflow.service.ts`（:139 等 4 处）**已带 subjects**——主会话贴码复现。修法样板照旧是 `approvals.service.ts:193-196`。
3. 🔴 **`InternalFundAuditLog` 有读无写，资金单详情页审计栏恒空**（铁律①可见面）：src/ 零写入方（`grep -rn "internalFundAuditLog" src/ --include="*.ts" | grep -v spec` 零命中，主会话复现）；读取链完整活着——`funds-order.service.ts:363` include auditLogs → `FundsOrderDetail.tsx:576-578` 渲染「Audit Log」卡，恒显 "No audit records."。修法二选一：补写状态变更，或该卡改读中央审计日志（资金单域已有 `FUNDS_ORDER_ADVANCED` 码 + FUNDS_ORDER subject 可查）。
4. 🔴 **审计域自己是铁律⑥正犯**：前端路由 `audit/logs/:id`、`audit/evidence-packages/:id`（`App.tsx:269/271`）+ 列表行点击 `navigate(.../${item.id})`（`AuditLogsPage.tsx:481`、`EvidenceExportsPage.tsx:274`）+ 后端两详情端点（`audit-logs.controller.ts:93-98`、`audit-evidence-package.controller.ts:63-68`）全用 UUID——而 `eventNo`/`packageNo` 两个业务号列在库且 @unique、就显示在同一行/同一页上没被用。换装照三域交易前例。

## 四、黄项（新发现 6 + 在账确认 2）

**新发现（本次登记进 BACKLOG §H）**：
1. **correlationId 旅程检索前端无入口**（见 §二末段）——文档承诺与界面不符，二选一：补前端筛栏（后端现成），或改 v1-governance §4 措辞。
2. **审计跳转甲案映射覆盖 18/27**：18 类已映射之外，另有 **9 类真实落库主体未映射**、详情页显纯文本——ACCESS_CONTROL（22 写点，最大头）、AUDIT_EVIDENCE_PACKAGE、INBOUND_TRANSFER_SIGNAL、APPROVAL_POLICY、RECON_DISPOSITION、CUSTOMER_TAG、MATERIAL_REQUEST、WITHDRAWAL_FEE_LEVEL、SWAP_FEE_LEVEL。其中费率两族管理台有页可落；AUDIT_EVIDENCE_PACKAGE 详情路由本身是 UUID，属甲案「映射了也 404、不硬造」既定口径——补映射前先修红 4。另：`AuditEntityTypes` 常量 40 键里 15 键零写入（孤儿常量），FUNDS_ORDER 反向缺席靠字面量写入（见下）。
3. **actorNo 缺失时兜底落屏 actorId UUID**：详情页 `{detail.actorNo ?? detail.actorId}`（`AuditLogDetailPage.tsx:313`）、列表页 `item.actorId.slice(0,8)+'…'`（`AuditLogsPage.tsx:551`）——条件性铁律⑥。
4. **证据包详情页整列内部事件 UUID + 两详情页 Raw Record 全量 dump**：`EvidenceExportDetailPage.tsx:441-457`「Selected Event IDs」逐个渲染事件 UUID 数组；审计详情页与证据包详情页的 Raw Record 区把含 `id`/`actorId`/`entityOwnerId` 的整条 JSON 落屏并带 Copy 按钮（`AuditLogDetailPage.tsx:138-168/420`）。
5. **证据包详情页零渲染审批背书**：`approvalCase` 字段在接口声明（:24-35）但正文零引用，MLRO 四页 grep 零命中——「导出要 MLRO 背书”这句在详情页讲不出，只能靠列表页 Approval No/Status 两列。
6. **第七幕一行级小账**（三件打包）：`AUDIT_EVIDENCE_EXPORT_DETAIL_READ` 前端权限常量零引用（`permissions.ts:102`，路由实挂的是 `AUDIT_EVIDENCE_EXPORTS_READ`）；`audit-log.dto.ts:348-351` keyword 注释写「action/module/entity/reason」而实现是 7 列且无 module/entity 字段；FUNDS_ORDER 作 `primarySubjectType` 是字面量未入常量表（`push-order.service.ts:250`、`funds-order-advance-workflow.service.ts:47`）。

**在账确认（不重复登记）**：
7. `AuditLogDetailPage.tsx:362` Owner ID（`entityOwnerId` UUID）冗余渲染——§H 在账。
8. `audit-actions.constant.ts` V4/V5/V6 三块头注释仍写 31/25/18（实数 47/33/26）——§K 文档小账在账；`AuditLogsPage` 裸 `Pagination` 未套 `ListFooter`——§I 13 页清单在账。

**观察项（不立案）**：`verify:audit` 的 Q2 判据是「任取一条子表 PRIMARY 行反查>0」——自证式弱判据，子表覆盖再窄也绿，与 §H 在账的 Q4 自证问题同族，等红 2 修完后应升级为「按名册断言覆盖面」；审计页不读 URL searchParams，实体页反向深链进审计页的路（若未来想做「从单据一键看它的链」）没有地基。

## 五、绿区（核过没事）

- **拒写闸健全**：退役 114 码 + 动态正则，单点 `assertActionSpec`，两写入口全过；`verify:audit` 不变量③兜库内零写入
- **写入位置有守则有测试**：`audit-write-position.spec.ts` 把「领域服务不直写、controller 不直写（唯一例外自记查询）」钉死
- **证据包审批门完整**：MLRO 单步策略（`approval.constants.ts:187-191`）、下载前 `requireApproved`（:153-159）、生成失败也留痕（:280-303 FAILED + GENERATION_ERROR）——门本身是好的，坏的是链内容（红 1）与详情呈现（黄 5）
- **三域交易审计 owner+subjects 齐**（抽 6 点全中）；**事故域 11 码全带 subjects**（集中助手 `incident.service.ts:451-465`）；**对账域两条账龄审计已用 walletNo**（§G 在账的 RECON_CASE_OPENED metadata walletRef 例外仍真，:986）
- **越权留痕真实**：`ADMIN_ACCESS_DENIED` 两个 deny 分支都记、带 actorNo/reasonCode/sourceIp
- **client-web 零审计数据面**（grep 仅 6 处静态营销文案）——tipping-off 无泄漏面
- **Q6 恒红已被剧本消化**：第七幕走查①本身就会产生 `AUDIT_LOG_QUERIED`，正常走就绿——非缺陷

## 六、BACKLOG §H 台账复核结论

5 条开口 + §K 1 条：**仍真 6 ｜ 其中 1 条数字过期需重锚**（本次已订正）。

| 条目 | 复核结论 |
|---|---|
| ⭐🔴 子表覆盖 45 码仅 ~7 码 | 方向仍真，**数字过期**：role-definition-modify 族与 role-binding 族已带 subjects（8 处，主会话贴码复现），「36 码不传」分母需减两族；已在台账原地订正 |
| Q4 按客户查全部自证 | 仍真（verify-audit.ts:25-38 判据未变，V1 域 OWNER=CUSTOMER 仍只有查询自证一条路） |
| 审计域两条 UUID 路由 + Owner ID | 仍真，且本次补齐同族事实：行点击、后端端点、actorId 兜底、证据包 UUID 列（黄 3/4 另立） |
| InternalFundAuditLog 有读无写 | 仍真（零写入复现） |
| 证据包 5 幽灵模型 + id 错配 | 仍真（模型零命中复现；swap 对照链已修）——业主已拍板本轮修 |
| §K audit 常量头注释 31/25/18 | 仍真 |

## 七、建议波次切法（供脑暴，非 plan——最终拆法业主定）

- **波一 · 证据链与业务键换装**（红 1 + 红 4 + 黄 3/4 的 UUID 面）：证据包充值/提现链照 swap 先例修（幽灵模型整段退役或立表由业主定）；`audit/logs`、`evidence-packages` 两条路由 + 两个后端端点换 `eventNo`/`packageNo`；actorId 兜底与 Selected Event IDs 一并收
- **波二 · 子表补齐 + 旅程入口**（红 2 + 黄 1）：约 29 码补 `subjects:`（样板现成，多数 1-2 行）；前端补 correlationId 筛栏；顺手把 `verify:audit` Q2/Q4 从自证升级为名册断言
- **波三 · 可见面收口**（红 3 + 黄 2/5/6 + 文档）：资金单审计栏改读中央日志（或补写，业主定）；跳转映射补有落点的类型；证据包详情渲染审批背书；小账三件 + §K 注释一次清

## 附录 · 主会话复现记录

| 指控 | 复现命令 | 结果 |
|---|---|---|
| 5 幽灵模型不存在 | `grep -cE "model (KytCase\|TravelRuleCase\|WorkflowDecisionRecord\|ComplianceAlert\|ComplianceIncident) " prisma/schema.prisma` | 0（exit 1） |
| InternalFundAuditLog 零写入 | `grep -rn "internalFundAuditLog" src/ --include="*.ts" \| grep -v ".spec.ts"` | 零命中 |
| 审计两页零 correlationId | `grep -n "correlationId\|workflowType" admin-web/src/pages/AuditLogsPage.tsx AuditLogDetailPage.tsx` | 仅 workflowType 5 处，correlationId 0 |
| role modify/binding 已带 subjects | `sed -n '234,250p' role-definition-modify-workflow.service.ts` / `sed -n '128,142p' admin-role-binding-change-workflow.service.ts` | 两处 `subjects:` 在码 |
| users/ 六文件 + create + policy-change 零 subjects | `grep -c "subjects" <8 文件>` | 全 0 |
| 证据包导出族零 subjects | `grep -n "subjects" audit-evidence-export-workflow.service.ts` | 零命中 |
| AUDIT_EVIDENCE_EXPORT_DETAIL_READ 零引用 | `grep -rn "AUDIT_EVIDENCE_EXPORT_DETAIL_READ" admin-web/src/` | 仅 permissions.ts:102 声明行 |

---

# 补检（同日二问）：打点覆盖面按域对账 + 检索可用性判读

业主追问两件事：① 所有业务是不是审计都打齐了（按域）；② 前端展示是否合理、能否快速检索。方法：三名 sonnet 取数员（D 治理+客户域 / E 三交易域+资金单+Sumsub / F 配置+划转+对账）做「变更端点 ↔ 审计打点」逐条对账（每个 @Post/@Patch/@Put/@Delete 顺调用链追到 recordByActor/recordSystem），零审计结论主会话逐条复现。

## 一、按域对账矩阵（116 个变更端点）

| 域组 | 变更端点 | 直接审计 | 仅间接* | 零审计 | 备注 |
|---|---|---|---|---|---|
| V1 治理 + V2 客户（identity + governance） | 51 | 48 | 1 | **2** | 零审计 = `POST /auth/login` 与 `POST /auth/customer/login`（`auth.service.ts:38` 注释自认「登录流水归安全日志，本项目不做」——是口径不是遗漏）；间接 = 限制解除提交（注释自认走 APPROVAL_SUBMITTED）；另 1 子分支无痕：`verifyMfaCode`（密码重置的 MFA 校验计数/锁定，:240-275 零审计，姊妹方法都有） |
| V4/V5/V6 + 资金单 + Sumsub | 42 | 36 | 5 | **0** | N/A 1（admin 直建 swap 恒 403 不落库）；⚡ 11 个模拟端点全有痕（三域 SLA 拨钟 + 资金单六动作共用 `FUNDS_ORDER_ADVANCED` + 三域 run-verdict 双层审计 + 4 个模拟裁决入口间接）；报价三码两域满编 |
| V3 配置 + V7 划转 + V8 对账 | 22 | 21 | 1 | **0** | 间接 = 调账单提交（走审批码、`subjects[].subjectNo=adjustmentNo` 可追）；accounting 零变更端点（纯只读，grep 证实）；跑批触发与完成合并一条 `RECON_RUN_COMPLETED`（recordByActor，操作员在） |
| 审计域自身（证据包创建） | 1 | 1 | 0 | 0 | `AUDIT_EVIDENCE_EXPORT_REQUESTED`，失败也留痕 |
| **合计** | **116** | **106** | **7** | **2** | 106+7+2+N/A 1 = 116 ✓ |

\* 间接 = 端点自身无域专属码，靠审批中心的 APPROVAL_* 码留痕（两处都有代码注释自认是设计决定，且经 subjects 子表可按业务号追回）。

**状态机边覆盖**（E 员抽验）：三域统一迁移方法刻意不写审计（站2-β 定案：动态迁移码整族废除），每条边由 workflow 层具名业务码接手、带 fromStatus/toStatus——抽 5 条边（含两条冻结边、大额过门、拒退、解冻续走）5/5 落码。附带勘误：体检题面误给 deposit「10 态 23 边」基线，实为 15 态 29 边——`v4-deposit.md:27` 与代码一致，**非文档漂移**，是题面错。

**结论（①）**：「事有痕」在端点层面基本站住——116 个变更端点里唯二零痕是两个登录端点（注释自认口径），交易/配置/对账/事故全绿。但「**人有痕**」有一族缺口：
- `MATERIAL_REQUEST_ISSUED`（合规官下发材料请求，**在用链路**）走 `recordSystem` 不带操作人——actor 已传进 `issue()` 却只用于开限制，下发自己这条审计查不到是谁干的（`material-request-issuer.service.ts:63-102` → `material-requests.service.ts:146`）
- 客户 CRUD 三端点（`POST/PATCH/DELETE /customers*`）同款 `recordSystem` 无 actor，但管理台零调用（仅两处 GET：`CustomerDetail.tsx:252`、`CustomerManagement.tsx:175`）——属潜在死端点 + 潜伏归因缺口
- 加上主检已报的 V1 域 ~29 码无 subjects（Related No 检索面窄），「谁做的、和谁有关」这半边比「发生过什么」那半边弱一档

## 二、检索可用性判读（②）

**展示本身合理**：列表九列（Time / Audit No / Result / Workflow Type / Action / Entity No / Entity Type / Trace ID / Actor No）信息密度得当；详情页分区（Hero / 迁移条 / Actor / Entity / Owner / Workflow / Payload / Integrity）齐整；默认按时间倒序符合取证习惯；主栏 + Advanced 两层筛选的分法也对。

**检索「能查到但不快」，五处摩擦按痛感排序**：
1. 🔴 **「Audit No / Keyword」框是假承诺**（新发现）：keyword 的 OR 恰好 7 列（action/primarySubjectType/primarySubjectNo/actorNo/ownerCustomerNo/traceId/reason，`audit-logs.service.ts:525-537`），**不含 `eventNo`**——把列表里显示的 Audit No 原样粘回检索框，零结果。占位文案承诺了后端不支持的检索。
2. **全站零深链**：没有任何实体页（单据详情/客户详情/审批单）链到审计页（全仓 grep 仅侧边栏一处 `audit/logs`），审计页也不读 URL searchParams、没有预填能力——第七幕每一查都是「手动切页 → 展开 Advanced → 抄号粘贴」三步；审计→账本凭证同样零链接。这是「快速检索」的最大摩擦面。
3. **「按域浏览」做不到**：后端有 `actionDomain`/`action`/`workflowType` 过滤参数，前端一个都没露——业主想「按域检查审计」，界面上只能靠 keyword 碰 action 码字面量。
4. correlationId 旅程检索无入口（主检已报、在账）。
5. 跳转甲案 18/27 覆盖 + UUID 卫生（路由/actorId 兜底/Owner ID/Selected Event IDs，在账）。

**结论（②）**：布局与字段不用动大刀；要快，先修 1（一行改后端 OR 或改占位文案）、2（审计页收 URL 参数 + 实体详情页加「View audit trail」深链）、3（补 actionDomain/action 下拉）——三件都是小刀，收益全在演示动线上。

## 三、本补检记账

- BACKLOG §H 新登记 2：「Audit No 检索假承诺」「审计有痕无人（材料请求下发 + 客户 CRUD 三端点）」
- 零审计 2（登录）与间接 2（限制解除/调账提交）均有注释自认口径，不立案；`verifyMfaCode` 子分支并入「有痕无人」条备注
- 题面 deposit 状态机基线错误已在本节勘误，文档无漂移

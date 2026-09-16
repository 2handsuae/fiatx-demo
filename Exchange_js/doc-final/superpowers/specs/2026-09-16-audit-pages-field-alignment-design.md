# 审计两页按后端真实字段重设计 — spec

日期：2026-09-16 ｜ 来源：业主指令「admin 审计日志列表页/详情页跟后端结构不匹配，按后端字段重新设计」＋边界拍板甲案（重设计＋页内小账）
状态：待执行 ｜ 单波任务，无总纲

## §0 背景：三层错位（全部主会话实证，主栈库 1198 条事件实测）

**第 1 层：后端映射扣列。** 列表与详情共用同一个 `mapEvent`（`src/modules/audit-logging/audit-logs.service.ts:272`，详情不比列表多一个字段），schema（`prisma/schema.prisma:368` 组 A–J）里这些**实测有数据**的列不进响应：

| 被扣下的列 | 填充数（/1198） | 业务含义 |
|---|---|---|
| `fromStatus` / `toStatus` | 369 / 367 | 状态从哪到哪 |
| `amount` / `currency` | 187 | 这笔事涉及多少钱 |
| `approvalNo` | 70 | 谁批的——第七幕台词"谁批的、依据什么"，组 H 授权依据整组不可见 |
| `afterData` | 50 | 改成了什么 |
| `policyCode`（+`policyVersion`） | 25 | 依据哪条策略 |
| `actionDomain` / `category` | 1198（100%） | 哪个域、什么性质（列表页有 domain 筛选下拉，表格却不显示这列） |

**第 2 层：前端接口是幽灵形状**（对着老版 schema 写的）。`admin-web/src/pages/AuditLogDetailPage.tsx:16-54` 声明的 `triggerType` / `entityOwnerType` / `entityOwnerNo` / `actorRole` / `statusFrom` / `statusTo` / `beforeData` / `afterData` / `idempotencyKey` / `maskVersion` / `createdAt` / `updatedAt` 后端一个都不发。后果：Before→After 状态迁移块永不渲染；Owner 区永不渲染（`ownerCustomerNo` 1083/1198 有值，只在 Raw Record JSON 里可见）；Payload 区永远只有 Metadata 一块；Integrity 区三字段恒空；Sidebar Created/Updated 恒空。

**第 3 层：双向浪费。** 后端发了前端不用：`actorDisplayName`（100% 有值，两页都只显编号）、`actorRolesAtTime`、`reasonCode`、`recordedAt`。列表页 "Workflow Type" 列 1198 行全空——写入路径 `recordByActor` 的 create 载荷（`audit-logs.service.ts:929-981`）根本不含 `workflowType`，4 处调用方传了也被静默丢弃；`deriveBusinessWorkflow` 派生链因此恒 null。

**执行前新逮的雷（本 spec 顺手修）**：`DEPOSIT_CREATED` 审计把**资产 UUID 写进 `currency` 列**（`src/modules/trading/deposit-transactions/deposit-transactions.service.ts:1310` `currency: input.assetId`，实测 119 行污染，唯一写歪点，其余写入方均用 `asset.currency`）。金额一上屏就踩铁律⑥，必须先修写入点。

## §1 本任务做 / 不做

**做**：
1. 后端 `mapEvent` 补有货列、摘死列（§2.1）
2. `DEPOSIT_CREATED` currency 写入点修正（§2.2）
3. invite 派发失败分支补 INSTRUMENT 行 + 同处 actorNo UUID 修正（§2.3，BACKLOG §H 既有条）
4. 列表页 9 列换血（§3）
5. 详情页重排：死区块复活 + Authorization 区新建 + 幽灵字段清零（§4）
6. UUID 两残口收口：causationId 摘除 + Payload 区统一 strip（§5，BACKLOG §H 既有条）
7. 文档同步与销账（§7）

**不做**（对照总纲 §2 禁做清单与本轮拍板）：
- 跳转映射 7 类补齐（丙案排除，BACKLOG §H 条继续挂）
- 审计子表写入面、名册、`verify:audit` 判据（波二已收，不碰）
- `workflowType` DB 列删除（schema 注释既有债，排交易域批次）；4 处调用方死参数清理（纯内部死码，不清）
- 旧库 currency UUID 行 backfill / 前端防御渲染（总纲 §3：重铺即愈）
- 列表虚拟滚动、分页性能、字段级权限
- `beforeData` 写入方补建（现全 0；映上防"未来写了看不见"，不造写入）

## §2 后端改动

### §2.1 `mapEvent` 补列摘列（`audit-logs.service.ts:272` + `AuditLogView`，`dto/audit-log.dto.ts:92`）

**新增映射**（`AuditLogView` 接口同步）：
- `category`、`actionDomain`（透传）
- `fromStatus`、`toStatus`（透传）
- `amount`、`currency`（透传，string）
- `approvalNo`、`policyCode`、`policyVersion`（透传）
- `beforeData`、`afterData`（经既有 `parseJson`，与 `metadata` 同款，前端拿到对象不是字符串）

**摘除**：`workflowType`、`businessWorkflow`、`businessWorkflowLabel` 三个响应字段；`deriveBusinessWorkflow` 整个方法删除；`deriveUserAction` 第二参数（body 从不使用）签名收窄。`userAction` / `userActionLabel` 保留。

**不动**：查询侧 `query.workflowType` 的 DTO 参数与 where 条件（`:463`）、`:654` 起证据导出流程对 `workflowType` 的读用——API 面与导出链不在本任务半径。

**消费方保护（已核）**：`/admin/audit-logs` 另两个消费方——资金单详情审计栏（`FundsOrderDetail.tsx`）与 `scripts/verify-act1.ts`——只读 items 数量 / `action` / `occurredAt` / `recordedAt` / subjects，加列不影响、摘 `workflowType` 不影响（两处零引用，已 grep）。

**既有测试**：`audit-logs.service.spec.ts` 中断言 `businessWorkflow` / `businessWorkflowLabel` 的用例（:155-368 一带）改为断言新形状；新增映射补进形状断言。

### §2.2 `DEPOSIT_CREATED` currency 修写入（`deposit-transactions.service.ts:1310`）

`currency: input.assetId` → 资产币种码（`AED`/`USDT`）。方法作用域内若已有 asset 对象则直取 `asset.currency`，没有就查一次（与全仓其余审计写入方 `asset.currency` 写法对齐；同款先例见 BACKLOG §B「费率族 afterData 裸 UUID」条的修法方向）。历史 119 行污染不 backfill，重铺即愈。`amount` 实测已是显示单位（600/1200/2000），无需换算。

### §2.3 invite 派发失败分支（`admin-invite-workflow.service.ts` FAILED 径，约 :270-292）

1. `subjects: this.inviteSubjects(user.userNo)` → `this.inviteSubjects(user.userNo, event.approvalNo)`——helper 第二参数现成（:59-67），对齐同文件 CANCELLED 写法。销 BACKLOG §H「invite 派发失败分支漏 INSTRUMENT 行」条。
2. **同处顺手**（执行中发现，同族同性质）：该分支 `actorNo` / `actorDisplayName` 用的是 `event.decisionByUserId || 'SYSTEM'`（内部 UUID 落 actor 列），success 分支用 `decisionByUserNo`——两行同改 `event.decisionByUserNo || 'SYSTEM'`。技术失败径演示不可见，但 1 行对齐成本为零，不另立账。

## §3 列表页（`AuditLogsPage.tsx`）

`AuditLogItem` 接口按真实响应重声明：`id, eventNo, action, userActionLabel, actionDomain, primarySubjectType, primarySubjectNo, ownerCustomerNo, actorNo, actorDisplayName, outcome, occurredAt, amount, currency`。

**列布局（9 列 → 9 列，摘 2 加 3 并 2）**：

| # | 列 | 内容 | 宽度建议 |
|---|---|---|---|
| ☑ | 选择框 | 不动 | 36px |
| 1 | Time | 不动 | 140px |
| 2 | Audit No | 不动（结果色左边条不动） | 152px |
| 3 | Result | 不动（AdminBadge） | 84px |
| 4 | **Domain**（新） | `actionDomain` | 96px |
| 5 | Action | 主行 `userActionLabel`，副行 mono 小字灰码 `action`；label 缺省时只显码 | auto |
| 6 | Entity | `primarySubjectNo`（蓝链，映射逻辑不动）+ `primarySubjectType` 小字**合一格** | 150px |
| 7 | **Owner**（新） | `ownerCustomerNo`，无值 — | 120px |
| 8 | Actor | `actorDisplayName` 主行 + `actorNo` 小字合一格 | 140px |
| 9 | **Amount**（新，末列） | `amount currency` 右对齐 mono，无值 — | 110px |

**摘除**：Workflow Type 列（死列）、Trace ID 列（mono 长串，检索有筛栏即可）。
**筛栏**：主筛栏不动（traceId 筛栏保留）；高级筛栏摘 Workflow Type 输入框，`FilterState` / `DEFAULT_FILTERS` / `URL_FILTER_KEYS` / `buildSearchParams` 里 `workflowType` 同步摘除（深链参数随之退役）。其余筛栏全部不动。

## §4 详情页（`AuditLogDetailPage.tsx`）

`AuditLogDetail` 接口按真实响应重声明，幽灵字段（§0 第 2 层清单）全删。区块自上而下：

1. **Hero**：eventNo / action 码 + `userActionLabel`（`businessWorkflowLabel` 摘）/ Result 徽章 / Occurred / Reason，不动；**新增金额行**（`amount` + `currency`，有值时显示，amber 突出）；**状态迁移块复活**——现成 Before→After UI 的字段从 `statusFrom/statusTo` 对到真实的 `fromStatus/toStatus`。
2. **Actor 区**：`actorDisplayName` 升主行（amber 大字），`actorNo` 副行，`actorType` · `actorRolesAtTime`（join ' · '）第三行，platform/IP 不动。
3. **Entity 区**：主体不动；**Owner 复活**——改读 `ownerCustomerNo`，蓝链跳 `/admin/customers/:customerNo`（`auditEntityRoutes.ts:11` CUSTOMER 映射现成）。
4. **Related Subjects 区**：波三刚做，不动。
5. **Authorization 区（新，第七幕"依据什么"的答案）**：条件渲染（approvalNo/policyCode/reasonCode 任一有值）——`Approval No` 蓝链跳 `/admin/governance/approvals/:approvalNo`（App.tsx:260 路由现成）；`Policy` 显 `policyCode`（有 `policyVersion` 时缀 `v{n}`）；`Reason Code`。
6. **Trace & Journey 区**（原 Workflow 区改名）：摘 `workflowType`（死）与 `causationId`（§5 残口①）；留 `traceId` + `correlationId` journey 按钮（不动）。
7. **Payload 区**：Metadata / Before Data / After Data 三块 UI 现成，字段来了自然活；**构造 payloadBlocks 时三块统一过 `stripInternalIds()`**（§5 残口②）。
8. **Integrity 区**：摘幽灵 `triggerType` / `idempotencyKey` / `maskVersion`；留 Request ID / Payload Digest；**补 `isReadOnly` 徽章**（审计查询类事件标识，true 时显示）。
9. **Sidebar**：Identity Summary 改显 Category / Domain / Actor Type；Lifecycle 改真实时间线 Occurred → Recorded → Retained Until → Archived（摘幽灵 Created/Updated）。
10. **Raw Record**：机制不动（strip 后 JSON dump + Copy），自动获得新字段。

## §5 stripInternalIds 收口（BACKLOG §H「UUID 两残口」条，两处定案）

- **残口①（causationId）**：`admin-web/src/utils/stripInternalIds.ts:4` 的 `PASSTHROUGH_ID_KEYS` 摘除 `'causationId'`——其值常是审批内部 UUID，读不懂跳不了；配合 §4-6 展示摘除，屏上与 Raw Record 双侧清零。
- **残口②（METADATA 区，"待核"已核实定案）**：直因 = Payload 区的 JsonBlock 渲染 `detail.metadata` 原值、从不经 strip（Raw Record 才 strip），metadata 里的 `approvalId` / `suspendedByUserId` 等键直接落屏。修法 = §4-7（payloadBlocks 构造时统一 strip）。下载/Copy 语义不变：Raw Record Copy 本就是 strip 后文本，证据包下载文件全量保真的既有口径不受影响。

## §6 验收判据

1. 随手闸①②③ 全绿（client-web 零改动，③照跑作回归）。
2. jest：`src/modules/audit-logging`（含 §2.1 改后的形状断言）+ `src/modules/identity/users`（invite 相关既有 spec）全绿。
3. **⑤ preview 渲染 + 截图**（tsc 通过不算数）：
   - 列表页一张：Domain / Owner / Amount 三列有真值，Action 列人话标签 + 码双行；
   - 详情页·交易事件一张（如 `DEPOSIT_APPROVED`）：状态迁移块 `COMPLIANCE_PENDING → SUCCESS` 点亮、金额行、Owner 蓝链；
   - 详情页·治理事件一张（带 `approvalNo` 的 `APPROVAL_*` 或 IAM 事件）：Authorization 区 Approval No 蓝链可点、跳转落审批详情页。
4. **UUID 走查**：挑一条 metadata 带 `approvalId` 的事件（invite/suspension 族现成），详情页全屏肉眼 + 截图佐证：Payload 三块与 Raw Record 屏上零 UUID 形值；`causationId` 键不再出现。
5. 收尾闸⑥：`bash scripts/on-stack.sh main demo:all` + `verify:audit` 全绿（不动名册与判据，应零波动）。
6. 动过 §2.2 写入点 → 重铺（`stack.sh reset main` → up → demo:all）后 SQL 抽查归零：`SELECT COUNT(*) FROM audit_log_events WHERE currency LIKE '%-%-%-%-%'` = 0。
7. 无新端点、无权限码变更——不需要 `db:base:sync`。

## §7 文档同步与销账

- `modules/v1-governance.md`：审计两页的字段/列描述段按新布局同步（含"Workflow Type 列"若有提及则删；已 grep `demo/script.md` 零命中列名，不动剧本）。
- `ui-contract/admin-ui-contract.md`：核对审计段是否描述旧列结构，有则同步。
- BACKLOG 销账 2 条：§H「审计详情页内部 UUID 过滤两个残口」（§5 定案）、§H「invite 派发失败分支漏 INSTRUMENT 行」（§2.3）。`DEPOSIT_CREATED` currency 雷当场修不入账（本 spec §0/§2.2 即记录）。
- `PRODUCTION-NOTES.md` 追加一行然后放下：`payloadDigest` 完整性哈希不覆盖 fromStatus/amount/approvalNo 等新披露列（防篡改覆盖面部分，技术件）。
- `CHANGELOG.md` 一行。
- 收尾对照 `doc-final/rules/delivery-checklist.md`。

## §8 滚存与已知局限

- 跳转映射 20/27 维持现状（BACKLOG §H 条继续挂，ACCESS_CONTROL 22 写点是大头）。
- `beforeData` 全库 0：映射已备，何时有写入方何时可见，不造写入。
- 列表 Amount 列约 84% 行为 —（只有钱动的事件有值），属如实呈现非缺陷。
- `workflowType` 死列的 DB 删除与 4 处调用方死参数，随交易域 schema 批次收。

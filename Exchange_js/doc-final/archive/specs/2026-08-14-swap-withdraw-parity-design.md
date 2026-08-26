# 兑换 · 与提现全面对齐（Sumsub 数据契约 + 客户端限制体验 + 认证闭环）设计 spec

> **主题**：swap 与 withdraw 收敛到同一条 Sumsub 流水线的两个开关位；swap 详情页数据契约逐字段采用提现终态形状；受限客户"页面不封、按钮禁用"；认证入口挂两页顶部并复用既有认证页真跳 WebSDK。
> **日期**：2026-08-14　**状态**：设计（未实现）　**分支**：`feat/swap-sumsub-compliance`（在既有兑换合规实现之上增量）
> **业主总纲（本 spec 的裁决基准，原话）**：swap 和 withdraw 流程几乎一样，从 Sumsub 等的内容也一样。区别只有——withdraw 能停下来等待、认证材料入口放订单里；swap 不能停、有问题直接拒绝、认证材料入口放 swap/withdraw 页面顶部、对客户做交易层面限制。其余几乎一样。

## 0. 架构一句话

```
共享流水线（已存在，本 spec 不动）：提交 KYT → webhook 裁决 → 处置
仅保留两个差异开关：
  ①等待开关：withdraw 停在 COMPLIANCE_PENDING 等材料 │ swap 不停，直接 REJECTED
  ②入口位置：withdraw 挂订单（ACTION_PENDING + 订单详情入口，既有，不动）
             │ swap 挂人（restrictions + 页面顶部 banner）
其余一切同构：提交契约、webhook 消费铁律、Sumsub 数据形状、admin 详情页结构、防探测姿态
```

## 1. 客户端：受限体验（页面不封、按钮禁用）

**现状**（调研锚点）：`AuthGuard.tsx:100-133` 按 capability 把受限客户从 `/swap`、`/withdraw` 重定向到 `/profile`；`Swap.tsx:783-802/1050-1057` 与 `Withdraw.tsx:827-855/1044-1051` 的提交按钮 disabled 条件均无 restrictions 判断。

**改法**：
- AuthGuard 的 RESTRICTED 分支**撤掉 `/swap`、`/withdraw` 重定向**；保留 `/wallet/send` 的 WITHDRAW 拦截（该页无禁用 UI）。FROZEN 全局拦截（:94-98）与 trading-readiness 门（:139-148）不动。
- `Swap.tsx` / `Withdraw.tsx` 各自从 `useAuth().user.restrictions` 归一化 capability 集合（运行时元素为 `{capability, reason}` 对象、类型声明滞后为 `string[]`，两种形状都容——AuthGuard :105-114 已有同款归一化，抽成共享 util `restrictedCapabilities(user)` 三处复用）。
- 命中本页能力（SWAP↔Swap 页、WITHDRAW↔Withdraw 页）时：提交按钮（两步各自的）追加 disabled；表单区顶部渲染一条中性提示条：**"Trading is currently restricted on your account."**
- **tipping-off 口径**：提示文案不带原因、软硬线在客户眼里无差别；差别只体现在"有没有认证 banner"（由后端 pending-action 单点决定）。
- 后端 L1 门（`assertTradingEligibility` 的 CAPABILITY_RESTRICTED）原样保留——前端禁用只是体验层，防御在后端。

## 2. 客户端：认证入口挂两页顶部

**现状**：`PendingActionBanner` 挂在 Swap 页右侧栏（`Swap.tsx:808`）；Withdraw 页完全没挂。

**改法**：banner 移至 **Swap 与 Withdraw 两页内容区最顶部（tab 栏之上、跨全宽）**，各挂一份；Profile 页挂载保留（次要落点，FROZEN 弹回也可见）。显隐仍完全由 `GET /client/me/pending-action` 决定，前端零推导（`PendingActionBanner.tsx:10-27` 头注铁律不动）。

## 3. 认证页与闭环（复用充值/提现既有件，非新发明）

**既有件**（调研锚点）：
- 路由 `/deposit/:no/verification/:seq`、`/withdraw/:no/verification/:seq`（`App.tsx:52/56`）→ `DepositVerification.tsx` / `WithdrawVerification.tsx`（同构双胞胎）。
- 页面：`GET …/verification-session/:seq` → `{submitted, sdkToken}`；`window.snsWebSdk.init(token, refreshToken).….build().launch('#sumsub-container')`；`onApplicantSubmitted` → `POST …/submit` → `goBack()`；demo 模式 `MockUploader` 假上传走同一 submit。
- 后端：`*-verification-session.service.getSession()` → 按 JWT ownerId + 单号取单 → `applicantActions.findBySeq` → 已提交则 `{submitted:true, sdkToken:null}` → 否则 `sumsubClient.createActionSdkToken({applicantId, levelName: SUMSUB_ACTION_LEVEL, externalActionId})`（`sumsub.client.ts:118-158`，mock 模式返假 token）。
- **防探测姿态（必须照抄）**：响应体只有 `{submitted, sdkToken}` 两键，客户端全程拿不到 Sumsub 侧 action id（URL 用 seq 不用 id）；`submit` 幂等恒 2xx、不由订单整体状态决定响应——防客户探测冻结/判定。

**swap 增量（锚点从订单+seq 变为客户级单槽）**：
- 新路由 **`/verification/pending`** + 薄页面 `PendingVerification.tsx`（fork 既有认证页，去掉 seq 段；SDK 启动/回跳/demo MockUploader 逻辑照搬）。
- 新端点（`customer-pending-action.controller.ts` 扩展，`AuthGuard('jwt')` + assertCustomer）：
  - `GET /client/me/pending-action/verification-session` → 凭 JWT userId 读 `CustomerMain.pendingActionExternalId`；无 pending → `{submitted:true, sdkToken:null}`（与"已提交"不可区分，防探测）；已提交（见下新列）同上；否则 `createActionSdkToken({applicantId: customer.sumsubApplicantId, levelName: SUMSUB_ACTION_LEVEL, externalActionId})`。
  - `POST /client/me/pending-action/verification-session/submit` → 写 `pendingActionSubmittedAt`（幂等）+ 审计 `SWAP_ACTION_SUBMITTED`（recordByActor，注入的 AuditLogsService）；恒 2xx。
- **新列** `CustomerMain.pendingActionSubmittedAt DateTime?`（migration `customer_pending_action_submitted`）：banner 三态——无（不渲染）/ 请认证（CTA 跳 `/verification/pending`）/ **材料已提交审核中**（无 CTA，防反复点）。Task 13 的 GREEN/RED handler 清 pendingAction 时一并清此列（走 `CustomerPendingActionService`，遵守"不直写他域表"）。
- **banner CTA 从 stub 变真跳转** → 关闭 BACKLOG「认证 CTA 降级（Task 11）」条目。
- `SUMSUB_ACTION_LEVEL` 占位环境变量沿用（已有 BACKLOG，不在本 spec 解决）。

**AuthContext 陈旧缺口（调研逮到，必须闭环）**：`AuthContext` 的 user 仅挂载时拉一次（`useCustomerProfile.ts:101-103`），`Verification.tsx` 调的 `refreshProfile` 是自己局部 hook 实例、**刷不到** AuthGuard/Swap/Withdraw 共享的 user——认证完成 + officer GREEN 清限制后，按钮不会自动解禁。**修法**：`PendingActionBanner.load()` 检测 action 从非空→null 的转变时调用 `useAuth().refreshProfile()`；限制解除瞬间按钮自动恢复，无需整页刷新。

## 4. admin 详情页：swap 采用提现的 Sumsub 数据契约（废自造字段）

**提现终态契约**（调研锚点，逐字段为准）：
- 行列：`sumsubTxnId`/`sumsubTxnType`/`sumsubVerdict`/`sumsubScore Int?`/`sumsubScoredAt DateTime?`/`sumsubTxnDetailJson`（schema:1223-1228）。
- 拉取：`DETAIL_LOOKUP_VERDICTS = {approved, rejected, awaitUser, onHold}` **四类都拉** `getTxn` 并经 `saveSumsubVerdict`（`withdraw-transactions.service.ts:818-831`）一次原子写 verdict/score/scoredAt/detailJson。
- 读面 `sumsubDetail`（`findOneForAdmin` parseDetail，:553-585）：
  `{ verdict, reviewStatus, reviewAnswer, score, matchedRules[{id,name,action,score}], applicantActionIds[], tags[], raw }`
- References 卡：Applicant ID / Txn ID / Type / Verdict / **Received At**(=sumsubScoredAt 裸列)。
- Detail 卡（SumsubDetailSection :834-881）：Score / Verdict / Review Status / Review Answer / Matched Rules(`name·action·score`) / Applicant Action IDs(join) / Raw payload 折叠。

**swap 现状差距**（调研核实）：无 score/scoredAt/txnType 列；handler 仅 rejected 拉 detail，**approved 什么都不落**（V1 的 score 丢失）；读面是自造形状（scoringAction / matchedRules 纯字符串数组 / 无 reviewStatus/reviewAnswer）；demo 的 raw 本就复用充值 `buildTxnReport` 官方形状——**假数据无需动，读写两侧没用满而已**。

**改法**：
1. **迁移 +3 列**：`sumsubScore Int?`、`sumsubScoredAt DateTime?`、`sumsubTxnType String?`（提交卖出腿时恒写 `'finance'`）——migration `swap_sumsub_parity_fields`。
2. **handler 对齐拉取时机**：swap 的 verdict 归一后只有 approved/rejected 两类（awaitUser/onHold 已塌缩进 rejected），两类**都拉** `getTxn`；`applyKytVerdict` 内经 fork 的 `saveSumsubVerdict`（swap-transactions.service）一次原子写 verdict/score/scoredAt/detailJson——修掉"approved 不落详情"。detailJson 存**整个 detail.raw**（与提现同源同形）。
3. **findOneForAdmin 换 parseDetail**：照搬提现 :553-585 的解析（含 matchedRules 结构化、applicantActionIds、tags），输出形状与提现逐字段一致；保留 swap 特有补充字段 `txnIdIn`（买入腿）与行级 `rejectReason`。`complianceVerdict/Action/RuleNames` 列保留（审计/列表查询用），但读面不再以它们为准。
4. **admin 页组件对齐**：`SwapTransactionDetail.tsx` 的 `SumsubTxnDetail` interface 与 `SumsubDetailSection` 逐行改成提现版（Score/Verdict/Review Status/Review Answer/Matched Rules name·action·score/Applicant Action IDs/Raw）；References 卡补 Type 与 Received At，保留 Txn ID Out/In 两格。
5. **swap 独有保留**：`rejectReason`（TIMEOUT/KYT_REJECTED，提现无）、双腿 TxnId、Customer Disposition 只读侧栏、Internal Approvals 空态卡、⚡ 八键 Simulation——均为上轮业主已拍板项，不回退。

## 5. 明确不动的东西

webhook 路由与级联、状态机（4 态）、拒绝零记账痕迹保证、handleRejectDisposition 软硬线分型、sticky 硬线标记、demo fixtures 与 buildTxnReport、L1 后端门、提现域全部现状。

## 6. 默认决策（业主未反对即生效）

1. `/wallet/send` 保持 WITHDRAW 重定向拦截（无禁用 UI）。
2. Profile 页 banner 挂载保留（次要落点）。
3. 新增 `pendingActionSubmittedAt` 支撑三态 banner。

## 7. 验收要点（设计级）

- 受限客户能进 Swap/Withdraw 页：看得到表单、按钮灰、顶部限制提示 + 认证 banner；充值完全不受影响。
- 认证闭环全程：banner → `/verification/pending` → （demo）MockUploader 提交 → banner 转"审核中" → admin ⑦ GREEN → banner 消失 + 按钮自动解禁（无整页刷新）。
- 制裁客户（硬线）：同样的灰按钮与提示，**无 banner、无任何可区分信号**。
- admin swap 详情页与 withdraw 详情页并排对比：References/Detail 两卡字段一一对应；V1 approved 后 Score/Received At 有值（修掉 approved 不落）。
- 防探测：verification-session 端点对"无 action/已提交/不存在"三种情况响应不可区分；submit 恒 2xx。

## 8. 待验证 / 已知边界

- `SUMSUB_ACTION_LEVEL` 占位（既有 BACKLOG，真接前必须改）。
- `window.snsWebSdk` 依赖第三方脚本运行时挂载（demo 模式不依赖）。
- 真实 Sumsub 下 customer 级 externalActionId 换 token 的行为未实测（mock 模式已覆盖；与既有充值/提现同一 `createActionSdkToken` 通道，风险共担）。

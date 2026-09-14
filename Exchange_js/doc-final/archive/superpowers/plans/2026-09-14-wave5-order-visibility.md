# 波五 · 订单可见面 + 前端收口 + 三幕走查 · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 tipping-off 终局（制裁客户新单创建即冻、swap FROZEN 改中间态、swap 硬/软线便签退役）+ 客户端词表统一 + D10 管理台因由 + 三域路由换业务号 + 前端收口 + 站级剧本三幕走查收官。

**Architecture:** Spec：`doc-final/superpowers/specs/2026-09-13-wave5-order-visibility-skeleton.md`（§1 裁定台账 = 唯一口径）。核心手法全是"照提现抄"：swap FROZEN 的出边/解冻审批/拒退审批逐字镜像 withdraw 既有实现；创建即冻靠一个新的 SILENT-aware 准入判定；展示层零新状态值。零 schema 变更（审批类型是自由字符串，`prisma/schema.prisma:529` `actionType String`）。

**Tech Stack:** NestJS + Prisma + jest（后端）；React + vitest（client-web）；admin-web 无法单测（.spec.tsx 静默不跑），一律 tsc + preview 截图。

## Global Constraints

- 通用交付清单见 `rules/delivery-checklist.md`，全部适用。
- 本轮特有：①动钱动状态机（Task 2/3/4），收尾闸 ⑥⑦⑧ 全跑；②`swapStatusView.spec.ts:65-71` 明文断言"绝不全大写"，与词表统一硬冲突，Task 8 必须重写该断言（不许为绿而删测试外壳）；③swap 冻结语义翻案后，`demo-roster.ts:77`（seq13"零出边"）、`demo/script.md:67`（"锁当场擦除退回余额"）等旧口径文案随代码同波改，不留自相矛盾窗口。
- **总纲铁律**（派 subagent prompt 必带项目 CLAUDE.md §0–§5 要点）：操作必留痕（每条审计显式 `requestId`）｜门不可绕｜各管各的｜状态只能沿边走｜钱动必过账｜对外用业务键。禁做：幂等/去重/重试/并发锁/防御性校验/性能优化。
- **执行环境**：worktree `.claude/worktrees/wave5_order_visibility/`（树名下划线），分支 `feat/wave5-order-visibility`。所有命令在 `<worktree>/Exchange_js/` 下执行。
- **Node 20**：每个 Bash 会话先 `export PATH="$(ls -d "$HOME/.nvm/versions/node"/v20* | tail -1)/bin:$PATH"`。
- **jest**：Exchange_js 根下跑；worktree 内先 `export DATABASE_URL="file:/tmp/exchange_js_wt_wave5_order_visibility/dev.db"`（缺它=假红）；不接管道尾；首跑前 `npx prisma generate`。
- **随手闸**（每任务收尾全绿才 commit）：`npx tsc --noEmit -p tsconfig.json`；动 admin-web 加 `cd admin-web && npx tsc -b --noEmit && cd ..`；动 client-web 加 `cd client-web && npx tsc -b --noEmit && cd ..` + `npm run test:client`。
- **波四判例**：底层 select/schema 咬合改动 jest 全绿不算数，栈上跑一轮看 `Invalid prisma invocation` 计数（Task 4 收尾必做）；e2e 断言要能区分同名事件的不同产生路径；接管前 `ps` 确认对方进程死透。
- **悬案纪律（已更新）**：BACKLOG §A 幻影失衡已于波四修复——demo:all 判红不再默认按此条秒诊，按常规排查；先取证再 reset 仍适用。
- **模型分层**：任务执行/随码测试/截图/文档 → sonnet；**Task 2/3/4 评审升档 opus**（动钱+状态机+审批门）；终审 → 省略 model 走继承（Fable）。
- 行号为 2026-09-14 实测，执行时以现场为准（函数名定位优先）。

---

### Task 0: 环境就位

**Files:** 无代码改动。

- [ ] **Step 1**: 用 superpowers:using-git-worktrees 建 worktree `.claude/worktrees/wave5_order_visibility/`，分支 `feat/wave5-order-visibility`（基于 main）。
- [ ] **Step 2**: worktree 的 Exchange_js 下：`npm ci --no-audit --no-fund 2>&1 | tail -3`（若缺 node_modules）；`npx prisma generate`；`bash scripts/stack.sh reset self`。
- [ ] **Step 3**: `npx tsc --noEmit -p tsconfig.json` 应 0 错误。

---

### Task 1: SILENT 准入判定地基（CustomerAccessService）

**Files:**
- Modify: `src/modules/identity/customers/customer-access.service.ts`（`CustomerAccess` 接口 :37-47、`resolve()` :83-131、新增 `intakeDecision`/`assertTradingIntake`）
- Test: `src/modules/identity/customers/customer-access.service.spec.ts`（按该文件既有 mock 风格）

**Interfaces:**
- Produces: `CustomerAccess.blockingNotes: Array<{ capability: Capability; restrictionNo: string; cause: RestrictionCause; visibility: RestrictionVisibility }>`（含 SILENT 行——`disclosed` 数组不含，这是新增字段存在的理由）；`intakeDecision(customerId, capability): Promise<'ALLOW' | 'DENY' | 'ACCEPT_FREEZE'>`；`assertTradingIntake(customerId, capability): Promise<{ fold: boolean }>`（DENY 时抛既有 NEUTRAL_DENIAL 403，ACCEPT_FREEZE 返回 `{fold:true}`；非 DEPOSIT 域仍先过 `assertTradingReady`）。
- 判定规则（spec §2.1）：lifecycle≠ACTIVE → DENY；`blocked.has(capability)` 且**该能力的全部 blocking 行 visibility==='SILENT'** → ACCEPT_FREEZE；存在任一 DISCLOSED blocking 行 → DENY；未被卡 → ALLOW。

- [ ] **Step 1: 失败测试**——新增 describe：①SILENT-only（Carol 型：单张 SANCTION）→ ACCEPT_FREEZE；②DISCLOSED-only（Ivy 型：MATERIAL_EXPIRED）→ DENY；③SILENT+DISCLOSED 混合同卡一域 → DENY；④无便签 → ALLOW；⑤lifecycle=SUSPENDED → DENY；⑥`blockingNotes` 含 SILENT 行的 cause+restrictionNo（`resolve()` 现有测试断言 `disclosed` 不含 SILENT 的用例保持原样不动）。mock `restrictionsService.listOpen` 返回 `RestrictionRow[]`（字段形状见 `customer-restrictions.service.ts:31-49`）。
- [ ] **Step 2**: 跑 `npx jest src/modules/identity/customers/customer-access.service.spec.ts` 确认新用例红。
- [ ] **Step 3: 实现**——`resolve()` 的既有循环里（:96-108）顺手填 `blockingNotes`（每行展开 scopes 后逐能力 push，不分 visibility）；`intakeDecision` 基于 `resolve()` 结果按上述规则判；`assertTradingIntake` = lifecycle/DISCLOSED 分支抛 `ForbiddenException({code:'CAPABILITY_RESTRICTED', message: NEUTRAL_DENIAL})`（措辞与 `assertCapability` :158-176 逐字一致，客户面不可区分）+ 非 DEPOSIT 先 `assertTradingReady`。**不改 `assertCapability` 本体**（其余调用方行为零变化）。
- [ ] **Step 4**: jest 该文件全绿；随手闸；commit `feat(波五T1): SILENT 准入判定 intakeDecision/blockingNotes`。

收尾过闸行（delivery-checklist）：无持久状态变化、无新码新边——只过随手闸。

---

### Task 2: swap FROZEN 中间态——状态机 + 钱 + 客户面收敛 【评审升档 opus】

**Files:**
- Modify: `src/modules/trading/swap-transactions/dto/swap-transaction.dto.ts`（`SwapTransactionAction` 枚举 + FROZEN 注释 :17-21）
- Modify: `src/modules/trading/swap-transactions/swap-transactions.service.ts`（迁移表 :404-418、`toCustomerSwapStatus` :631-635、`toCustomerSwapView` :664-680、终态注释）
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts`（两处冻结点撤放锁 :1153、:1846 及其审计 reason）
- Test: `swap-transactions.service.spec.ts`、`swap-workflow.service.spec.ts`（改写清单见 Step 1/5）

**Interfaces:**
- Produces: `SwapTransactionAction.RESUME = 'resume'`、`SwapTransactionAction.REJECT_REFUND = 'reject_refund'`；迁移表 `FROZEN: { RESUME: COMPLIANCE_PENDING, REJECT_REFUND: REJECTED }`（Task 3 的审批落地方法消费这两条边）；`toCustomerSwapStatus(FROZEN) === 'COMPLIANCE_PENDING'`；`SWAP_CUSTOMER_COMPLETED_STATUSES = new Set(['SUCCESS','REJECTED'])` 显式 completedAt 白名单（镜像 withdraw :51 形状）。
- 钱的口径：冻结点**不放锁**；放锁只发生在 ①KYT 拒绝路径（`releaseBirthLock` :814 调用**保留**）②Task 3 的拒退批准落地。

- [ ] **Step 1: 改写既有断言（先红）**——`swap-transactions.service.spec.ts` 逐条：`:742 'FROZEN 不进 SWAP_TERMINAL_STATUSES'` 保留（服务端语义不变？——**注意**：服务端 `SWAP_FREEZE_SCAN_EXCLUDED` 里 FROZEN 仍排除、语义不变，该用例照旧）；**`:770 'FROZEN 零出边'` 改写为**"FROZEN 仅 RESUME/REJECT_REFUND 两条合法出边，其余动作抛 Invalid transition"；`:760/:784/:797` 保留；`describe(:472 '响应体：FROZEN 收敛成 REJECTED')` 整组改写为"收敛成 COMPLIANCE_PENDING"（含 :473 直断言、:527 展开集合、:538 防漂移）；新增 completedAt 白名单用例："FROZEN 行带脏 completedAt → 客户视图强制 null；SUCCESS/REJECTED 透传"。
- [ ] **Step 2**: 跑两个 spec 确认目标用例红。
- [ ] **Step 3: 实现状态机与收敛**——枚举加两成员；迁移表 `FROZEN` 行填两条边；`toCustomerSwapStatus` 的 FROZEN 分支 `return SwapTransactionStatus.COMPLIANCE_PENDING;`；新增 `SWAP_CUSTOMER_COMPLETED_STATUSES` 并在 `toCustomerSwapView` 里 `completedAt: SWAP_CUSTOMER_COMPLETED_STATUSES.has(customerStatus) ? item.completedAt : null`（镜像 `withdraw-transactions.service.ts:448`）；dto :17-21 注释改写（不再"零出边终态"，写明中间态语义+2026-09-14 裁定引用）；`SWAP_FREEZE_SCAN_EXCLUDED` 排除集成员不变、注释理由改写为"已冻无需再冻"；`decideVerdictLanding`/`applyKytVerdict` 的 FROZEN 幂等闸注释同步（行为不变——迟到裁决对 FROZEN 单仍 IGNORE）。
- [ ] **Step 4: 撤两处冻结放锁**——`swap-workflow.service.ts:1153`（disposition FREEZE 后 `released = await this.releaseBirthLock(...)`）与 `:1846`（广播冻结后同调用）连同其 `releasedFromAmount` metadata、审计 reason 里 "— sell-side birth lock released to balance" 尾巴一并移除（audit reason 改为 "— sell-side birth lock HELD pending disposition"）；`:814` KYT 拒绝路径的 `releaseBirthLock` **不动**。`releaseBirthLock` 方法本体保留（Task 3 拒退用）。
- [ ] **Step 5: 改写 workflow 侧断言**——`swap-workflow.service.spec.ts` `describe(:2346 'FROZEN 落地')` 与 `describe(:2594 'onCustomerRestrictionOpened')`：凡断言"冻结后调 releaseBirthLock / reason 含 released"的翻转为"**不**调 releaseBirthLock / reason 含 HELD"；其余（良性竞态、IGNORE 幂等、ADMIN_SUSPENSION 不冻、PROCESSING 不动）保持。
- [ ] **Step 6**: 两 spec 全绿 + `npx jest src/modules/trading/swap-transactions` 全绿；随手闸；commit `feat(波五T2): swap FROZEN 中间态——两出边+押锁+客户面收敛 COMPLIANCE_PENDING`。

收尾过闸行：新结局两条边（迁移表显式）✓｜SLA：FROZEN 不入 `SWAP_SLA_MINUTES_BY_STATUS` 表=不计时（与充提一致，`resolveSlaFields` 自动 null，验证一条断言即可）✓｜客户面当场决定（收敛映射+completedAt 白名单）✓。

---

### Task 3: swap 解冻 + 拒退审批全链（后端，逐字镜像 withdraw）【评审升档 opus】

**Files:**
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`（`ApprovalActionTypes` :49-51 邻域加 2 常量；`DEFAULT_APPROVAL_POLICIES` :316-329 邻域加 2 策略）
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts`（新增 4 方法 + 审批回调接线）
- Modify: `src/modules/trading/swap-transactions/swap-transactions.controller.ts`（2 端点）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（2 权限组四处：类型/route()/桶/职务）
- Modify: `scripts/verify-rbac.ts`（`MAKER_GROUP_BY_POLICY` :256-257 邻域加 2 行）
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（`V6_SWAP_AUDIT_ACTIONS` :822-854 加 4 码）
- Modify: `admin-web/src/pages/approvalEntityRoutes.ts`（2 新审批类型的跳转行）
- Test: `swap-workflow.service.spec.ts`

**Interfaces:**
- Produces（照 withdraw 模板逐字对齐，模板行号在括号里）：
  - `ApprovalActionTypes.SWAP_UNFREEZE = 'SWAP_UNFREEZE'`、`SWAP_SANCTION_REFUND = 'SWAP_SANCTION_REFUND'`（模板 :51/:327）；策略均 `steps:[{stepNo:1, roles:['MLRO']}], timeoutHours:48, allowCancel:true`（模板 :322-329）
  - `POST /admin/swap-transactions/:id/unfreeze`（权限码 `SWAP_UNFREEZE_WRITE`）、`POST /admin/swap-transactions/:id/refund`（`SWAP_REFUND_WRITE`）——路径前缀带 `/admin`（swap controller 既有 `@Controller('admin/swap-transactions')` :28）
  - workflow：`initiateUnfreeze(swapId, {orderRef, reason}, actor)`（镜像 withdraw :2022-2084：校验 FROZEN、防重、`createAndSubmit`、审计 `SWAP_UNFREEZE_REQUESTED`）；`onUnfreezeApproved(swapNo, approvalNo, causationId)`（镜像 :2262-2293：FROZEN guard → `markStatus(RESUME)` → 审计 `SWAP_UNFROZEN`（requiredFields `approvalNo`、requiresCausation true）→ `triggerUnfreezeRescore`；**零记账**——锁押着没动过）；`triggerUnfreezeRescore(swap)`（镜像 :2229-2245，best-effort rescore `swap.sumsubTxnIdOut`；若 swap-workflow 未注入 rescore 客户端，按 withdraw 同一 provider 注入）；`initiateRefund(swapId, {reason}, actor)` + `onRefundApproved(swapNo, approvalNo, causationId)`（镜像 :2097/:2328-2357：`markStatus(REJECT_REFUND)` → `releaseBirthLock(swap, 'Sanction refund approved')` → 审计 `SWAP_REFUNDED`（requiredFields `fromStatus`,`toStatus`））
  - 审批回调接线：withdraw 的 `onUnfreezeApproved/onRefundApproved` 由哪条事件/handler 触发，grep `WITHDRAW_UNFREEZE` 在 `withdraw-workflow.service.ts`/governance 侧的消费点后**同构接线**（同一分发器加 SWAP 两 case）
  - rbac 四处：`PermissionGroup` 联合类型加 `SWAP_UNFREEZE_WRITE`/`SWAP_REFUND_WRITE`；`route()` 两行（镜像 :357-358 写法）；桶 `trading.act_swap_unfreeze`/`trading.act_swap_refund`（镜像 :868-869）；持有：`COMPLIANCE_OFFICER` += SWAP_UNFREEZE_WRITE（镜像 :1019 注释口径"提解冻"）、`OPS_OFFICER` += SWAP_REFUND_WRITE（镜像 withdraw refund 持有人）
  - `MAKER_GROUP_BY_POLICY` 加 `SWAP_UNFREEZE: 'SWAP_UNFREEZE_WRITE'`、`SWAP_SANCTION_REFUND: 'SWAP_REFUND_WRITE'`
  - `approvalEntityRoutes.ts` 加 `SWAP_UNFREEZE`/`SWAP_SANCTION_REFUND` → `/admin/trading/swaps/${r}`（直达，Task 9 换键后 r=swapNo 天然成立）

- [ ] **Step 1: 失败测试**——`swap-workflow.service.spec.ts` 新增 describe（mock 风格照该文件 `FROZEN 落地` 组）：①`initiateUnfreeze` 非 FROZEN 抛、FROZEN 开审批+写 `SWAP_UNFREEZE_REQUESTED`；②`onUnfreezeApproved` → RESUME 落 COMPLIANCE_PENDING + `SWAP_UNFROZEN` 带 approvalNo + 调 rescore + **不调 releaseBirthLock**；③`initiateRefund`/`onRefundApproved` → REJECT_REFUND 落 REJECTED + `releaseBirthLock` 恰被调一次 + `SWAP_REFUNDED` 带 fromStatus/toStatus；④防重：同单已有 open unfreeze 审批再发起 → 拒。
- [ ] **Step 2**: 确认红。
- [ ] **Step 3**: 按 Interfaces 逐处实现（常量→审计码注册→workflow 四方法→controller 两端点→rbac 四处→verify-rbac→approvalEntityRoutes）。审计码四属性出生登记齐全（domain:'SWAP'、correlationMode 照 withdraw 同名码抄、requiredFields 如上）。
- [ ] **Step 4**: jest 全绿；`npx tsc --noEmit -p tsconfig.json`（含 scripts 覆盖 verify-rbac）；admin-web tsc（approvalEntityRoutes）。
- [ ] **Step 5**: 栈上行为验证：`bash scripts/stack.sh up`（self），种子登录后对一张 FROZEN swap（可借 demo:all seq13 或手工 ⑦）走 unfreeze 提→MLRO 批→RESUME；refund 提→批→REJECTED+余额回补；`bash scripts/on-stack.sh self verify:coa` 绿。
- [ ] **Step 6**: commit `feat(波五T3): swap 解冻/拒退审批全链——SWAP_UNFREEZE/SWAP_SANCTION_REFUND 镜像提现`。

收尾过闸行：新审批策略→MAKER_GROUP_BY_POLICY ✓｜新权限组四处 ✓｜新 admin 端点→route()+（合并后）db:base:sync+重启 ✓｜新审计码四属性 ✓｜动钱→verify:coa ✓｜maker-checker 走 ApprovalsService 正门 ✓。

---

### Task 4: 创建即冻（提现 + 兑换；充值验证）【评审升档 opus】

**Files:**
- Modify: `src/modules/trading/withdrawal-fee-level/withdraw-quote-customer.controller.ts:42`、`src/modules/trading/withdraw-transactions/customer-withdraw.controller.ts:46`、`src/modules/trading/swap-transactions/swap-transactions-customer.controller.ts:46`（三处 `assertTradingEligibility` → `assertTradingIntake`）
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`（`createWithdrawal` :252 内 :274 纵深闸、:366-425 L1 BLOCK 分支、建单后冻结段）
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts`（`initiateSwap` :202 内 :205 闸、L1 分支、建单后冻结段、:526 返回前重取视图）
- Test: `withdraw-workflow.service.spec.ts`、`swap-workflow.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 `assertTradingIntake` / `intakeDecision`；Task 2 的 FROZEN 中间态。
- 行为定义（spec §2.1）：fold=true 时——报价照出；建单全流程照旧（含 TB pending 锁 / 出生锁）；建单事务提交后立即 `updateStatus/markStatus(FREEZE)` + 域内 `*_FROZEN` 审计（**镜像各域 `onCustomerRestrictionOpened` 冻结段的审计码与 requestId 形状逐字抄**，reason 写 "created by SILENT-restricted customer — folded at intake"）；创建响应回收敛视图（提现 COMPLIANCE_PENDING / 兑换 COMPLIANCE_PENDING，客户面即 Processing）。L1 快照照记 `CUSTOMER_RESTRICTION FAIL`；fold 放行仅当 **CUSTOMER_RESTRICTION 是唯一 FAIL**——还有别的 FAIL（资产停用等）走原 BLOCK 路（普通客户同款报错，无泄密）。原 `WITHDRAW_L1_BLOCKED` 审计只在真 BLOCK 时写（fold 不写）。
- 纵深闸处理：withdraw `:274 assertCapability` 与 swap `:205 assertTradingEligibility` 替换为 `intakeDecision`——DENY 抛原中性 403，ACCEPT_FREEZE 记 fold 标志传到建单后段。

- [ ] **Step 1: 失败测试**——两 workflow spec 各加 describe：①SILENT 客户（mock intakeDecision→ACCEPT_FREEZE）建单成功、终态 FROZEN、审计两条（建单族 + FROZEN）、响应 status 为收敛值；②DISCLOSED 客户建单仍抛 NEUTRAL_DENIAL；③SILENT 客户 + 资产 SUSPENDED → 照旧 BLOCK；④（withdraw）TB pending 两笔照压且 fold 后不放。
- [ ] **Step 2**: 确认红。
- [ ] **Step 3**: 实现三控制器 + 两 workflow。
- [ ] **Step 4**: jest 相关目录全绿；随手闸。
- [ ] **Step 5: 栈级验证（判例必做）**——self 栈上以 **Carol**（`demo_carol@example.com`，种子即 ACTIVE+SANCTION SILENT，`prisma/seed.business.ts:620-638`）客户端登录：①拿提现报价成功→建单→列表显示 Processing；②兑换同款；③管理台看两单 FROZEN + 审计链；④Carol 余额扣减与"处理中"自洽；⑤后端日志 `grep -c "Invalid prisma invocation"` 为 0；⑥Ivy（DISCLOSED）建单仍中性拒绝。截图落盘。
- [ ] **Step 6**: commit `feat(波五T4): 创建即冻——SILENT 客户报价放行+建单入库即冻,DISCLOSED 维持中性拒绝`。

收尾过闸行：持久状态变化写审计+requestId ✓｜改三域问另两域（充值零改动：L1 FREEZE 分支已覆盖，栈上用 Carol 收一笔模拟入金验证显示 Processing 即证）✓｜客户面当场决定（收敛视图）✓｜动钱→verify:coa（Task 13 统跑，本任务 self 栈先跑一轮）✓。

---

### Task 5: swap 硬/软线便签退役

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts`（`handleRejectDisposition` :1057-1096）
- Test: `swap-workflow.service.spec.ts`（含"命门"用例组同步）

**Interfaces:** `restrictionCause` 三分收敛为：`hasSanction → open({cause:'SANCTION'})`；否则**不调 `customerRestrictionsService.open`**。删除 `KYT_REJECTED_SOFT`/`KYT_REJECTED_HARD` 两路及 `alreadyHardLined→cause` 的耦合（`exposeToCustomer` 判定与 `markHardLineDisposition` sticky **原样保留**——它们管补料入口暴露，不管便签）。保留物清单（评审逐条核）：注册表两因由、`RestrictionOpenModal` 手工下拉、`customer-restriction-workflow.service.ts:143` MLRO+文书号解除、充值域消费外来硬线便签的 scope 判定及其测试（`deposit-workflow.service.spec.ts:406-413`）、`applicant-action.handler.ts:65` 补料静默。

- [ ] **Step 1: 失败测试**——改写既有断言"⑨/⑪ 落地开 KYT_REJECTED_* 便签"为"**不开任何便签**"；新增：①⑨（FROZEN_BY_MLRO）→ 冻单 + `open` 零调用 + sticky 照打；②⑪（no tag）→ REJECTED + `open` 零调用 + sticky 照打；③⑦ → `open({cause:'SANCTION'})` 照旧；④"命门"组（`hasApplicantSanctionHit` 判据）逐条过、按新语义修断言。
- [ ] **Step 2**: 红 → **Step 3** 实现 → **Step 4** jest 全绿+随手闸。
- [ ] **Step 5**: 栈上逐字验收：⑨/⑪ 按下后 `customer_restrictions` 表零新行、材料请求表零新行（SQL count 前后对比）。
- [ ] **Step 6**: commit `feat(波五T5): swap 拒绝处置只开 SANCTION 便签——硬/软线 open 退役,sticky 静默保留`。

收尾过闸行：退役业务动作→前端入口检查（硬线便签无自动入口、手工下拉按裁定保留——零删）✓｜改三域问另两域（充提本就不开，改后三域同型）✓。

---

### Task 6: 管理台 swap FROZEN 动作 UI + 状态表

**Files:**
- Modify: `admin-web/src/utils/swapStatusMap.ts`（:54-71 终态集合、FROZEN 注释）
- Modify: `admin-web/src/pages/SwapTransactionDetail.tsx`（:280 isTerminal、新增 Frozen Disposition 区）

**Interfaces:** Consumes Task 3 两端点。`SWAP_TERMINAL_STATUSES` 里删 `'FROZEN'`；`SwapTransactionDetail` 新增 `data.status==='FROZEN'` 分支区，**逐字镜像** `WithdrawTransactionDetail.tsx:654-683`（"Initiate Unfreeze" 弹窗 POST `/admin/swap-transactions/${data.id}/unfreeze` body `{reason, orderRef}`；"Reject & Refund" 弹窗 POST `.../refund` body `{reason}`；按钮仅按 status 显隐、权限由后端 403 兜底——与提现同款写法）。

- [ ] **Step 1**: 实现两文件。 **Step 2**: `cd admin-web && npx tsc -b --noEmit`。
- [ ] **Step 3**: preview 截图：FROZEN 单详情出现动作区；走一遍解冻提→审批页出现 SWAP_UNFREEZE 单→MLRO 批→单回 COMPLIANCE_PENDING。
- [ ] **Step 4**: commit `feat(波五T6): swap 详情 FROZEN 动作区+终态集合摘除 FROZEN`。

收尾过闸行：新业务动作前端有入口 ✓｜改前端→截图 ✓。

---

### Task 7: D10 · L1 因由 + 便签号（管理台）

**Files:**
- Modify: `src/modules/trading/shared/l1-gate/l1-gate.service.ts`（②格 detail，:109-117）
- Test: `l1-gate` 现有 spec（同目录）

**Interfaces:** Consumes Task 1 `access.blockingNotes`（**不能**用 `access.disclosed`——SILENT 不在里面，管理台会看不到制裁因由）。detail 文案：FAIL 时 `` `Customer restriction holds down ${capability} — ${notes.map(n => `${n.cause} (${n.restrictionNo})`).join('; ')}` ``（notes = blockingNotes 里 capability 匹配的行）。前端 `L1GateCard.tsx` 逐字回显 detail，零改动。客户面零暴露：L1 快照不在三域客户视图白名单（Task 内加一条断言钉死：客户视图序列化结果无 `l1` 键）。

- [ ] **Step 1**: 失败测试：制裁客户 evaluate → ②格 detail 含 `SANCTION (CR-…)`；无限制 → 原 PASS 文案不变。 **Step 2**: 红→实现→绿；随手闸。
- [ ] **Step 3**: preview 截图：管理台 FROZEN 单详情 L1 卡 ②格露因由+便签号。
- [ ] **Step 4**: commit `feat(波五T7): L1 ②格带因由+限制便签号(管理台),客户面零暴露断言`。

---

### Task 8: 客户端词表统一 + 共享徽章

**Files:**
- Create: `client-web/src/components/StatusBadge.tsx`
- Modify: `client-web/src/utils/swapStatusView.ts`（接口对齐 + 词表）、`swapStatusView.spec.ts`（**重写大小写断言**）
- Modify: `client-web/src/pages/Swap.tsx`（:575-582 徽章、:893-895 筛选 option 文案）、`Deposit.tsx:369-378`、`Withdraw.tsx:446-455`（换用 StatusBadge）
- Modify: `admin-web/src/utils/withdrawStatusMap.ts:56`（'ACTION PENDING' → 'AWAITING CUSTOMER'）

**Interfaces:** `SwapStatusView` 重构为与 `DepositStatusView` 同形 `{ label: string; note?: string; tone: 'neutral'|'positive'|'warning'|'danger' }`；词表：COMPLIANCE_PENDING/PROCESSING→`PROCESSING`(neutral)、SUCCESS→`SUCCESS`(positive)、REJECTED→`DECLINED`(danger)、default→`PROCESSING`；`StatusBadge` 组件签名 `({ view }: { view: { label: string; tone: … } })`，样式取充提现行 span（`uppercase font-semibold` 全套）；三页替换为 `<StatusBadge view={view} />`（充提视觉零变化，swap 向其看齐）。头注三规则（tipping-off 词禁令）逐字保留并把 FROZEN 收敛新语义写入。`swapStatusView.spec.ts:65-71` "绝不全大写"断言**改写为**充提同款 "every badge label is fully uppercase"（`depositStatusView.spec.ts:80-85` 形状）；:26-27 期望值改 `['SUCCESS','SUCCESS']`/`['REJECTED','DECLINED']`。Swap.tsx 筛选 option：value 不动（SUCCESS/REJECTED），显示文案改 `Success`→按下拉惯例 `SUCCESS`/`DECLINED`。

- [ ] **Step 1**: 改 spec 断言（先红）→ `npm run test:client` 红。 **Step 2**: 实现四文件 + admin 一行。 **Step 3**: `npm run test:client` 全绿 + 双前端 tsc。
- [ ] **Step 4**: preview 截图：三页徽章同款大写；swap 历史列表 DECLINED/SUCCESS；admin 提现列表 AWAITING CUSTOMER。
- [ ] **Step 5**: commit `feat(波五T8): 客户端词表统一 SUCCESS/DECLINED+共享 StatusBadge;admin AWAITING CUSTOMER 对齐`。

收尾过闸行：改前端→截图 ✓｜词表连坐 grep（`grep -rn "Completed\|Unsuccessful" client-web/src admin-web/src` 仅剩时间戳 label 噪音命中，报告列出）✓。

---

### Task 9: 三域详情路由换业务号 + 审计/审批跳转直达

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.controller.ts:114`、`withdraw-transactions.controller.ts:58`、`swap-transactions.controller.ts:114`（GET 详情 `:id`→业务号参数 + resolve 私有方法）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts:307,355,383`（route() 路径串同步）
- Modify: `admin-web/src/App.tsx:206,208,210`（`:id`→`:depositNo/:withdrawNo/:swapNo`）
- Modify: 三详情页 `useParams`+fetch（`DepositTransactionDetail.tsx:204,234`、`WithdrawTransactionDetail.tsx:173,201`、`SwapTransactionDetail.tsx:164,184`）
- Modify: 10 处入站链接（清单见 Step 3）
- Modify: `admin-web/src/pages/auditEntityRoutes.ts:8-10`（三行升直达）、`approvalEntityRoutes.ts:19-25`（7 行 keyword 升直达）

**Interfaces:** 后端照客户域模板（`customers.controller.ts:48-54` `resolveCustomerId`）：`@Get(':depositNo')` → `resolveDepositId(depositNo)`（用既有 `findOneByNo`/`findByNo` 族查号取 id，404 中性）→ 调旧 `findOne(id)`；service 签名不动。**动作端点仍收 `:id`**（详情页动作调用一律用响应体里的 `data.id`，铁律⑥管展示不管 API 参数——与客户域同口径）。前端 useParams 名随路由换；fetch URL 拼业务号。10 处链接换拼业务号字段，逐处核实数据源带不带号、不带则后端 select 补（波四判例：改 select 必栈验）：`DepositTransactionList.tsx:343`、`WithdrawTransactionList.tsx:339`、`SwapTransactionList.tsx:370`（列表行必有号）；`FundsOrderDetail.tsx:159,167,175`（`data.deposit/withdrawTransaction/swapTransaction` 各补 `…No`）；`ReconciliationCasesDetailPage.tsx:1586,1588`（`supplementRef` 补号）；`WithdrawQuoteDetail.tsx:257`、`SwapQuoteDetail.tsx:292`（linked 单补号）。`auditEntityRoutes` 三行改 `` (no) => `/admin/trading/deposits/${no}` `` 等；`approvalEntityRoutes` 7 行按各审批类型 orderRef=业务号升直达（升级判据：orderRef 存的是单号才升，执行时逐类型核对 `fetchApprovedOrderRef` 族写入值；核不实的保持 keyword 并在报告点名）。

- [ ] **Step 1**: 后端三 controller + catalog；jest 相关（controller 层若无既有 spec 则以栈验为准）；tsc。
- [ ] **Step 2**: 前端路由+详情页+10 链接；admin tsc。
- [ ] **Step 3**: 判例连坐全量 grep（按路径段拆词）：`grep -rn "trading/deposits/\|trading/withdrawals/\|trading/swaps/" admin-web/src scripts doc-final/demo`——除本任务已改处零残留 `.id` 拼接；`grep -rn "deposit-transactions/\${\|withdraw-transactions/\${\|swap-transactions/\${" admin-web/src` 核动作端点仍用 `data.id`。
- [ ] **Step 4**: 栈验+截图：列表点入详情 URL 显业务号；审计页三域单号点击直达详情；审批页 SWAP_UNFREEZE 单直达；funds order / 对账案 / 报价详情四处互链可点。
- [ ] **Step 5**: commit `feat(波五T9): 三域详情路由换业务号(照客户域模板)+审计/审批跳转升直达`。

收尾过闸行：对外用业务键 ✓｜新端点路径→route() 同步+（合并后）db:base:sync ✓｜改前端→截图 ✓。

---

### Task 10: 前端收口杂项

**Files:**
- Modify: `admin-web/src/pages/FundsOrderDetail.tsx`（类型 :82-91 七字段 + 渲染 :550-570、:675-682 删）
- Modify: `admin-web/src/utils/slaDisplay.ts:20-27`、`admin-web/src/utils/incidentStatusMap.ts:85-97`（"0m"→"<1m"）
- Modify: 分页收口清单（Step 3）

**Interfaces:** ①FundsOrderDetail 删 confirmations/blockNo/nonce/gasUsed/effectiveGasPrice/sentAt/confirmedAt 的类型声明与两卡渲染（On-chain 卡若删空则整卡删；删前逐字段 `grep -rn "<字段名>\s*:" src/modules/funds-orders` 复核零赋值，发现真实赋值路径则该字段保留并报告——spec §6 勘误纪律）。②`formatSlaRemaining` 尾行改 `` return { text: totalMinutes <= 0 ? '<1m' : `${minutes}m`, tone: 'normal' } ``；incidentStatusMap 双胞胎同改；有 spec 守护则断言同步。③分页：23 个裸 `<Pagination` 文件中，凡"手写 Showing X of Y 计数 + Pagination"重影形状且 props 可直映 `ListFooter`（`filteredCount/total/noun/currentPage/pageSize/onPageChange`）的换 `ListFooter`；布局特殊映不上的**保留并列清单**进任务报告（不硬套）；`ListFooter.tsx:7-12` 头注的"12 个"登记随之改写。文件清单（实测 23 命中，执行按此逐个判）：WithdrawQuoteList/SumsubEventsPage/TransferEvidenceList/AccountFlowList/EvidenceExportsPage/SwapQuoteList/InternalTransferList/RoleChangeRequestsPage/LedgerAccountList/ReconciliationCasesListPage/SwapFeeLevelList/AuditLogsPage/CustomerManagement/WithdrawalFeeLevelList/RoleDefinitionModifyRequestsPage/WithdrawalAddressList/CustodianWalletList/FundsOrderList/ReconciliationRunsListPage/IncidentListPage/AssetList/ReconciliationAdjustmentListPage/ApprovalsPage。

- [ ] **Step 1**: ①②实现+tsc。 **Step 2**: ③批量收口（可再派 sonnet 子批）。 **Step 3**: preview 抽样截图：FundsOrderDetail 无恒空卡；SLA 列出现 `<1m`；换了 ListFooter 的 3 个页分页正常。
- [ ] **Step 4**: commit `feat(波五T10): 恒空链上字段删除+SLA <1m+分页 ListFooter 收口`。

---

### Task 11: demo 语义与站级剧本

**Files:**
- Modify: `scripts/demo-roster.ts:77`（seq13 label"零出边"→"押锁待处置"语义）、`scripts/demo-lib.ts:420-422`（注释随实改）、`scripts/demo-swap.ts:902-911`（seq13 断言维持 FROZEN，追加断言：该单出生锁仍在=Carol 侧 available 扣着，按 demo-swap 既有余额断言手法）
- Modify: `doc-final/demo/script.md`（:56-76 三/四/五幕站级化 + :67 旧口径改写）、`doc-final/demo/data.md`（手写区核对；生成区不手改）

**Interfaces:** script.md 三幕改为站级小节（`### 站 3.1 <名>` 一站=动作+截图判据一句），现有 ①-⑥ 步逐个升站；新增站：三/五幕各 1 站「Carol（SILENT）创建即冻——客户端 Processing/管理台 FROZEN」（用 Task 4 已验流程）、四幕加「兑换解冻审批闭环」与「⑨=调查扣审 vs ⑦=制裁冻结 两制度讲词」、:67 改写为"冻结押锁待处置（解冻续走/拒退还款），2026-09-14 裁定"。
- [ ] **Step 1**: scripts 三件改+`bash scripts/on-stack.sh self demo:all` 全绿。 **Step 2**: script.md/data.md 改写。 **Step 3**: commit `docs(波五T11): demo 冻结语义随翻案改+三幕剧本站级化`。

---

### Task 12: 文档收口 + 销案

**Files:** `doc-final/decisions.md`｜`doc-final/BACKLOG.md`｜`doc-final/modules/v4-deposit.md`/`v5-withdraw.md`/`v6-swap.md`｜`doc-final/modules/overview.md:96`｜`doc-final/CHANGELOG.md`

- [ ] **Step 1**: decisions.md 五条（spec §1 之 1/2/3/4/6；翻案条写明被翻的 2026-08-20 原裁定+新事实）。
- [ ] **Step 2**: BACKLOG：§F Q1 以"已实现"销（链 decisions）；§D CAPABILITY_RESTRICTED 条改写（管理台侧已解决、客户面刻意保持）；G1 表述按向下拉平收束。
- [ ] **Step 3**: modules 三篇：v6 状态机 5 态 7 边 + 客户可见性(FROZEN→Processing) + 审计码 22→26 + 面板按钮语义（⑨ 调查扣审）；v4/v5 客户可见性节补"创建即冻"；overview.md:96 状态机行同步。
- [ ] **Step 4**: CHANGELOG 一行。commit `docs(波五T12): decisions 五定案+BACKLOG 销账+modules 三篇+CHANGELOG`。

---

### Task 13: 收尾闸 + 合并 + 战役收官

- [ ] **Step 1**: worktree 内收尾闸：`bash scripts/on-stack.sh self demo:all`（断言终态）→ `verify:coa` → `bash scripts/stack.sh reset self` 重铺后再 demo:all（判据对照 `demo/baseline.md` 全绿）。
- [ ] **Step 2**: 按站级剧本三幕完整走查 + `scripts/demo-shot.js` 逐站截图，产物归档。
- [ ] **Step 3**: 终审（Fable，主会话）：对照 spec §1 台账逐条问"承诺的代码在哪"（判例：spec 承诺无 diff 抓不到）。
- [ ] **Step 4**: 合并 main（先并 main 进分支重跑随手闸，再快进）；主树 `npm run db:base:sync` + 重启后端；动过 seed → `bash scripts/stack.sh reset main` + main 栈 demo:all。
- [ ] **Step 5**: 战役收官：本波 spec+plan、总纲 `2026-09-09-acts345-trading-campaign-charter.md`、历波 specs 移 `doc-final/archive/`；清 worktree+分支；`Documentation updated:` 一行汇报。

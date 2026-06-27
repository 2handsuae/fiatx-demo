# V4 充值 / V5 提现 — 三层规范彻底收敛 + 余额锁漏洞修复

> 状态：设计基线（pre-implementation），已与用户逐段确认
> 日期：2026-06-27
> 适用：V4 deposit-transactions/payins、V5 withdraw-transactions/payouts；**不动 V7 funds-layer 活逻辑**
> 验收闸：`npm run demo:all` + `npm run verify:coa` + `jest`（main 栈 3000–3003）

---

## 0. 一句话目标

让充值、提现两条资金流各自收敛成**干净三层**——每条流只有一个 workflow 当家（L3），domain 只管存数据（L1），**记账与业务审计的所有权全部回到 workflow**；同时堵掉提现"异常终态不解锁、客户余额永久卡死"的真漏洞。

---

## 1. 背景：已核实的问题清单

### V4 充值
- **P1（真违规）** `deposit-transactions.controller.ts` 的 `@Patch(':id/status')` 直插 `service.updateStatus()`，**绕过 `DepositWorkflowService`**，跳过 TB 记账 + 业务审计。代码内有 `// TODO: Route ... through DepositWorkflowService` 自认。
- **P2（偏离）** `PayinsService`（domain）自己写业务审计（`PAYIN_CREATED` + 状态流转）。

> V4 的 deposit 侧本身较干净：建单审计已在 `DepositWorkflowService.orchestratePayinDetected()`（workflow）写，`createFromPayin()` 是纯插入。问题集中在 P1/P2。

### V5 提现
- **P3（L1/L3 边界破裂）** `WithdrawTransactionsService.create()`（domain）内嵌：TB 余额锁定（两笔 pending）+ TB 补偿（Prisma 回滚后 void 孤儿 pending）+ 写 `WITHDRAW_REQUESTED` 审计。这些都是 workflow 职责。
- **P4（三头编排）** 一条提现旅程被劈成三个 service：
  - `WithdrawWorkflowService`（新，实时 1:1，LIVE 主力）
  - `WithdrawWorkflowOrchestrator`（`orchestrators/`，半死：仍做来源钱包绑定 / payout 创建兜底 / payout 失败补偿 / 两个修复入口，但 TB 记账被掏空为 "V2 accounting removed" 注释）
  - `WithdrawTransactionWorkflowService`（注册并导出，但 `.execute()` **零调用 = 死代码**）
- **P5（双事件命名空间）** 同一生命周期同时用 `DomainEventNames.WITHDRAWAL_*`（喂新 workflow）与 `WithdrawEvents.EVT_WITHDRAWAL_*`（喂死 orchestrator）。
- **P6（资金漏洞，本轮升级为必修）** 全仓只有两处 void 解锁 TB pending：① 大额审批被拒（`WithdrawWorkflowService.voidWithdrawPending`）；② 建单时 Prisma 回滚补偿（`create()` catch）。**payout FAILED/TIMEOUT/RETURNED，以及合规阶段管理员 REJECT，均无任何 TB void**——orchestrator 的补偿路径已被掏空。后果：这些异常一旦发生，客户被锁余额**永久卡死**。与 roadmap V5「REJECTED / 链上失败 / 银行退回」分支标 `[ ]` 未实现吻合。

---

## 2. 范围边界（Goals / Non-Goals）

**做：**
- V5 三个编排 service 收敛为 1 个干净 L3 + 1 个纯 L1 domain + 既有 L2 审批（`WithdrawLargeValueApprovalService` 不动，已达标）。
- 「建提现单 + 锁余额」原子事务的**所有权上提到 workflow**（workflow 开 `$transaction`，内调 domain 纯插入 + accounting 锁定 + 首条审计）。
- 新增统一解锁闸 `releaseLock()`，覆盖所有解锁型终态 → **堵 P6 漏洞**。
- 删死代码（`WithdrawTransactionWorkflowService` 整文件）、删死 orchestrator（整文件，职责已吸收）。
- 事件命名空间清理（见 §5，精确边界）。
- V4：堵控制器裸绕过（P1）、把 `PayinsService` 正式归类为 ingestion-adapter（P2）。

**不做（本轮明确不碰）：**
- **V7 funds-layer 任何活逻辑 / 结算**（用户已实时结算，V7 延迟结算体系待 Phase C 清）。本轮对 V7 的唯一触碰是**删除两个已 neuter 的 no-op 监听 handler**（见 §5），不动 fiat-settlement 等活代码。
- V4/V5 **未实现的异常分支功能**（充值 FROZEN→MLRO、没收、链上失败回退等）——那是功能不是违规，不在本轮。
- `WithdrawLargeValueApprovalService`（L2，已是教科书级，不动）。

---

## 3. 目标架构（收敛后）

```
                          L3 Workflow（当家）         L1 Domain（纯持久化）        L2 Approval
V4 充值  DepositWorkflowService            DepositTransactionsService       （无，自动放行）
         + PayinsService 标注为 ingestion-adapter（探测层，允许 emit/审计）
         控制器：动作走 workflow 命名方法 + domain source 闸拦截危险终态

V5 提现  WithdrawWorkflowService（唯一）    WithdrawTransactionsService      WithdrawLargeValueApprovalService
         - 建单+锁钱（同步原子事务，workflow 持有）  - 状态机 transitions          （不动）
         - 估值 / 大额审批门 / 合规扫描              - 查询 / 字段更新 / 状态历史
         - 建 payout + fee 资金单                  - 纯插入 insertRecord(tx)
         - 来源钱包绑定（吸收自 orchestrator）       - 不碰记账、不写业务审计、
         - finalize / success                       不发 EVT_*
         - 失败补偿 + releaseLock（堵 P6）
         - 修复入口 reCloseout/reCompensate（吸收）
```

---

## 4. V5 提现 — 详细设计

### 4.1 建单 + 锁钱：所有权上提到 workflow（保原子）

- `CustomerWithdrawController.create()` 与 admin 创建入口，改调 **`WithdrawWorkflowService.createWithdrawal(dto, userId, ownerType)`**（同步，返回提现单给前端）。
- `createWithdrawal()` 内部：
  1. 校验资产 / 客户可交易门（`ensureCustomerCanTransact`）/ 报价一致性（沿用现 `create()` 内逻辑，迁入 workflow）。
  2. 开 `prisma.$transaction`：
     - `withdrawService.insertRecord(tx, {...})` —— **纯插入**，返回 record（不发事件、不写审计、不碰 TB）。
     - `accountingService.executePendingTransfer(...)` × 2（net + fee 锁，`CLIENT_PAYABLE→CLIENT_ASSET`）—— workflow 直接调 accounting。
     - 回写 `tbPendingNetId / tbPendingFeeId`。
     - `auditLogsService.recordByActor(WITHDRAW_REQUESTED, ..., tx)` —— 首条审计由 workflow 写。
  3. tx 失败 → catch 内 `voidPendingTransferBestEffort` 补偿孤儿 TB pending（迁自现 `create()` catch，逻辑不变）。
  4. 提交后 emit `DomainEventNames.WITHDRAWAL_CREATED` → 进入既有事件驱动后续（估值→审批门→合规→payout→finalize）。
- **原子性不变、无 double-spend 窗口**；domain 不再持有 accounting/审计。

### 4.2 domain 瘦身：`WithdrawTransactionsService` 回归 L1

**删除**：`create()` 内的 TB 锁定 + 补偿 + `WITHDRAW_REQUESTED` 审计；`updateStatus()` 内所有 `EVT_WITHDRAWAL_*` 发射（保留两个 V7 SUCCESS 钩子的处置见 §5）。
**保留 / 新增**：状态机 `transitions`、`getNextStatus` 等价校验、查询（findAll/findOne/findOneInternal）、字段更新（updateKytStatus/updateTravelRuleStatus/linkPayout/linkApprovalCase/saveValuationSnapshot/findCustomerWallet）、状态历史、`assertStatusUpdateSourceAllowed`（source 闸保留）。新增纯插入 `insertRecord(tx, data)`。
domain 仍可 emit **自身实体状态变化**的 `DomainEventNames.WITHDRAWAL_KYT_UPDATED / WITHDRAWAL_TRAVELRULE_UPDATED`（符合"domain 可发自身状态事件"规则）。

### 4.3 吸收 orchestrator 的活职责进 workflow

`WithdrawWorkflowService` 新增 / 接管：
- **来源钱包绑定** `ensureSourceWalletBound`（crypto=客户 C_DEP；fiat=平台 C_CMA，原逻辑迁入，不改语义）。在 `initiatePayoutPhase` 前置完成，消除现注释承认的"orchestrator 异步绑定竞态"。
- **payout 失败补偿**：订阅 `PayoutEvents.EVT_PAYOUT_FAILED / EVT_PAYOUT_TIMEOUT / EVT_PAYOUT_RETURNED` → 翻 withdraw 到 FAILED/RETURNED + **`releaseLock()`** + 审计。
- **修复入口** `reCloseoutPayout(payoutId)` / `reCompensatePayout(payoutId)` 迁入 workflow；`orchestrators/payout-closeout-repair.controller.ts` 重接到 `WithdrawWorkflowService`。
- 删 `orchestrators/withdraw-workflow.orchestrator.ts` 整文件 + `workflows.module.ts` 注销。（其内 `journal/clearing` V2 残留逻辑一并废弃，本就已 gutted。）

### 4.4 统一解锁闸 `releaseLock()`（堵 P6）

```
private async releaseLock(w, reason):
  - 若 tbPendingNetId → voidPendingTransferBestEffort(net)，失败打 CRITICAL
  - 若 tbPendingFeeId → voidPendingTransferBestEffort(fee)，失败打 CRITICAL
  - fundsFlowService.setWithdrawFeeFundStatus(w.id, CANCELLED, reason)
  - 写 WITHDRAW_LOCK_RELEASED 审计（新 action）
```
调用点（**所有解锁型终态唯一出口**）：
- 大额审批被拒（替换现 `voidWithdrawPending`，合并去重）。
- 合规阶段 / admin **REJECT**。
- payout **FAILED / TIMEOUT / RETURNED**。
- **CANCELLED**（若可达）。
> 幂等：void best-effort 对已 void/已 post 的 pending 安全无害；二次调用不产生重复资金动作。

### 4.5 删死代码
`WithdrawTransactionWorkflowService`（`.execute()` 零调用）整文件删 + `withdraw-transactions.module.ts` 注销 + 导出移除。其依赖的 risk-engine 复核常量若无其他引用，留给后续（不在本轮删 risk-engine）。

---

## 5. 事件命名空间清理（精确边界，V7 活逻辑零改动）

逐事件核实后的处置：

| 事件 | 现订阅者 | 处置 |
|---|---|---|
| `EVT_WITHDRAWAL_CREATED / CANCELLED / REJECTED / APPROVED__CRYPTO / APPROVED__FIAT` | 仅死 orchestrator | **删**（随 orchestrator） |
| `EVT_WITHDRAWAL_FAILED / RETURNED__FIAT` | 无人订阅 | **删** |
| `EVT_WITHDRAWAL_SUCCESS__CRYPTO` | `FeeAccrualListenerService`（**已 neuter，body 仅 `return;`**，注释 "remove in Phase C"） | 删事件 + 删该死 handler |
| `EVT_WITHDRAWAL_SUCCESS__FIAT` | `FiatFeeCollectionWorkflowService.onFiatWithdrawalSucceeded`（**已 neuter，body 仅 `return;`**） | 删事件 + 删该死 method（**保留类**，因 `fiat-settlement-workflow` 仍注入它） |

落地动作：
- `withdraw-events.constant.ts` 整套即 EVT 命名空间 → **整文件删除**。
- domain `updateStatus()` 不再发任何 EVT_*；提现生命周期统一走 `DomainEventNames.*`。
- `FeeAccrualListenerService`：两个 handler 均为 no-op，整类删 + `funds-layer.module.ts` 注销。
- `FiatFeeCollectionWorkflowService`：**只删 `onFiatWithdrawalSucceeded` 死方法**，类保留（V7 fiat-settlement 仍依赖注入）。
- **对 V7 的触碰仅限删除上述确认死掉的 handler，不动任何 V7 活逻辑/结算。**

---

## 6. V4 充值 — 详细设计

### 6.1 堵控制器裸绕过（P1，照搬 V5 成熟做法）
- `deposit-transactions.controller.ts` 的 `@Patch(':id/status')`：能走 workflow 的动作路由到 `DepositWorkflowService` 命名方法（approve→已有 `approveDeposit`；reject/freeze 等加薄 workflow 方法写审计）。
- 在 `DepositTransactionsService` 加 **source 闸**（对齐 V5 `assertStatusUpdateSourceAllowed`）：**禁止 ADMIN_API 直接推到需 TB 记账的终态**（尤其 `SUCCESS`），强制走 workflow；尚无 TB 设计的动作显式报错而非静默跳过记账。
- 删除控制器内 `// TODO` 注释。

### 6.2 Payin 归类为 ingestion-adapter（P2）
- 在 `PayinsService` 顶部加定位声明注释：**本服务是入款轨道的 ingestion/adapter 层**（检测链上/银行入款 → 归一成内部事件），后端规则允许 ingestion 层 emit 事件；其 `PAYIN_CREATED` + 状态流转审计作为"轨道探测审计"合法化，与 `sumsub-ingestion` 委托范式一致。
- **不强行搬走 payin 审计**（搬走需为 payin 造一个它不该有的 workflow，得不偿失）。
- （备选，若评审要求最严口径：把 payin 状态流转审计移进 `DepositWorkflowService`，它已订阅 `payin.status.changed`。默认不采用。）

---

## 7. 验收闸

- **e2e 全绿**：`npm run demo:all`（充值+兑换+提现）+ `npm run verify:coa`（记账恒等四式 ALL PASS）。
- **单测**：`jest` deposit/withdraw 两模块现有 `.spec.ts` 保持绿。
- **新增 P6 回归用例**：构造 payout FAILED / TIMEOUT / RETURNED 与合规 REJECT，断言两笔 pending 被 void、客户余额（CLIENT_PAYABLE 可用额）回到锁前。
- **栈**：全程 main 栈，`bash scripts/stack.sh up main`。

---

## 8. 执行顺序（风险递增、各步独立可验收可回滚）

1. **删死代码** `WithdrawTransactionWorkflowService` → 编译 + jest 绿（零行为变化）。
2. **V4 两修**（控制器闸 + payin 标注）→ `demo:deposit` 绿。
3. **V5 收编**：吸收 orchestrator 职责 → 新增 `releaseLock`（堵 P6）→ 建单事务上提 → domain 瘦身 → 删 orchestrator → 事件清理（含两个 V7 死 handler）→ `demo:withdraw` + `demo:all` + `verify:coa` + P6 回归用例全绿。
4. 复核 V7 两文件改动仅为删死 handler，`tsc` 全量编译通过。

每步独立 commit。

---

## 9. 风险与回滚

- **最高风险**：建单事务上提（4.1）与 releaseLock（4.4）触及真实 TB 锁定/解锁路径。缓解：保留现有 best-effort void + CRITICAL 日志语义不变，仅迁移持有者；P6 回归用例兜底。
- **V7 越界风险**：严格限定只删两个已 neuter handler；`FiatFeeCollectionWorkflowService` 类保留。改动后全量 `tsc` 验证无断引用。
- **回滚**：每步独立 commit，任一步 demo 不绿即单步 revert。

---

## 10. 待评审确认项

1. §6.2 payin 审计：默认"标注为 ingestion 保留审计"，是否接受（否则走备选严格口径）。
2. §8 执行顺序是否认可。

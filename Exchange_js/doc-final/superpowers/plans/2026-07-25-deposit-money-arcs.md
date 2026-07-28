# 充值单动钱弧 · 计划 2 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 逐任务执行。步骤用 `- [ ]` 跟踪。
> **在分支 `feat/deposit-state-machine-engine` 上继续**(计划 1 已落地,计划 2 依赖其状态/代码)。

**Goal:** 把计划 1 只到状态位的动钱弧补成真结算:RETURNING→RETURNED、FROZEN→SEIZING→SEIZED、below-min→CONFISCATING→CONFISCATED、FROZEN 解冻回炉——全走**先审批 → 在途态 → 结算(pending→post 或内部 post)+ 失败自愈**。

**Architecture:** 复用 `governance/approvals`(maker-checker,模板 withdraw-large-value)插审批门;退回/上缴复刻 **withdraw 出场范式**(pending→外部确认→post + void 重试,funds-order OUT 驱动),没收是内部直接 post(DEPOSIT_SUSPENSE→FIRM_FEE);全在 `deposit-workflow` + 一个 deposit 审批 handler。

**Tech Stack:** NestJS + Prisma + TigerBeetle + governance/approvals + funds-orders + Jest。

## Global Constraints
- 记账走 `AccountingService`;科目 u16 code+ledger(`tb-account-codes.constant.ts`)。加科目=`TB_ACCOUNT_CODES`+`COA_TO_TB_CODE` 各一行;加转移码=`tb-transfer-codes.constant.ts` 一行(充值段 3–9 空)。
- 审计必须 `AuditLogsService.recordSystem`(DI);多表变更 `prisma.$transaction`;不直写 domain 表(经 service);不绕合规门。
- 审批复用 `governance/approvals`,不自建;actionType/policy 加进 `approval.constants.ts`。
- 退回/上缴=钱离场(外部确认,pending→post+void 重试,funds-order OUT);没收=内部(直接 post DEPOSIT_SUSPENSE→FIRM_FEE)。
- **先批后动**:disposition → 开审批(deposit 留原态+linkApprovalCase)→ `workflow.deposit-disposition.decided` 批准 → 进在途态+结算 → 终态;驳回 → 回原态。
- 失败自愈:出场腿失败 void + 重试(MAX 3,仿 withdraw releaseLock),再败停在途态+needsReview,**绝不自动跳终态/回滚**。

---

### Task 1: schema/enum/转移边/科目/审计常量地基
**Files:** `dto/deposit-transaction.dto.ts`(action enum)｜`deposit-transactions.service.ts`(getNextStatus `:310-357`)｜`tb-account-codes.constant.ts`｜`tb-transfer-codes.constant.ts`｜`audit-actions.constant.ts`｜prisma(deposit 加 `approvalCaseId? / dispositionReason?` 若需)。
**Interfaces produces:** 新 action `CONFISCATE_INITIATE/CONFISCATED_DONE/SEIZED_DONE/RETURN_APPROVED/RESUME_APPROVED`(命名与转移表用法一致即可);新科目 `FIRM_SEIZED`(或复用 CLIENT_ASSET 收缩表示离场,Task 决策)+ 转移码 `DEPOSIT_RETURN_PENDING/POST/VOID`、`DEPOSIT_SEIZE_PENDING/POST/VOID`、`DEPOSIT_CONFISCATE_POST`;新审计 `DEPOSIT_RETURNED/SEIZED/CONFISCATED/*_RETRIED/*_STUCK/DEPOSIT_UNFROZEN/DEPOSIT_BELOW_MIN_DETECTED/DEPOSIT_*_APPROVAL_REQUESTED`。

- [ ] Step1 转移边补齐:`FROZEN→CONFISCATE→CONFISCATING`(改现有直达 CONFISCATED 为经中间态)、`CONFISCATING→CONFISCATED`、`SEIZING→SEIZED`;确认 RETURNING→RETURNED、FROZEN→{SEIZE→SEIZING,RESUME→COMPLIANCE_PENDING,RETURN→RETURNING} 已在。TERMINAL 不加中间态。
- [ ] Step2 科目/转移码:决定退回/上缴对手账——**退回**复刻 withdraw(DR DEPOSIT_SUSPENSE / CR CLIENT_ASSET,外部离场,`isExternalCrossing:true`);**上缴**同结构但新增 `FIRM_SEIZED`(E)科目做贷方(审计清晰)或亦用 CLIENT_ASSET+externalRef 区分(Task 决策,报告说明);**没收** DR DEPOSIT_SUSPENSE / CR FIRM_FEE(现成)。加对应 transfer code。
- [ ] Step3 审计常量注册 + 迁移(若加列)+ `tsc 0` + 现有 spec 回归绿。
- [ ] Step4 单测:getNextStatus 每条新边(照 deposit-transactions.service.spec 现有风格)。Commit。

### Task 2: below-min 检测 → CONFISCATING 门(TDD)
**Files:** `deposit-workflow.service.ts`(`applyKytApproved` 或 approve 前)｜spec。
**Consumes:** `Asset.minDepositAmount`(schema L741,现成);`approveDeposit`。
- [ ] approved 且 trading-ready 后:读 `deposit.asset.minDepositAmount`,若 `amount < min` → 开没收审批(Task 3/4),**不** approveDeposit;≥min 或无 min → approveDeposit→SUCCESS(现状)。
- [ ] 记 `DEPOSIT_BELOW_MIN_DETECTED`。TDD:below-min→走没收门;达标→SUCCESS。Commit。

### Task 3: 审批集成(复用 governance/approvals,TDD)
**Files:** `src/modules/trading/deposit-transactions/deposit-disposition-approval.service.ts`(新,`extends ApprovalHandlerBase`,workflowType `DEPOSIT_DISPOSITION`)｜`approval.constants.ts`(加 actionType+policy)｜`deposit-workflow.service.ts`(`openDispositionApproval` helper + `@OnEvent('workflow.deposit-disposition.decided') onDispositionDecided`)｜module wiring。
**模板:** `withdraw-large-value-approval.service.ts` + withdraw-workflow `openApprovalGate`(:504-555)/`onLargeValueApprovalDecided`(:557-609)。
- [ ] `approval.constants.ts` 加 `DEPOSIT_RETURN_APPROVAL`(steps: MLRO)、`DEPOSIT_SEIZE_APPROVAL`(steps: SENIOR_MANAGEMENT_OFFICER + MLRO 双人)、`DEPOSIT_CONFISCATE_APPROVAL`(steps: OPS_OFFICER)、`DEPOSIT_UNFREEZE_APPROVAL`(steps: MLRO)进 `ApprovalActionTypes` + `DEFAULT_APPROVAL_POLICIES`。
- [ ] `openDispositionApproval(deposit, kind)`:`approvalsService.createAndSubmit({actionType, entityRef:deposit.id, traceId, objectSnapshot},{reason}, SYSTEM_APPROVAL_ACTOR)` → linkApprovalCase(deposit.approvalCaseId)→ 记 `DEPOSIT_*_APPROVAL_REQUESTED`;deposit 留当前态(MANUAL_CHECKING/FROZEN)。
- [ ] `onDispositionDecided(payload)`:APPROVED → 分派进在途态+结算(Task 4/5/6/7);DECLINED/CANCELLED/EXPIRED → 回原态 + 记审计。
- [ ] 改 Plan 1 的 `applyKytRejected` RETURN 分支:`RETURN_TO_SENDER` → `openDispositionApproval(deposit,'RETURN')`(不再直接 RETURNING)。TDD(mock approvalsService)。Commit。

### Task 4: CONFISCATING 结算(内部 post,TDD)
**Files:** `deposit-workflow.service.ts`(`onDispositionDecided` 的 confiscate 分支 + `settleConfiscation`)｜spec。
- [ ] 批准 → `updateStatus(CONFISCATE→CONFISCATING)` → **内部 post**:`accountingService.executeTransfer(DR DEPOSIT_SUSPENSE / CR FIRM_FEE, code DEPOSIT_CONFISCATE_POST, evidence isExternalCrossing:false)`(仿 executeDepositAccounting STEP_2 单腿)→ `updateStatus(CONFISCATED_DONE→CONFISCATED)` → 记 `DEPOSIT_CONFISCATED`。事务包裹。
- [ ] 失败:post 抛 → 停 CONFISCATING + needsReview + 记 `DEPOSIT_CONFISCATE_STUCK`(内部 post 一般不重试外部,失败即人工)。TDD:批准→CONFISCATED+FIRM_FEE +额;e2e 记账守恒留 Task 8。Commit。

### Task 5: RETURNING 结算(出场 pending→post + 自愈,TDD)
**Files:** `deposit-workflow.service.ts`(return 分支 + 出场腿)｜`deposit-transactions.service.ts`(建 return funds-order OUT)｜spec。
**模板:** withdraw 出场(`executePendingTransfer`→外部确认→`postPendingTransfer`/`voidPendingTransfer`);funds-order OUT + `handleFundsOrderChanged` 驱动。
- [ ] 批准 → `updateStatus(RETURN_APPROVED→RETURNING)` → 建 return funds-order(parent depositTransactionId,OUT 语义;注意 `directionOf` 现恒判 IN,需处理 OUT 方向,报告说明方案)+ `executePendingTransfer(DR DEPOSIT_SUSPENSE / CR CLIENT_ASSET, code DEPOSIT_RETURN_PENDING, legIndex:attempt)`。
- [ ] funds-order CONFIRMED(外部出金确认)→ `postPendingTransfer`(DEPOSIT_RETURN_POST)+ enrichForPost(externalRef)→ `updateStatus(RETURNED_DONE→RETURNED)` + 记 `DEPOSIT_RETURNED`。
- [ ] funds-order FAILED/TIMEOUT → `voidPendingTransfer`(DEPOSIT_RETURN_VOID)+ `attempt<3` 重建腿重试(记 `DEPOSIT_RETURN_RETRIED`),否则停 RETURNING+needsReview(`DEPOSIT_RETURN_STUCK`)。**绝不跳终态。**
- [ ] TDD:批准→RETURNING+pending锁;confirmed→RETURNED+post;failed→void+重试。Commit。

### Task 6: SEIZING 结算(出场,同 Task 5 结构,TDD)
**Files:** 同 Task 5 模式,seize 分支。
- [ ] 批准(双人)→ SEIZING → 出场腿(DR DEPOSIT_SUSPENSE / CR FIRM_SEIZED 或 CLIENT_ASSET+gov externalRef,code DEPOSIT_SEIZE_*)→ confirmed → SEIZED(`SEIZED_DONE`)+ `DEPOSIT_SEIZED`;失败 void+重试+stuck。8 年留档 memo。TDD。Commit。

### Task 7: 解冻回炉(TDD)
**Files:** `deposit-workflow.service.ts`(unfreeze 入口 + onDispositionDecided unfreeze 分支)｜admin 入口(controller 或既有 adminFreeze 旁)。
- [ ] FROZEN + 解冻触发(admin,带除名/EOCN 令引用)→ `openDispositionApproval(deposit,'UNFREEZE')`。
- [ ] 批准 → `updateStatus(RESUME→COMPLIANCE_PENDING)`(钱本就在 suspense,无记账)→ 记 `DEPOSIT_UNFROZEN` → 触发重评(调 `SumsubTxnClient.rescore(sumsubFinanceTxnId)` 或重走 runGate0/submit;冻>30d 先 rescore,🟡 策略)。TDD:批准→COMPLIANCE_PENDING+rescore 调用。Commit。

### Task 8: e2e + 文档 + 硬闸
**Files:** `test/deposit-money-arcs.e2e-spec.ts`｜truth `v4-deposit.md`｜`BACKLOG.md`。
- [ ] e2e(真 AppModule,mock SumsubTxnClient + 真 approvals/TB):
  - 没收:below-min deposit → 开 CONFISCATE 审批 → approve → CONFISCATED + FIRM_FEE +额守恒。
  - 退回:MANUAL_CHECKING+RETURN_TO_SENDER → 开审批 → approve → RETURNING → funds-order confirmed → RETURNED + DEPOSIT_SUSPENSE −额;funds-order failed → void+重试。
  - 上缴:FROZEN → SEIZE 审批(双人)→ SEIZED。
  - 解冻:FROZEN → UNFREEZE 审批 → COMPLIANCE_PENDING。
  - 审批驳回:回原态,不动钱。
- [ ] truth v4-deposit 补动钱弧结算现状;BACKLOG 清计划 2 已做项、留 directionOf OUT 处理/冻>30d rescore 等。
- [ ] 硬闸:`tsc 0`、`jest`(净新失败 0)、`verify:coa`(self 栈)守恒 PASS。Commit。

## Self-Review
- Spec 覆盖 design §4 动钱弧全部弧;审批复用非自建;withdraw 出场范式用于退回/上缴、内部 post 用于没收——与锚点一致。
- 先批后动:applyKytRejected RETURN 分支改为开审批(Task 3),不再直接 RETURNING(改了 Plan 1 行为,记录)。
- 类型一致:actionType/审计/转移码/科目在 Task 1 集中定义,后续引用。
- 风险:funds-order `directionOf` 对 depositTransactionId 恒判 IN,退回/上缴是 OUT——Task 5 需处理(转移图方向),标注。

## 执行边界
计划 2 完 = 充值单全状态机(含动钱结算)闭环。前端(admin 处置/审批 UI + 客户面)仍留后续。

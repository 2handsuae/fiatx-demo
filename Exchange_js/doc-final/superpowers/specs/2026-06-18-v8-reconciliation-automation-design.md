# V8 对账自动化引擎 — 设计 spec（阶段一）

日期：2026-06-18（脑暴二轮重写，覆盖一轮初稿）
状态：脑暴逐节对齐完成（§1–§5 全锁），待实施
前置：V3 COA / V4 充值 / V5 提现 / V6 兑换 / V7 funds-layer + 两本账记账（spec 2026-06-10，verify-two-book 41/41 PASS）

---

## 0. 一句话定义

> V7 保证**账本自己平**（双式记账内部自洽）；V8 保证**账本跟外部现实平**（TB 账本 ↔ HexTrust 托管 / Zand 银行的实际余额与流水）。对账是 detective control：每日按冻结切面独立重算、逐笔核对、留证；差异开 Case，**阶段一只检测并记录，停在 OPEN**，平账与关闭归阶段二。

---

## 1. 范围（两阶段切分）

| 阶段一（本 spec）= 自动化运行「发现并记录」 | 阶段二（下一轮）= 异常处理「平账并关闭」 |
|---|---|
| cron 触发（V7 EOD 完成门）| Working Sheet 逐条 line item 处置 |
| I1–I5 全算 + attestation 落库 | 平账 dry-run（冻结 cutoff 上叠 what-if 模拟） |
| T+0 24:00 冻结切面 + 拉外部 + in-transit | Reimbursement 偿付义务 + CFO/MLRO 审批 + funds-layer 结清 |
| 余额对账(粗) + 逐笔 match(细) + 分类 | Case 关闭 PENDING_RECHECK→RESOLVED |
| 落库 Run + Case + line-item + invariant-check | 真缺口三步确认（dry-run 验 + 結清 CLEAR + T+1 tie-out） |
| Admin **只读** 4 页 | SLA 升级 cron |
| **终点：Case 停 OPEN，line-item resolution 字段留空** | |

> 判定缝：阶段一**只读、只产出对账结果**，不碰任何"动钱/改账/定性/关闭"。

---

## 2. 对账模型 — 4 步漏斗 + 五不变量

### 2.1 4 步漏斗（一次跑批）

```
Step 0  账内不变量校验（I1–I4，纯 TB，不需外部）→ 落 invariant_check；破 → 产 INVARIANT line item
Step 1  账实对账（粗）= I5：TB 客户池 vs 外部(as-of-cutoff) 扣 in-transit → headline delta → 落 I5 invariant_check
Step 2  逐笔 match（细，总是跑）：内部资金动作 vs 外部流水
        key = txHash + referenceNo + amount + 时间窗 → 对上 MATCHED
Step 3  unmatched 自动分类 → 产 line item（停 OPEN）
        ORPHAN_INTERNAL / ORPHAN_EXTERNAL / AMOUNT_MISMATCH
闭合自检：Σ unmatched(signed) = Step 1 (I5) 余额 delta，不等 → run FAILED 告警
Case 开仓条件（per 币种）：delta≠0 OR unmatched 数>0 OR 不变量 break
```

> 时点：I1–I4 纯 TB、Step 0 即可算；**I5 必须等外部数据 + in-transit 备齐（Step 1）才能算**——五个不变量全部落 invariant_check，只是计算时点不同。

**两条铁律**：① **逐笔 match 总是跑**，余额平不平都跑——两个等额反向 orphan 会让余额假平，只有逐笔抓得到；`Σ unmatched = 余额 delta` 把粗细两层焊死。② 对账是**逐笔 match**，line item 是 unmatched 的自动产物，不是人工凑差额。

### 2.2 五不变量分三层（全算、全落库、全展示）

```
账内自洽 · STEP 0（V7 双式记账保证，恒绿）
┌────┬───────────────┬──────────────────────────────────┬──────────────┐
│ I1 │ safeguarding⭐ │ 客户资产 = 客户负债 + 桥           │ 真实校验     │  破=客户资产被挪/接线bug，重大事件
│ I2 │ business      │ TRADE_CLEARING 残 = 未结算 swap 桥  │ 业务语义     │
│ I3 │ business      │ FX 头寸 − 浮动 = 成本基础          │ 业务语义     │
│ I4 │ attestation   │ 全账 A − L − E − R = 0             │ 数学恒等留证 │
└────┴───────────────┴──────────────────────────────────┴──────────────┘
账实相符 · STEP 1（V8 主菜，会变红）
┌────┬───────────────┬──────────────────────────────────┬──────────────┐
│ I5 │ account-actual│ TB 客户池 = 物理托管余额          │ TB↔外部      │  破=账实差→下钻 Case
└────┴───────────────┴──────────────────────────────────┴──────────────┘
```

- **I5 不是独立 Step-0 不变量，它就是 Step-1 余额对账本身**：TB 账本 ↔ 物理托管（现 `wallet.mockBalance`，将来 HexTrust/Zand）。I1–I4 是"账跟自己对"，I5 是"账跟现实对"。
- **I4 是纯数学 attestation**（TB 构造保证），算它是给审计留"控制跑了"的证据——detective control 必须独立重算并留证，而非声称"构造上不会错"。**I1 是 safeguarding 皇冠**：接线 bug 会破 I1 但 I4 仍平，必须真算。

### 2.3 算法与真实验证锚点

每币种从 `tb_transfer_evidence`（POSTED）重算账户余额（asset 借方正、L/E/R 贷方正）：

```
I1: balance(CLIENT_BANK|CLIENT_CUSTODY) == balance(CLIENT_PAYABLE)+balance(DEPOSIT_SUSPENSE)+balance(TRADE_CLEARING)
I4: Σ debit_net(所有账户) == 0
I2: balance(TRADE_CLEARING,ccy) == Σ 未全 SETTLED swap 桥贡献（from 币 +fromAmount；to 币 −(gross+spread)）
I3: balance(FX_POSITION,ccy) − balance(FX_UNREALIZED_PNL,ccy) == 成本基础
I5: balance(CLIENT_BANK|CLIENT_CUSTODY,ccy) == 物理托管余额(as-of-cutoff) − in-transit 调整
```

真实锚点（2026-06-16）：I1 USDT `1,794.150136 = 1,395.720136 + 398.43 + 0` ✓；I4=0 ✓；I5 `TB 1,794.150136 = 物理 mockBalance 1,794.150136` ✓。（DEPOSIT_SUSPENSE 两笔 USDT 398.43/AED 5230.56 正是当日 FROZEN 充值——已进池未放行，I1 把它算在负债侧才平。）

---

## 3. 切面与数据源

### 3.1 cutoff = T+0 24:00 冻结（核心语义）

> 逻辑上有一条 **T+0 24:00 cutoff 线**，所有针对 T+0 的对账都基于它；多时刻（02:30 / 上传后 / 重跑）对账，T+0 结果一致。

```
TB 内部侧 ── 计算型 cutoff（不需物化快照）
   evidence.createdAt < '<T+1 00:00 UTC>' AND transferType='POSTED' 重算每账户余额
   ∵ evidence append-only（修正走补偿/冲正、不覆盖），T+0<midnight 那批永远同一批
   ⇒ 任何时刻去算，TB 侧 T+0 结果确定、可复跑（不依赖 V7 cutoff，见 §7）

外部侧 ── 取 "as of T+0 24:00" 的值（外部余额随 T+1 漂移，必须锚 cutoff）
   · Zand 法币：对账单 closingBalance 本身即 T+0 cutoff（银行冻结）
   · HexTrust 加密：at_timestamp 查 T+0 24:00 余额，或 24:00 物化一份余额快照
   · wallet.mockBalance（现）：live 值 → 在 24:00 snapshot 一份
```

### 3.2 in-transit 调整（已知时序差，会自己平，不算差异）

> 区分：**in-transit = "在路上、会自己平" → 扣掉**；**orphan/mismatch = "对不上、要查" → Step 2/3 产 line item**。

```
crypto（真实枚举校验过）：
 ① 入金在途   payin status∈{DETECTED,CONFIRMING,CONFIRMED} 且未进 deposit STEP_1 → 外部 −=
 ② 出金在途   withdraw status=PAYOUT_PENDING 且 payout status∈{BROADCASTED,CONFIRMING} → 外部 +=
 ③ 内部转账在途 internal_funds status=CREATED（未 CLEAR，如 4 笔 FUND_OUT 243.20）→ 按方向调
fiat：
 ① 出金在途   同 crypto，fiat 口径
 ② 结算在途   internal_transaction sourceType∈{FIAT_SETTLEMENT,FIAT_FEE_COLLECT} 未 CLEAR
```

法币"孤儿入金"（对账单有、Payin 未创建）**不是 in-transit**——由 Step 2 抓成 `ORPHAN_EXTERNAL`。

---

## 4. 数据模型（4 张新表 + 复用）

```
① reconciliation_runs ── 流水：一次跑批一行，不可变快照
   runNo(RUN-{date}-{layer}-{seq})  businessDate  layer(CRYPTO|FIAT)  seq  triggerType(SCHEDULED|MANUAL|POST_FIX)
   mode(DRY_RUN|APPLY)  status(RUNNING|COMPLETED|FAILED)  invariantStatus(PASS|FAIL)
   openedCount/reObservedCount/closedCount  startedAt  completedAt  traceId(V8:{layer}:{date})

② reconciliation_invariant_checks ── 每 run × 不变量一行（I1–I5 留证）
   runId  invariantCode(I1..I5)  ledger/currency  lhsLabel lhsValue rhsLabel rhsValue delta
   status(PASS|FAIL)  severity(ATTESTATION|SAFEGUARDING|BUSINESS|ACCOUNT_ACTUAL)

③ reconciliation_cases ── 工单：业务日×币种（账户级容器），跨 run 生命周期，要人管
   caseNo(REC-{date}-{ccy}-{nnn})  businessDate  assetId/Code  layer
   tbAmount  inTransitAmount  expectedExt  actualExt  deltaAmount
   status(OPEN|PENDING_RECHECK|RESOLVED)  openedByRunId  closedByRunId  lastObservedRunId
   slaDeadline  traceId  reimbursementObligationId(nullable, 阶段二填)

④ reconciliation_line_items ── 逐笔差异（单笔交易，处置单元），挂 case + foundByRunId
   caseId  foundByRunId  lineNo  matchStatus(MATCHED|ORPHAN_INTERNAL|ORPHAN_EXTERNAL|AMOUNT_MISMATCH|INVARIANT)
   internal{SourceType,Id,No,Amount,Direction,TxHash}  external{Source,TxId,TxHash,Amount,Direction,Timestamp}
   status(OPEN)  ── resolution/resolutionMemo/reimbursementObligationId 留空，阶段二填

~~复用 fiat_statement_import（从 stub 抢救）~~ → **实施变更（G2 2026-06-18）**：随 stub 一并 drop（与 SafeguardingRun FK 纠缠，且 V8 mock 适配器从 internal_fund 派生外部流水、暂不引用此表）。真实 Zand 对账单表待真实 adapter 落地时重建
不动 reimbursement_obligations（阶段二才接）
✂ 不建 observations 表 —— 跨 run 时间线用 Case 指针(openedBy/closedBy/lastObserved) + 审计日志(RECON_CASE_*) 重建
```

**维度区分（钉死）**：

```
Case     = 账户维度的"对不上"   业务日×币种   每币种每天最多 1 张   带 SLA+生命周期   要人管
LineItem = 逐笔维度的"哪笔对不上" 单笔交易     一张 Case 下 N 条      处置在这一层      Case.delta = Σ(LineItem)
```

**关系**：Run 1:N invariant_checks；Run N:M Case（经审计事件，不经 observations 表）；Case 1:N line_items。

**生命周期（谁能改 Case 状态）**：

```
OPEN            ← 阶段一 Run 发现差异开仓（openedByRunId）；阶段一终态停这
PENDING_RECHECK ← 阶段二 平账后置（人提议修复，等机器复核）
RESOLVED        ← 阶段二：line item 全处置 + Reimbursement 结清确认（关闭只能机器/复核驱动，人不能手点 RESOLVED）
```

> maker（人改）/ checker（机器认）分离：模型阶段一全建好，阶段二只填 resolution 字段，零 schema 返工。

---

## 5. 模块结构

```
src/modules/reconciliation/（新建，对齐 funds-layer 分层 + 遵 backend-platform 规则）
├── domain/        reconciliation-run / -case / -line-item.service.ts   ← 只它们写 Prisma（写方法收 tx）
├── engine/        invariant-checker / balance-snapshot / in-transit /  ← 纯算、无副作用（= dry-run 底座）
│                  match-engine / classifier.service.ts
├── adapters/      external-balance.provider + external-tx.provider（接口）
│                  mock-external.adapter.ts（读 wallet.mockBalance + bank_statement）
│                  [2026-06-19] 外部对账单存储已实现 + 按物理外部账户隔离（一账户一张单，子账户/vIBAN 为单内行标签）
│                  + 客户边界（外部只 sum walletRole C_*，firm F_* 排除）。详见 2026-06-19 client-scoping spec。
├── workflow/      reconciliation-run-workflow.service.ts   ← 编排，不直接写表（走 domain）
├── sweep/         reconciliation-cron.service.ts           ← @Cron 只能在这层
├── controllers/   reconciliation-admin.controller.ts       ← 只读
└── dto/ constants/
```

旧 `clearing-settle/safeguarding-reconciliation` stub **退役**（模型已偏离：合并 I1/I5、错科目 CLIENT_HELD、L2 读物理钱包伪命题、无逐笔 match）；抢救 `fiat_statement_import` CSV import + audit 模式。

---

## 6. 触发、编排、dry-run

### 6.1 触发与守门

```
@Cron('0 30 2 * * *', Asia/Dubai)        crypto 对账（V7 EOD 后）
@OnEvent('fiat-statement.import.ready')  fiat 对账（Zand 对账单上传触发）
@Cron('0 0 12 * * *', Asia/Dubai)        fiat 兜底（中午未上传 → 占位）
守门：该 businessDate 的 V7 SettlementBatch=COMPLETED？否 → 推迟 30min×4 重试（看状态不看钟）
```

### 6.2 编排管道（apply 模式）

```
sweep → workflow.run(businessDate, layer, mode)
  0 守门：V7 EOD 完成？
  1 engine.snapshot（TB evidence 重算，T+0 cutoff）
  2 engine.invariantCheck I1–I4（纯 TB）→ invariant_check
  3 adapter.fetchExternal（as-of-cutoff）
  4 engine.inTransit
  5 engine.balanceRecon = I5（TB vs 外部 − in-transit）→ invariant_check
  6 engine.match（逐笔）
  7 engine.classify → line items
  8 domain 落库：run + case + line items（DRY_RUN 跳过此步）
  9 自检断言：Σ unmatched = I5 delta，不等 → FAILED
```

### 6.3 dry-run（复用项目 `--dry-run`/`--apply` 约定）

```
engine 纯算 → 产结果对象，自己不写库
  dry-run（默认）：只调 engine + 打印/返回结果，0 落库、0 告警
  apply（--apply / cron）：结果交 domain 落库 + 写审计
cron 跑批 = apply（官方记录）｜手动接口/CLI = dry-run 默认
平账 dry-run（处置前在冻结 cutoff 上叠 what-if 预演账能否平）= 阶段二
```

---

## 7. 与 V7 EOD 的关系（前置依赖，soft）

- V8 **不改 V7 EOD 时序**（现 `@Cron('0 59 23 * * *', Asia/Dubai)` 不动）。
- V8 跑自己的 02:30 cron + `SettlementBatch=COMPLETED` 状态门（看状态不看钟）。
- V8 **不硬依赖 V7 修 cutoff**：V8 按 `evidence.createdAt < T+1 00:00` 自算 T+0 切面；V7 那 1 分钟 cutoff 缝（23:59:30 的 swap）由 V8 in-transit 接住，不漏不重。
- 「V7 EOD 移 00:30 + 显式 cutoff」改善的是 V7 自身当日归属，对 V8 是锦上添花——**soft 前置，单独跟踪，不进 V8 scope，不卡 V8**。

---

## 8. 页面 IA（只读，= 演示验证过的 4 页）

```
每日对账（流水）   落地 = 历史台账，每跑批一行（一天多行：Run#1 破 / Run#2 平账后复核）
   → Run 详情      I1–I4（账内·恒绿）+ I5（账实·会红）+ 本次跑批的 Case 动作
       → Case 详情  跨 Run 时间线 + 三层数字 + 逐笔 line item + 平账处置(阶段二预览)
差异 Case（列表）  跨跑批工单，一行一个 Case 从开到关
```

- 不变量不是独立页面，是流水列表的状态列 + Run 详情的卡。
- 跨 Run 时间线由 Case 指针 + 审计日志渲染（无 observations 表）。

---

## 9. 审计与 RBAC

- 审计经 `AuditLogsService.recordSystem`（cron）：`RECON_RUN_COMPLETED` / `RECON_CASE_OPENED` / `RECON_CASE_RECONFIRMED` / `RECON_INVARIANT_BREAK`；traceId = `V8:{layer}:{businessDate}`；metadata 带当次 delta（时间线事实源）。
- 新增 RBAC 只读权限：`RECON_RUN_VIEW` / `RECON_CASE_VIEW`（Finance / MLRO / CFO）。处置类权限留阶段二。

---

## 10. 测试与验收

```
· engine 单测（纯函数）：snapshot / in-transit / match / classify / invariant-checker（I1–I5）
· workflow 集成：seed 内部交易 + mock 外部 → 跑管道 → 断言 run/case/line-item/invariant
· scripts/verify-reconciliation.ts 全链（对齐 verify-two-book.ts，默认 dry-run）：
    - 全对上：0 case，I1–I5 PASS
    - 三类 break：各产 1 条对应 line item
    - 不变量 break：产 INVARIANT line item
    - Σ unmatched = balance delta 闭合断言
    - 多 Run 同日：Run#1 开仓 / 数据补全后 Run#2（同 cutoff）行为正确
· npm run build + tsc 绿；dev:rebuild 后可重放
```

---

## 11. 阶段二预览（本轮 OUT，仅留接口 / 备忘）

- Working Sheet 逐条 line item 定性（ACCEPTED_DIFFERENCE / LOSS_EVENT_REIMBURSE / LINK_TO_INCIDENT / CREATE_BACKDATED_PAYIN / MANUAL_REVERSAL / AMOUNT_CORRECTION），收敛规则 Σ=delta 才能提交。
- 平账 dry-run：在冻结 T+0 cutoff 上叠 what-if 模拟「補款后差额→0?」，不改 cutoff、不动钱。
- Reimbursement：sourceType='V8_RECON' → CFO+MLRO 双签 → funds-layer `InternalTransferWorkflowService` 结清 → mirror TB。
- **Case 关闭两条路（关键，纠正一轮初稿）**：
  - 数据补全型（假差异，如对账单迟到）：同 T+0 cutoff、外部补全后重跑 → CLEARED。
  - 真缺口：不靠重跑（冻结历史永远不变）；靠 dry-run 验(前) + Reimbursement 結清 CLEAR(中) + 次日 T+1 对账 tie-out 确认(后)；**T+0 Case 历史永久留痕**。
- SLA 升级 cron（24h / VARA 重大事件门槛）+ 根因概率打分。

---

## 12. 范围外（明确不做）

- 阶段二全部（处置 / 平账 dry-run / Reimbursement / 关闭 / 升级 / 打分）。
- 真实 HexTrust / Zand adapter（本轮 mock 读 mockBalance，接口预留）。
- V7 EOD 切面时序改造（§7，soft 前置单独跟踪）。
- 季度 Proof of Reserves / 对账报告导出 / LP 仓位对账（roadmap 推后项）。

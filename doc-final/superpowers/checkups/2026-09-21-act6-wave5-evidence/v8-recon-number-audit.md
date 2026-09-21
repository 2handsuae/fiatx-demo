# v8-recon.md 全文逐数复核（波五 T10）

复核方法：逐条数字claim 在 `doc-final/modules/v8-recon.md` 中定位，跟对应代码/实跑结果核对。
判定列：✅ 对（不改）｜ 🔧 改（已修）｜ ⚠️ 未验证（存疑，未动，理由见备注）。

## 一、五处点名数字腐烂（spec §3）

| # | 位置（改前行号） | 数字 | 代码依据 | 判定 |
|---|---|---|---|---|
| 1 | v8-recon.md:16 | 差异分**五桶** | `bucket-classifier.ts` `ReconBucket = 'MATCHED'\|'IN_TRANSIT'\|'COMPENSATING'\|'BREAK'`（4 个字面量） | 🔧 五桶→四桶 |
| 2 | v8-recon.md:36 | Run 行「五桶计数」，且未提 INTERNAL_BREAK | `wallet-recon-run.service.ts:77` `status: 'PASS'\|'BREAK'\|'INTERNAL_BREAK'`；`:62-68` `computeSeverity` 与 invariantStatus 写入语义（波五 T6） | 🔧 五桶→四桶 + 补 INTERNAL_BREAK 是 run 状态非桶的说明 |
| 3 | v8-recon.md:38 | 「五桶判定 \| 180 组网格」 | 同 #1；`bucket-classifier.spec.ts` `it('180 组确定性网格...')` `expect(checked).toBe(180)` | 🔧 五→四（180 本身核对无误，未动） |
| 4 | v8-recon.md:110（原行号） | `computeBucket()`（五桶互斥） | 同 #1 | 🔧 五桶→四桶，并列出四桶名 |
| 5 | v8-recon.md:113（原行号） | 「21 个成因码铺满 6 格 + OTHER 兜底」 | `cause-registry.ts` `CauseCode` 联合类型逐个数：20 个具名码（AMT_MISBOOKED…UNEXPLAINED）+ `OTHER` = 21 **含 OTHER**；文档原文把 OTHER 算在「21 个」之外又加一次，实为 22，与同页 §1 叙事「20 个成因里只有一个机器认得出」（v8-recon.md:20，未动）及 §5「成因表 21 → 20（FIRM_TRANSFER_UNTRACKED 退役）」自相矛盾 | 🔧 21→20（20 码 + OTHER 兜底，口径与全文统一） |

业务日口径：v8-recon.md 原文未有专段落陈述迪拜午夜切点，新增一段引 `business-date.util.ts` 三函数 + `decisions.md` 2026-09-21 条目（见改后 §1 第二段）。

## 二、全文扩展复核（本次新查出的drift，非 spec §3 点名，仍按「文档数字须与代码一致」原则修正）

| # | 位置 | 数字 | 代码依据 | 判定 |
|---|---|---|---|---|
| 6 | `adjustment.controller.ts`（3 端点） | 3 | 实查 `@Post()`create / `@Post(':adjustmentNo/submit')` / `@Get()`list / `@Get(':adjustmentNo')`getOne = **4** 个端点（`list` 端点系 2026-09-07 界面收口轮 Task 1 后补，文档旧数没跟上） | 🔧 3→4，并列出四个端点用途 |
| 7 | `disposition.controller.ts`（2 端点） | 2 | 实查 `@Post('dispositions')` / `@Get('reattribution-candidates')` / `@Get('supplement-candidates')` = **3** 个端点（`supplement-candidates` 系 2026-09-03 平账 B 批新增，文档旧数没跟上） | 🔧 2→3，补上第三个端点 |
| 8 | §6「严重度分级跨资产不可比（BACKLOG）」，称 `computeSeverity` 仍按单一阈值 | — | `wallet-recon-run.service.ts:62-68` `computeSeverity(currency, delta)` 已改按 `severityLinesFor(currency)` 索引；`recon-thresholds.constant.ts:35-38` `SEVERITY_LINES_MINOR`（AED med=10,000n/high=1,000,000n、USDT med=30,000,000n/high=3,000,000,000n） | 🔧 改写为「已解决，波五 T5」，销 BACKLOG:194 |
| 9 | §6 缺 INTERNAL_BREAK 明细呈现的说明 | — | spec §2.1 裁定 + `wallet-recon-run.service.ts:593` 写入语义修正 + `ReconciliationRunsDetailPage.tsx` 三态呈现（波五 T6） | 🔧 新增一条 BACKLOG:192 余项说明 |

## 三、抽样核对，确认无误（未改）

| # | 位置 | 数字 | 代码依据 / 实跑证据 | 判定 |
|---|---|---|---|---|
| 10 | 账龄线 3 天（×2 处） | 3 | `recon-thresholds.constant.ts:8` `RECON_AGING_DAYS = 3` | ✅ |
| 11 | 180 组网格 | 180 | `bucket-classifier.spec.ts`：`deltas(5) × transits(4) × counts(3) × counts(3) = 180`，`expect(checked).toBe(180)` | ✅ |
| 12 | 18 个场景 / 18 条 | 18 | `scripts/recon-demo.ts` 场景注册表 `scenarioId: 1..18`（grep 确认 16/17/18 存在）；实跑 `recon:demo:break`（自有栈 act6_wave5，2026-09-21 重铺后）输出 `manifest written ... (18 scenarios, 12 wallets)`、`scenarios: 18/18 DETECTED` | ✅ |
| 13 | 12 张案子 / 12/12 钱包桶 | 12 | 同上实跑：`casesOpened=12`、`wallets: 12/12 bucket OK` | ✅ |
| 14 | 桶内构成 break 9 / softFlag(抵销) 2 / inTransit 1 | 9/2/1 | 同上实跑 identity①：`walletCount(19) == matched(7) + inTransit(1) + softFlag(2) + break(9)` | ✅ |
| 15 | 处置家族拆分 推单1/冲正4/冲销2/改记1/补记2/核销1/补单3/划转2/事故登记1=17，余1（场景9） | 17+1=18 | 逐场景核对 §4 场景表：冲正=2,3,4,5(4)；冲销=6,7(2)；补记=11,12(2)；补单=13,14,15(3)；划转=16,17(2，认损/垫款为主行为)；核销=10(1)；改记=8(1)；推单=1(1)；事故登记=18(1)；余场景9未计入。总和 1+4+2+1+2+1+3+2+1=17，+1(场景9)=18 | ✅ |
| 16 | `V8_RECON_AUDIT_ACTIONS` 9 码 | 9 | `audit-actions.constant.ts:858-878` 逐个数：RUN_COMPLETED/CASE_OPENED/CASE_AUTO_HEALED/PUSH_ORDER/ADJUSTMENT_POSTED/ADJUSTMENT_DRAFTED/DISPOSITION_RECORDED/CASE_AGING_BREACHED/AGING_TIMEOUT_SIMULATED = 9 | ✅ |
| 17 | 补单三路「十个新审计码，①比②③多一个拒绝码」 | 10 | `audit-actions.constant.ts`：DEPOSIT_SUPPLEMENT 4 码(REQUESTED/STARTED/REJECTED/SUPPLEMENTED)、DEPOSIT_CLAWBACK 3 码(REQUESTED/STARTED/CLAWED_BACK)、WITHDRAW_RETURN_CLAIM 3 码(REQUESTED/STARTED/RETURNED_AFTER_SUCCESS)，4+3+3=10 | ✅ |
| 18 | 调账审批「四钩子全覆盖」 | 4 | `adjustment-approval.service.ts` `@OnEvent` x4：APPROVED/REJECTED/CANCELLED/EXPIRED | ✅ |
| 19 | 调账单列表页「九列」 | 9 | `ReconciliationAdjustmentListPage.tsx` 表头数组：Adjustment No/Case No/Customer/Asset/Reason/Dir/Amount/Status/Effective Date = 9 | ✅ |
| 20 | 旧 8 个折叠码退役 | 8 | 文档列举 DEPOSIT_AMOUNT_CORRECTION/DEPOSIT_DUPLICATE_REVERSAL/DEPOSIT_SIGNAL_VOID/WITHDRAW_AMOUNT_CORRECTION/WITHDRAW_VOID_REFUND/BANK_INTEREST/BANK_CHARGE/FIRM_ENTRY_REVERSAL，逐一数=8（均已退役，未在现行 `ReasonCode`/`CauseCode` 出现，grep 零命中） | ✅ |
| 21 | 3 个单级专码保留 | 3 | `adjustment-rules.ts:11-14` `ReasonCode` 前三项：CUSTOMER_REATTRIBUTION/UNEXPLAINED_WRITE_OFF/UNEXPLAINED_CLIENT_LOSS = 3 | ✅ |
| 22 | 核销四前提「小额线 AED 100 / USDT 30」 | 100/30 | `recon-thresholds.constant.ts:14-17` `SMALL_AMOUNT_LINE_MINOR`（AED 10,000n=100.00、USDT 30,000,000n=30.000000）——与严重度线（med）数值虽相同但是**两张独立注册表**，未被 T5 误改 | ✅ |

## 四、未动（存疑，不在本次改动范围）

| # | 位置 | 疑点 | 处理 |
|---|---|---|---|
| 23 | `adjustment-rules.ts` 第 8 码 `CUSTOMER_REATTRIBUTION` | 该码在现行 `ReasonCode` 联合类型/`REASON_SPECS` 对象字面量声明顺序中均为**第 1 项**，非第 8；无法在现有代码找到与「第 8」对应的排序依据（可能是历史遗留的编号，指代码添加的时间顺序而非声明位置，未查到原始出处） | ⚠️ 不改：既不在 spec §3 点名清单内，也找不到可靠代码依据支持改成某个具体数字；标记存疑，留给下一次接触此段落的人核实，不臆测 |
| 24 | 代码里另有三处「five-bucket」英文注释（`reconciliation.dto.ts`、`reconBucketMap.ts`、`ReconciliationRunsDetailPage.tsx`）及 `roadmap.md`/`archive/` 内多处「五桶」历史记录 | 与 bucket-classifier.ts 同源的误导性措辞，但 brief Step 1 明确限定「代码内两处」（`bucket-classifier.ts`+`recon-demo.ts`），checkup 报告（`2026-09-19-act6-recon-checkup.md:90`）也明确把「错误源头...被文档抄了 4 遍」限定为 v8-recon.md 的 4 处；`roadmap.md` 按 CLAUDE.md §8 路由表业主维护、agent 不主动读；`archive/` 不读 | 不改：超出本任务授权范围，未动 |

## 五、结论

v8-recon.md 本次共改动 9 处（五桶→四桶 ×4、成因码 21→20、新增业务日口径段、调账/定性端点数各订正一处、§6 两条 BACKLOG 说明改写/新增），抽样核对 13 项数字与代码/实跑结果一致、未改；1 项（CUSTOMER_REATTRIBUTION「第 8 码」）存疑未动，理由见上表 #23。

# Phase B 对账重设计：按钱包逐项外部对账（实时镜像模型）

> 设计文档 · 2026-06-26 · 分支 funds-realtime-1to1 · brainstorming 收口
> 取代 V8 五公式/credit-net 引擎（引用已删除的 Outstanding/bridge/`L.TRADE_CLEARING`，与实时 8 码 COA 不符）。

## 1. 镜像方向（核心口径，一定要看）

**1:1 镜像的不是 `CLIENT_ASSET`，是 `SUSPENSE[c] + PAYABLE[c]` 这一对负债桶。**

- 每个**物理钱包/账号**（客户 vault / vIBAN / 充值地址）↔ 该客户的 `DEPOSIT_SUSPENSE[c] + CLIENT_PAYABLE[c]`。
- `CLIENT_ASSET` 是**所有客户钱包的聚合资产侧**（Σ 全体物理钱包），不对单个钱包。`FIRM_ASSET` 同理（聚合公司侧）。
- **对账时**：
  - **客户钱包余额对账**：`external == PAYABLE[c] + SUSPENSE[c]`，1:1 直比（详见 §7）。
  - **客户钱包流水对账**：物理钱包流水 ↔ 该客户 `SUSPENSE[c] + PAYABLE[c]` 两个会计账户用 walletRef 合并的流水（详见 §8）。
  - **公司钱包**：单账户 1:1 直比（`external == FIRM_OPS/SET/FEE` 之一）。
- 第一层恒等仍成立：`CLIENT_ASSET == Σ_c (SUSPENSE[c] + PAYABLE[c])`，由 `verify-realtime-coa.ts` 保证。

## 2. 目标 / 颗粒度
把"每个钱包镜像一对负债桶"延伸到外部对账：拉取每个真实外部对账单（银行账号 / 链上地址 / vIBAN），**按物理钱包**逐项核对——**余额对 + 流水对**。颗粒度 = **逐钱包**（一个钱包的流水天然横跨 SUSPENSE 与 PAYABLE 两个会计账户）。

## 3. 三层对账
- **第一层 · 内部恒等（已完成，作前置门）**：`CLIENT_ASSET == Σ客户负债(PAYABLE+SUSPENSE)`、`FIRM_ASSET == Σ公司权益`（每币种），`scripts/verify-realtime-coa.ts`。不自洽则停。
- **第二层 · 外部余额对账**（§6）。
- **第三层 · 外部流水对账**（§7）。

## 4. 充值流（统一口径，不分叉、不加 COA）
**所有充值（法币 + 虚拟币）统一两步**：

1. **到账**：`DR CLIENT_ASSET / CR DEPOSIT_SUSPENSE`（钱已到、负债侧"持有待定"）。
2. **放行**：`DR DEPOSIT_SUSPENSE / CR CLIENT_PAYABLE`（同一笔钱负债侧从"待放行"挪到"可用"桶；钱包不动）。

口径：`CLIENT_ASSET` 反映"全体客户钱包累计 posted 资产之和"（聚合）；`SUSPENSE[c] / PAYABLE[c]` 是**客户 c 物理钱包的两个负债桶分类**——它们的合一才镜像该钱包。不引入 `FROZEN_FUNDS`、不动现有 8 码 COA。

## 5. AccountFlow 流水表（新增，对账的内部侧数据源）
- **一笔 transfer 投影成两行**：借方账户 → `OUT`、贷方账户 → `IN`。
- **每行字段**：`tbAccountId`、`walletRef`、`direction`(IN/OUT)、`amount`、`isExternalCrossing`、`externalRef`、`eventCode`、`sourceType`、`sourceNo`、`transferType`(POSTED/PENDING/POST_PENDING/VOID_PENDING)、`createdAt`。
- **`walletRef`**（钱物理待在/移动的钱包）：
  - **客户负债行**（`SUSPENSE[c]` / `PAYABLE[c]`）→ 该客户钱包 ID（vault/vIBAN）。`SUSPENSE→PAYABLE` 放行的两行带**同一个** walletRef（钱没挪、只是桶变）。
  - **公司权益行**（`FIRM_OPS/SET/FEE`）→ 对应公司钱包 ID。
  - **聚合资产行**（`CLIENT_ASSET` / `FIRM_ASSET`）→ 也带该笔的具体钱包（便于审计），**但不参与外部对账**（§6/§7 都跳过聚合行）。
- **`isExternalCrossing`**：`true` = 真上链/过账（有 txHash / bank ref + 跨钱包边界）；`false` = 纯账面重分类（同钱包、无 tx，如 `SUSPENSE→PAYABLE` 放行）。等价判据 = `externalRef != null`。
- **两个视图**：
  - **全量流水**：`WHERE walletRef=X AND tbAccountId IN (SUSPENSE[c], PAYABLE[c])`（客户钱包）或 `(FIRM_OPS/SET/FEE)`（公司钱包）——审计 / 给客户看（带"充值/放行/兑换/提现/手续费"类型列）。
  - **外部对账流水**：上面再加 `AND isExternalCrossing=true`——逐项对真实外部进出。
- **自洽校验**：内部重分类(false)在钱包上**净额=0**（`SUSPENSE −1000 + PAYABLE +1000`），不动钱包余额；故"全量流水余额 == 外部对账流水余额"。
- **数据源**：`tb_transfer_evidence`（加 `debitWalletRef`/`creditWalletRef`/`isExternalCrossing`/`externalRef`），`AccountFlow` 为其**纯投影**（materialized 表，2 行/transfer，记账处逐腿填值）。

## 6. 钱包 ↔ 账户映射
| 物理钱包 | 镜像账本账户（合在一起=1:1 镜像该钱包） | 备注 |
|---|---|---|
| 客户 vault / 充值地址 / vIBAN（逐客户、逐钱包） | `DEPOSIT_SUSPENSE[c]`(101) **+** `CLIENT_PAYABLE[c]`(100) | 两个桶共同镜像一个物理钱包 |
| 公司结算银行户 | `FIRM_SET`(201) | 单账户 1:1 |
| 公司手续费钱包 | `FIRM_FEE`(202) | 单账户 1:1 |
| 公司运营/流动性钱包 | `FIRM_OPS`(200) | 单账户 1:1 |
| （聚合，不镜像单钱包，不参与外部对账） | `CLIENT_ASSET`(1) / `FIRM_ASSET`(50) | 仅供第一层恒等 |

## 7. 余额对账（按钱包，1:1 直比，不分层）
统一一条等式，按钱包直比，不平就开 Case；展示侧把 SUSPENSE 拆出来让人**看**在审多少（不参与判定）。

- **客户钱包**：`external == PAYABLE[c] + SUSPENSE[c]`。
  - 不平 → 开 `ReconciliationCase`(walletRef/ownerNo/coaCode/Δ) → 下钻流水(§8)。
  - Case 详情/钱包详情**展示**：`PAYABLE[c]`（可用）/ `SUSPENSE[c]`（在审）/ `external`（外部）三列对比，便于人工辨认差在哪一桶。仅展示，不影响 PASS/BREAK 判定。
- **公司钱包**：`external == 对应权益账户` 之一(`FIRM_OPS/SET/FEE`)，1:1 直比。不平 → 开 Case。

## 8. 流水对账（按钱包，仅 `isExternalCrossing=true`）
- **锚点 = 外部面事件**（链上/银行真实进出），**不是某会计账户的原始流水**。
- 取该钱包的"外部对账流水"（§5 第二个视图）↔ 外部对账单行，**键 = 金额 + 方向 + 时间窗(±N) + `externalRef`**（优先精确匹配）。
- **一笔真实跨钱包转账 = 两行**（出账钱包 `OUT` + 进账钱包 `IN`，**同 ref**）：客户出 ↔ 客户账号对账单、公司进 ↔ 公司账号对账单；**同 ref 交叉校验**"客户出 == 公司进"（手续费、兑换本金这类客户→公司的真实转账，两端都对得上、还互校）。聚合 `CLIENT_ASSET/FIRM_ASSET` 的行不参与。
- **三类异常** → `ReconciliationLineItem`：
  - `ORPHAN_EXTERNAL`（外有内无 = 漏记 / 未知入账）
  - `ORPHAN_INTERNAL`（内有外无 = 链上未确认 / 在途）
  - `AMOUNT_MISMATCH`（配上金额不符）
- **内部行**（`isExternalCrossing=false`：`SUSPENSE→PAYABLE` 放行、swap 纯账面腿、fee 内部）**不参与匹配、不报孤儿**。
- **在审充值**：其"到账"行(true)照常匹配外部充值行，状态标 IN-REVIEW，不是差异。

## 9. 走查（客户 c 的钱包；10 笔充值，8 放行 2 在审，含 1 提现 + 1 兑换本金转出）
| 时间 | 账户 | 类型 | 进出 | 金额 | walletRef | isExternalCrossing | externalRef |
|---|---|---|---|---|---|---|---|
| t1×10 | `DEPOSIT_SUSPENSE[c]` | 充值到账 | IN | 1000 | c-vault | ✅ true | `txHash_in_i` |
| t2×8  | `DEPOSIT_SUSPENSE[c]` | 合规放行 | OUT | 1000 | c-vault | ❌ false | — |
| t2×8  | `CLIENT_PAYABLE[c]`   | 合规放行 | IN  | 1000 | c-vault | ❌ false | — |
| t3    | `CLIENT_PAYABLE[c]`   | 提现 | OUT | X | c-vault | ✅ true | `txHash_out` |
| t4    | `CLIENT_PAYABLE[c]`   | 兑换本金转公司 | OUT | P | c-vault | ✅ true | `txHash_swap` |

- **外部对账流水**(true)：10 笔到账(IN) + 提现(OUT) + 兑换本金(OUT) → 正好等于该 c-vault 链上地址的真实进出；放行(t2)是内部、净额 0、链上没有 → 不参与。
- 余额对账：`external == PAYABLE[c] + SUSPENSE[c]`（直比，PASS）；展示侧拆出 PAYABLE=8 笔可用 / SUSPENSE=2 笔在审 / external=10 笔的总和供人工辨认。

## 10. 复用 vs 重写
- **复用**：`ExternalBalance`/`ExternalStatementLine`/`ReconciliationRun`/`Case`/`LineItem` 模型 + External Balances / Recon Runs / Cases 三组 admin 页。
- **新增/加列**：新增 `AccountFlow` 表；`tb_transfer_evidence` 加 `debitWalletRef/creditWalletRef/isExternalCrossing/externalRef`；`ExternalBalance`/`Case` 加 `walletRef/coaCode/ownerNo` 定位。
- **重写引擎**：弃 `formula-checker`(式1-5)/`credit-net`/`invariant-checker`(I1/I2) 对 Outstanding/bridge/`TRADE_CLEARING` 的依赖；第一层用 `verify-realtime-coa` 口径；换成 §7+§8。

## 11. 引擎流程（RedesignReconRunService 重写）
1. 前置：第一层恒等（每币种 asset==liab/equity）。不过 → Run=`INTERNAL_BREAK`，停。
2. 逐外部账户/钱包：余额对账(§7)→不平开 Case；流水对账(§8,仅 true)→异常入 Case。
3. 汇总 Run：walletsChecked / casesOpened / orphan&mismatch 计数 / `PASS|BREAK`。

## 12. eventCode 分类表（写 plan 前必做）
把现有所有 eventCode 列一遍，逐个标 `direction(IN/OUT)` + `isExternalCrossing(true/false)` + `walletRef 取哪侧钱包`：
- 充值到账 `DEPOSIT_ASSET_TO_SUSPENSE` = IN / true（externalRef=链上/银行入账 ref；walletRef=客户充值地址/vIBAN）
- 合规放行 `DEPOSIT_SUSPENSE_TO_PAYABLE` = INTERNAL / false（无 ref；walletRef=客户钱包，两行同值）
- 提现出款 `WITHDRAW_NET_POST`/`WITHDRAW_FEE_POST` 与 payout = OUT / true（walletRef=客户钱包）
- 提现手续费收取(客户→公司钱包) = 客户侧 OUT/true + 公司侧 IN/true，**同 ref**
- 兑换真实腿(`C_DEP↔F_OPS`、`F_SET→C_VIBAN` 等) = 各自钱包 true；纯账面腿 = false
- 资本注入(若有) = 公司侧 IN / true（externalRef=银行入账 ref）

## 13. 验收（recon:demo 重写）
- `pass`：按账本生成"完美"外部对账单（每钱包外部行 = 其 `isExternalCrossing=true` 行、余额 = `PAYABLE+SUSPENSE` 之和）→ 0 Case 全 PASS。
- `break`：注入 `ORPHAN_INTERNAL`(删一条外部行)/`ORPHAN_EXTERNAL`(加一条)/`AMOUNT_MISMATCH`(改金额)/balance break(改一个余额) + manifest 答案键 → 引擎精确开对应 Case/LineItem，与 manifest 对得上。
- anchor-free（金额/客户从当期 demo 动态取）。

## 14. 决策点（写 plan 前定）
- eventCode 分类表逐项确认（§12）。
- 匹配时间窗 N、模糊匹配是否启用（先精确，留开关）。
- Case 处置（OPEN→调查→平账/豁免）本期做否（建议止于"检出+开 Case"，处置 deferred）。
- `AccountFlow` materialized 表 vs view（建议表）。
- `externalRef` 回填时机（提现/兑换在付款/链上确认时回填）。

## 15. 不做（deferred）
- Case 处置 / SLA / 自动平账(Reimbursement)。
- 冻结/合规拦截记账（不在本期，不引入 FROZEN_FUNDS）。
- 资本注入补写流水行（`FIRM_ASSET` 现状缺资本那笔，写 plan 时纳入或单独小修）。
- 旧 V8 五公式引擎删除（Phase C 清）。

## 16. 涉及的并行改动（非纯 Phase B，写 plan 时拆清）
- **流水基建**：`tb_transfer_evidence` 加 walletRef/externalRef/isExternalCrossing 四列 + 记账写入路径（充值/提现/swap/手续费四条流程）逐腿供给 + 新建 `AccountFlow` 投影。
- **Account Statement 页**：改读 `AccountFlow`，按 `walletRef` 视图 + 全量/外部对账两视图切换（合并 SUSPENSE[c]+PAYABLE[c] 两个会计账户的流水）。
- **verify:coa**：客户负债项继续 = `CLIENT_PAYABLE + DEPOSIT_SUSPENSE`（口径不变）。

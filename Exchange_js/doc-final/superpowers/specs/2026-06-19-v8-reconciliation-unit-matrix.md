# V8 对账 — 2×2 对账单元矩阵（所有权 × 货币）+ firm recon

日期：2026-06-19
状态：脑暴对齐 + 行业调研完成，**设计待评审（用户选"先出 spec + 原型"，未实现）**
触发：用户问「run 是否应按 货币 + 客户/公司侧 分组成四格？现在感觉合在一起了」+ 要求行业调研。

---

## 0. 行业调研结论（事实驱动，4 独立来源）

| 来源 | 关键发现 |
|---|---|
| **VARA 托管规则**（迪拜，本法域） | VASP 必须"segregate client VAs from their own, maintain accurate reconciliation and proof of reserves"——客户/自有**分离对账是强制** |
| **FCA CASS 7** | 双对账：**内部**(客户义务 vs 客户资源) + **外部**(本方记录 vs 第三方)；外部"on account balance level, **currency by currency**" |
| **加密三方对账**（TRES/Cryptio） | omnibus 混仓 → 拆成独立 workflow：Exchange Recon(客户负债) + Custodian Recon(资产背书)；三方 = 账本↔托管↔**区块链** |
| **银行 nostro/多实体** | 分组沿三轴：法律实体 / **货币** / **所有权(own vs client)**；break 要 identified→classified→aged→escalated→resolved |

**收敛**：对账分组的两条标准轴 = **所有权（客户/公司）× 货币**。所有权分离是**监管强制**，非展示偏好。

来源链接见文末。

## 1. 对账单元模型（reconciliation unit）

**一次 run 产出 N 个对账单元 = {所有权} × {货币}。** 当前 2 币种 × 2 所有权 = **4 单元**：

|  | AED (Zand) | USDT (HexTrust) |
|---|---|---|
| **客户**（safeguarded） | A.CLIENT_BANK ⟺ C_* 银行账户 | A.CLIENT_CUSTODY ⟺ C_* vault |
| **公司**（own funds） | A.FIRM_TREASURY ⟺ F_* 银行账户 | A.FIRM_TREASURY ⟺ F_* vault |

- **所有权为主轴**（监管分离、独立 owner/SLA），货币为次轴。

## 1.5 不变量的真实作用域（关键纠正 —— I1–I5 不是全客户、不按所有权切）

逐行核 invariant-checker.service.ts + balance-recon.service.ts，I1–I5 是**按用途混编**的套件，**作用域分三层**，不能整体塞进某一格：

| 不变量 | severity | 校验 | **作用域** |
|---|---|---|---|
| **I4** | ATTESTATION | `Σ debit_net(全账户)=0` | **整账（per 货币）**——含客户+公司+FX+suspense，横跨两行 |
| **I3** | BUSINESS | `A.FX_POSITION − R.FX_UNREALIZED_PNL` | **FX 头寸账（per 货币）**——平台/公司交易盘，非客户 |
| **I1** | SAFEGUARDING | `A.CLIENT_*` = `L.CLIENT_PAYABLE+SUSPENSE+CLEARING` | **仅客户** |
| **I2** | BUSINESS | `L.TRADE_CLEARING → 0` | **仅客户**（交易清算桥） |
| **I5** | ACCOUNT_ACTUAL | TB 账户 vs 外部实际(+in-transit) | **per 账户容器**——客户、公司各跑各的 |

分层结论：
- **全局层（per 货币，横跨客户+公司）**：I4 整账 + I3 FX 盘。**不属于任何一格**，在矩阵之上一次算完。
- **客户行专属**：I1 safeguarding + I2 清算桥。
- **每格各自**：I5 账实（客户格、公司格都有自己的 I5）。

## 2. 客户 vs 公司：不对称（仅 I1/I2 之差，非 I1–I4 之差）

| 维度 | 客户单元 | 公司单元 |
|---|---|---|
| 资产科目 | A.CLIENT_BANK / A.CLIENT_CUSTODY | A.FIRM_TREASURY |
| 负债侧 | **有**：L.CLIENT_PAYABLE + suspense + clearing | **无**——是 equity/retained，不欠任何人 |
| **I1 safeguarding** | ✅ 资产=负债（监管核心） | ❌ 不适用（无客户负债侧） |
| **I2 清算桥** | ✅ 客户交易清算 | ❌ 不适用 |
| **I5 账实** | ✅ TB vs 客户外部账户 | ✅ TB(A.FIRM_TREASURY) vs F_* 外部账户 |
| **I3/I4** | 由全局层覆盖（非客户专属） | **同样被全局层覆盖**（I4 整账本就含公司科目，I3 FX 盘本就是公司的） |
| 监管权重 | VARA/CASS 强制 safeguarding | corporate treasury 内控 |

**结论**：公司侧**不是"只剩 I5、I1–I4 全缺"**——它被全局层 I4（整账含公司）+ I3（FX 盘即公司）+ 自己的 I5 覆盖；唯一**正当地没有**的是 I1/I2（无客户负债）。客户与公司之差 = **I1+I2**，不是 I1–I4。

## 3. 数据模型变更

- `ReconciliationCase` 增 `ownership` 字段（enum CLIENT | FIRM；默认现有数据 CLIENT）。Case 主键语义 (businessDate, assetId, ownership) → 一次 run 最多 4 case。
- `caseNo` 含 ownership：`REC-{date}-{ccy}-{C|F}-{nnn}`。
- `InvariantCheck` / `ReconciliationLineItem` 已挂 caseId/runId，随 ownership 自然分流。
- COA 常量加 `FIRM_ASSET_CODE = 'A.FIRM_TREASURY'`（两层共用，firm 不分 bank/custody 科目则单科目；若后续分则 LAYER 映射）。

## 4. 引擎变更

`reconciliation-run-workflow.ts`：每币种先跑**全局层**，再按所有权分格跑**容器层**：
- **全局层（per 货币，一次）**：`InvariantCheckerService` 算 I3（FX 盘）+ I4（整账 Σdebit_net=0，含客户+公司科目）。挂在 run/币种层，**不挂某个 ownership case**。I1/I2 也由该 service 产出，但**只在 CLIENT 分支采用**。
- **容器层 ownership=CLIENT**：`tb = bal[LAYER_ASSET_CODE[layer]]`，external = client-scoped（`C_*`），跑 **I1 + I2 + I5**。
- **容器层 ownership=FIRM**：`tb = bal['A.FIRM_TREASURY']`，external = firm-scoped（`F_*`），跑 **I5 only**（I1/I2 不适用——无客户负债侧；I3/I4 已由全局层覆盖，不重复）。
- external 适配器 `balanceAt/txsForDate` 增 `ownership` 入参（或两个 provider token），按 walletRole 前缀过滤（C_ / F_）。
- 闭合自检（Σunmatched == I5delta）每**容器单元**独立成立。
- `InvariantCheck` 落库增 `scope` 字段（LEDGER_WIDE | CLIENT | CONTAINER）区分全局/客户/容器，前端据此分层展示。

## 5. Admin UI — 2×2 矩阵

run 详情页用**「整账条 + 2×2 矩阵」两层**（已出纠正版原型 `recon_2x2_unit_matrix_corrected`）：
- **整账条（矩阵之上）**：per 货币展示 I4（Σdebit_net=0）+ I3（FX 盘），标注"covers client + firm together"。这是全局层，不属于任何格。
- **2×2 矩阵**：行=客户/公司，列=货币；格内：status pill(balanced/break) + I5 delta(大字 mono) + 检查指示（客户格 `I1 ✓ / I5 ✓✗`；公司格 `I5 ✓✗ / no I1`） + N breaks + M statements。
- **点格下钻**：仅该容器的 per-container 检查（客户=I1+I2+I5；公司=I5，I1 标 n/a "own funds, no client liability"）+ TB vs external + unmatched line items + 闭合恒等式。**不在格内重复 I3/I4**（在整账条）。
- 比「4 个平铺 tab」更可扫读；tab 为可选退化。
- 遵 frontend-admin：adm-* token、英文、矩阵格用 StatusPill、下钻复用 DetailCard/表格原语。Per-entity 表给 Case 增 ownership 字段。

## 6. 范围与分期

- **本设计**：补 firm 单元 + 4 单元矩阵 + UI。Phase 1 correctness 完形（客户+公司全景闭环）。
- **firm 内部 tie-out（equity/P&L）**：Phase 1 标 n/a，真实 equity 对账延后。
- **加密三方（+区块链独立源）**：未来增强，本次仍账本↔托管两方。
- **C_MAIN/C_OUT 真实 vaultId 落库**：仍 demo 合成。

## 7. 验收（实现时）
- 引擎单测：firm 单元 I5 用 A.FIRM_TREASURY + F_* external；客户单元不变；闭合每单元成立。
- `npm test` 全绿 / tsc 0。
- demo：4 单元各产出 case + 闭合 PASS。
- 渲染：run 详情 2×2 矩阵，4 格状态正确，点格下钻；firm 格 internal 标 n/a。

## 来源
- FCA CASS 7（client money rules / 7.15 reconciliations / 7.16 standard methods）: https://handbook.fca.org.uk/handbook/cass7
- AutoRek CASS 7 guide: https://www.autorek.com/blogs/a-guide-to-fca-cass-7-rules-requirements-challenges-best-practices/
- VARA Custody Services Rulebook（Segregation and Control / Segregation and safekeeping）: https://rulebooks.vara.ae/rulebook/custody-services-rulebook
- TRES Finance（custodian reconciliation / multi-source）: https://tres.finance/managing-crypto-the-importance-of-custodian-reconciliation/
- Cryptio（exchanges & custodians internal ledger recon）: https://blog.cryptio.co/exchanges-and-custodians-reconcile-crypto-settlements-with-an-internal-ledger-system-at-scale
- Gresham / Smartstream（multi-entity / multi-currency enterprise recon）: https://www.greshamtech.com/solutions/reconciliations

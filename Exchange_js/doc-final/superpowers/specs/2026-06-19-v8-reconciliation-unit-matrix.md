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
- 每单元内含 **CASS 双对账**：内部（I1–I4）+ 外部（I5）。

## 2. 客户 vs 公司：不对称（关键，用户已点出）

| 维度 | 客户单元 | 公司单元 |
|---|---|---|
| 资产科目 | A.CLIENT_BANK / A.CLIENT_CUSTODY | A.FIRM_TREASURY |
| 负债侧 | **有**：L.CLIENT_PAYABLE + suspense + clearing | **无**——是 equity/retained，不欠任何人 |
| **内部对账(I1)** | 隔离不变量：资产 = 负债（强意义，监管核心） | 无客户负债对应物 → 退化为 **equity/P&L tie-out**（弱意义；Phase 1 可标 n/a） |
| **外部对账(I5)** | TB vs 客户外部账户（账实） | TB(A.FIRM_TREASURY) vs F_* 外部账户（账实）——**这才是公司侧主检查** |
| 监管权重 | VARA/CASS 强制 safeguarding | corporate treasury 内控 |

**结论**：公司侧的核心是**外部账实对账(I5-firm)**；内部不变量(I1)对公司**不适用**（无负债侧），标 n/a 或留作未来 equity tie-out。四格中公司两格主要跑 I5-firm。

## 3. 数据模型变更

- `ReconciliationCase` 增 `ownership` 字段（enum CLIENT | FIRM；默认现有数据 CLIENT）。Case 主键语义 (businessDate, assetId, ownership) → 一次 run 最多 4 case。
- `caseNo` 含 ownership：`REC-{date}-{ccy}-{C|F}-{nnn}`。
- `InvariantCheck` / `ReconciliationLineItem` 已挂 caseId/runId，随 ownership 自然分流。
- COA 常量加 `FIRM_ASSET_CODE = 'A.FIRM_TREASURY'`（两层共用，firm 不分 bank/custody 科目则单科目；若后续分则 LAYER 映射）。

## 4. 引擎变更

`reconciliation-run-workflow.ts`：外层循环从「asset」改为「asset × ownership」：
- ownership=CLIENT：`tb = bal[LAYER_ASSET_CODE[layer]]`（现状），external = client-scoped（C_*），跑 I1–I5。
- ownership=FIRM：`tb = bal['A.FIRM_TREASURY']`，external = firm-scoped（`walletRole F_*`），跑 **I5 only**（I1–I4 标 n/a 或跳过，记录为 N/A check 供前端展示完整性）。
- external 适配器 `balanceAt/txsForDate` 增 `ownership` 入参（或两个 provider token），按 walletRole 前缀过滤（C_ / F_）。
- 闭合自检（Σunmatched == I5delta）每单元独立成立。

## 5. Admin UI — 2×2 矩阵

run 详情页头部用 **2×2 矩阵汇总**（已出原型 `recon_2x2_unit_matrix`）：
- 行=客户/公司，列=货币；格内：status pill(balanced/break) + I5 delta(大字 mono) + internal/external 双指示 + N breaks + M statements。
- 点格下钻：该单元的内部检查表(I1–I4 / firm 标 n/a) + 外部检查(TB vs external) + unmatched line items + 闭合恒等式。
- 比「4 个平铺 tab」更可扫读（2×2 一眼看全 run 健康度）；tab 为可选退化。
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

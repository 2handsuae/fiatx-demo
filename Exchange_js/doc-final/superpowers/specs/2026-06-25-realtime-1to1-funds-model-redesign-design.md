# 实时 1:1 资金模型重设计 (Real-time 1:1 Funds Model Redesign)

> 状态：设计基线 / 讨论收口（pre-implementation）
> 日期：2026-06-25
> 适用：取代 V7 funds-layer 的「池化 + 延迟/EOD 轧差结算」模型；连带重写 V8 对账
> 决策来源：2026-06-25 与产品 owner 的 brainstorm 全程收口（见本文 §11 决策日志）

---

## 0. 一句话定义

> 取消一切延迟结算。**每个客户、每个公司银行账户都有自己的专属钱包，钱就留在里面；每个钱包 1:1 对应一个账面账户，余额理论上恒等于钱包真实余额。** 充值/提现/兑换全部**实时**完成，每一笔真实转账对应一条记账。不再有 Outstanding（待交割单）、FeeAccrual（待收费单）、SettlementBatch（结算批）、EOD 轧差。对账退化为「逐账户余额比对」。

---

## 1. 核心原则

1. **专属钱包，不池化**：客户充值的钱留在其专属 vault(币)/vIBAN(法币)，不再归集到公司大池。
2. **逐账户 1:1**：每个物理账户 ↔ 一个账面账户，数字恒等于钱包真实余额。
   - 客户侧账面账户 = **负债**（`CLIENT_PAYABLE`，我们欠客户的）。
   - 公司侧账面账户 = **权益**（`FIRM_*`，公司自有资金）。
3. **聚合资产各一个**：客户侧一个聚合资产账户 / 币种、公司侧一个聚合资产账户 / 币种。
4. **实时物理结算**：兑换/提现当场真实搬钱（链上 tx / 银行指令），不轧差、不延迟。兑换顺序**先转出、再转入**。
5. **每笔转账 = 一条记账**：账面跟着物理走，物理几跳就记几条（含中转账户的一进一出）。
6. **手续费从客户账户实扣 + 合并展示**：底层是「真实从客户钱包扣出的一笔」；展示层把本金+费**合并成一行**，下钻看明细（详见 §6）。
7. **不做每笔 LP 平盘**：假设公司池流动性充足；FX 头寸自然累积在公司账户余额里，不单独建 FX 科目、不实时平盘（推后）。
8. **利润不单列科目**：删除收入/点差/FX 盈亏科目；利润体现为公司账面余额增长，从打标签的「手续费/点差」流水算出。

**1:1 恒等的两个合理例外**（其余时刻 钱包余额 = 账面余额）：
- 充值合规暂扣期：钱已到客户钱包但 KYT 审查中，计入 `DEPOSIT_SUSPENSE` 而非 `CLIENT_PAYABLE`。
- 一笔真实转账的在途瞬间：实时模型下窗口很短（链上确认时间）。

---

## 2. 新科目表（COA）

旧 13 个 code 砍到 **8 个 code**（3 大类：资产 A / 负债 L / 权益 E）。币种用 TigerBeetle ledger 区分（AED / USDT），code 只编类型。命名 `[CLASS].[ROLE]_[CCY]`。

| code | 类 | 科目 | 中文 | 粒度 |
|---|---|---|---|---|
| **1** | A 资产 | `CLIENT_ASSET` | 客户托管资产 | 聚合，系统级 1/币种（= Σ 所有客户钱包） |
| **50** | A 资产 | `FIRM_ASSET` | 公司资产 | 聚合，系统级 1/币种（= Σ 所有公司账户） |
| **100** | L 负债 | `CLIENT_PAYABLE` | 客户应付 | **每客户**，与其钱包 1:1 |
| **101** | L 负债 | `DEPOSIT_SUSPENSE` | 充值合规暂扣 | **每客户** |
| **200** | E 权益 | `FIRM_OPS` | 公司运营/流动性 | 单例（兑换对手盘） |
| **201** | E 权益 | `FIRM_SET` | 公司法币结算户 | 单例，**仅法币**（银行硬性要求） |
| **202** | E 权益 | `FIRM_FEE` | 公司手续费 | 单例 |
| **203** | E 权益 | `FIRM_LIQ` | 公司流动性储备 | 单例（**本版挂着不用**，未来 LP） |

编码段：`1–99 资产 / 100–199 负债 / 200–299 权益`，留空号扩展。

**实例化清单（AED + USDT）**：
- AED：`CLIENT_ASSET_AED`、`CLIENT_PAYABLE_AED`(每客户)、`DEPOSIT_SUSPENSE_AED`(每客户)、`FIRM_ASSET_AED`、`FIRM_OPS_AED`、`FIRM_SET_AED`、`FIRM_FEE_AED`、`FIRM_LIQ_AED`
- USDT：`CLIENT_ASSET_USDT`、`CLIENT_PAYABLE_USDT`(每客户)、`DEPOSIT_SUSPENSE_USDT`(每客户)、`FIRM_ASSET_USDT`、`FIRM_OPS_USDT`、`FIRM_FEE_USDT`、`FIRM_LIQ_USDT`
- 注意：**USDT 无 `FIRM_SET`**（crypto 每个 vault 独立、无主账户，不经结算户；法币 vIBAN 是 SET 主账户下的子账户，故有）。

**两条对账恒等式（逐币种）**：
- 客户：`CLIENT_ASSET = Σ CLIENT_PAYABLE[客户] + Σ DEPOSIT_SUSPENSE[客户]`
- 公司：`FIRM_ASSET = FIRM_OPS + FIRM_SET(法币) + FIRM_FEE + FIRM_LIQ`

**删除的 8 个旧 code**：`10 CLIENT_CUSTODY`(并入 CLIENT_ASSET)、`60 FX_POSITION`、`110 TRADE_CLEARING`、`210 RETAINED_EARNINGS`、`300 FEE_INCOME`、`310 SPREAD_INCOME`、`320 FX_UNREALIZED_PNL`、`330 FX_REALIZED_PNL`。（旧 `1 CLIENT_BANK` 语义并入 `CLIENT_ASSET`。）

---

## 3. 钱包拓扑 + 法币路由规则

**物理账户**：
- 客户侧：每客户每币种一个专属钱包 —— `CLIENT_VIBAN`(法币, Zand)、`CLIENT_VAULT`(币, HexTrust)。
- 公司侧：`FIRM_OPS`(运营/流动性)、`FIRM_SET`(法币结算户，仅 AED)、`FIRM_FEE`(手续费)、`FIRM_LIQ`(储备，挂着)。
- 外部：链上地址 / 外部银行；LP Pool（本版不接）。

**法币路由规则（锁定）**：
- `vIBAN ↔ OPS`：**必经 SET**（银行硬性约束，2 物理跳）。
- `vIBAN → FEE`：**直连**（1 跳）。
- `vIBAN → 外部`（提现）：**直连**（1 跳）。
- crypto：一律**直连**。
- 公司内部（OPS/FEE/LIQ 之间）：直连，不经 SET。
- 推论：**SET 只在兑换的 vIBAN↔OPS 腿用到**；充值、提现都不碰 OPS/SET。SET 常态余额 ≈ 0（一进一出）。

**记账约定**：
- 跨账本转账（客户 ↔ 公司）：4 个动作（各侧 资产 + claim）。
- 公司内部转账（OPS/SET/FEE/LIQ 间）：2 个动作（权益 ↔ 权益），聚合 `FIRM_ASSET` 不变。
- 外部边界（充值进 / 提现出）：2 个动作（对应侧 资产 + claim），外部不记账。

---

## 4. 业务流记账（worked examples）

### 4.1 充值（crypto / fiat 同构，钱留客户钱包）
例：充值 X。
- **Step1 到账入暂扣**（payin 确认时）：外部 → 客户钱包
  - `CLIENT_ASSET +X` · `DEPOSIT_SUSPENSE[c] +X`
- **Step2 合规通过释放**（KYT/TR 全过；无物理移动）：
  - `DEPOSIT_SUSPENSE[c] −X` · `CLIENT_PAYABLE[c] +X`
- 客户流水：`+X 充值到账`。无 OPS/SET。

### 4.2 提现（crypto / fiat 同构）
例：提现 1000，手续费 10。
- **提现腿**（客户钱包 → 外部，直连）1000：`CLIENT_ASSET −1000` · `CLIENT_PAYABLE[c] −1000`
- **手续费腿**（客户钱包 → FIRM_FEE，直连）10：
  - `CLIENT_ASSET −10` · `CLIENT_PAYABLE[c] −10`
  - `FIRM_ASSET +10` · `FIRM_FEE +10`
- 余额锁定：客户发起时锁定（pending），物理确认后 finalize（post），失败/拒绝 void。
- 客户流水（合并）：`−1010 提现 ▸ 提现 1000 + 手续费 10`。无 OPS/SET。

### 4.3 兑换（USDT → AED；只有 AED+USDT，故每笔都是 币↔法币）
例：卖 1000 USDT，毛 3670 AED，手续费 20 AED，净到账 3650。**先转出（USDT）再转入（AED）**。

**① 卖出 USDT**（crypto 直连，1 跳，跨账本）：客户 vault → `FIRM_OPS_USDT` 1000
- `CLIENT_ASSET_USDT −1000` · `CLIENT_PAYABLE[c]_USDT −1000`
- `FIRM_ASSET_USDT +1000` · `FIRM_OPS_USDT +1000`

**② 买入 AED 毛额**（fiat 经 SET，2 跳）：
- [公司内] `FIRM_OPS_AED → FIRM_SET_AED` 3670 → `FIRM_OPS_AED −3670` · `FIRM_SET_AED +3670`（FIRM_ASSET 不变）
- [跨账本] `FIRM_SET_AED → 客户 vIBAN` 3670 →
  - `FIRM_ASSET_AED −3670` · `FIRM_SET_AED −3670`
  - `CLIENT_ASSET_AED +3670` · `CLIENT_PAYABLE[c]_AED +3670`

**③ 手续费 AED**（直连，1 跳，跨账本）：客户 vIBAN → `FIRM_FEE_AED` 20
- `CLIENT_ASSET_AED −20` · `CLIENT_PAYABLE[c]_AED −20`
- `FIRM_ASSET_AED +20` · `FIRM_FEE_AED +20`

**校验**：`FIRM_SET_AED` 净额 = +3670−3670 = 0 ✓；客户净 −1000 USDT / +3650 AED ✓；公司净 +1000 USDT / −3650 AED（OPS −3670、FEE +20）✓；两条恒等式成立 ✓。
**反向 AED→USDT** 对称：AED 腿经 SET 转出（`vIBAN→SET→OPS`），USDT 腿直连转入，手续费在 USDT（`vault→FIRM_FEE_USDT`）。

---

## 5. 客户对账单 / 流水（展示层）

- **真相层**：上述逐跳双分录 + 真实转账记录（`InternalFund`），逐笔可审计。手续费是真实从客户账户扣出的一笔。
- **展示层（加工）**：按业务事件**合并成一行 + 下钻明细**。
  - 提现：`−1010 提现`，下钻 `提现 1000 + 手续费 10`。
  - 兑换：`+3650 AED 兑换到账`，下钻 `毛 3670 − 手续费 20`；另一行 `−1000 USDT 兑换转出`。
  - 充值：`+X 充值到账`。
- 合并安全的前提：所有手续费都真实从客户账户扣除，展示合并不会失真。

---

## 6. 对账（重写）

实时 1:1 后，旧的「五公式 credit-net 引擎」失去存在意义（它是为延迟/池化产生的 gap 服务的）。**退役** `credit-net` / `formula-checker` / `leg-projection` / `match-engine-v2` / `anomaly-classifier`。

**新对账 = 逐账户余额比对**：
- 每客户：vault/vIBAN 真实余额（HexTrust/Zand 拉取）`==` `CLIENT_PAYABLE[c] + DEPOSIT_SUSPENSE[c]`。
- 每公司账户：真实余额 `==` 对应 `FIRM_*` 权益账户。
- 两条恒等式（§2）作总账自检。
- **在途**（提现已发未确认 / 充值已检未确认）单列为「已知在途」，非差异。
- 差异 = 某账户「账面 ≠ 物理」且非在途 → 进 Case 人工核实。

**保留并简化**：外部对账单摄入（`external_balances` / `external_statement_lines`）、Run/Case admin 页（改为逐账户比对视图）。

---

## 7. 拆除 / 改造 / 保留清单（"动哪些筋骨"）

**❌ 删除**
- `Outstanding`（实体 + service + outstanding-consumer）
- `FeeAccrual`（实体 + service + fee-accrual-listener）
- `SettlementBatch`（实体 + service）
- EOD 结算 workflow + sweep cron（`eod-settlement-*`）
- 充值归集 workflow + sweep cron（`deposit-aggregation-*`）
- `FxEodService`（桥扫 + FX 重估 + LP 平盘）
- 旧 TB 科目 8 个（见 §2）+ 相关旧 transfer codes
- V8 五公式对账引擎（见 §6）

**🔧 改造**
- `swap-workflow`：去 TRADE_CLEARING 桥、去 Outstanding、去 FeeAccrual → 实时三腿物理转账（§4.3）
- `withdraw-workflow`：去 FeeAccrual、去热钱包归集（FUND_OUT）→ 客户钱包直出 + 手续费腿（§4.2）；保留余额锁定
- `deposit-workflow`：去归集 → 留 suspense 两步、钱留钱包（§4.1）
- 法币结算 / 法币费收取 workflow → 并入实时腿
- `internal-transfer-paths` 白名单 → 新最小集（兑换的 vIBAN↔OPS↔(SET) + 各类直连）
- TB 科目表 + transfer codes → 新 COA（§2）
- 对账 → §6

**✅ 保留**
- `InternalFund` / `InternalTransaction`（每笔真实转账记录）—— 简化，去 SettlementBatch/Outstanding 关联
- 提现余额锁定（TB pending/post/void）—— 交易安全
- 外部对账单摄入（`external_balances`）—— 简化复用
- 客户专属钱包 provisioning（vIBAN / vault）
- `DEPOSIT_SUSPENSE` 合规暂扣

**🆕 新增**
- 新 COA 5 类型 + provisioning（每客户 PAYABLE/SUSPENSE、每公司账户 FIRM 权益、聚合 ASSET）
- 客户流水「加工层」（合并展示 + 下钻）
- 实时结算的转账编排（先转出再转入、法币经 SET 路由）

---

## 8. 分期实施计划（owner 选「分期」；2026-06-25 收口重切为 3 期）

> 重切原因：换 COA 是**全局原子操作**——新旧码号冲突（`1/50/200`）+ 删 `TRADE_CLEARING` 桥即破旧流，COA 与三大流无法在「主干可编译」前提下拆成两期，故合并为 Phase A。

每期独立可交付、可验收。**fresh DB，不迁历史数据**（重建期）。

- **Phase A — 资金核心**：新 COA 常量 + provisioning + seed + `AccountingService` 适配 + 新 transfer codes；swap/withdraw/deposit 改实时模型并产出真实转账记录；停止创建 Outstanding/FeeAccrual、停用 EOD/归集 cron；不变量自检脚本。验收：三流端到端 happy path + 逐账户/逐跳对平 + 两条恒等式通过。
- **Phase B — 对账重写**：退役五公式引擎，建逐账户比对 + 恒等式 + 在途；简化外部摄入与 Run/Case 页。验收：人为造差能定位、无差时全绿。
- **Phase C — 前端 + 死代码总清除**：客户流水加工层（合并+下钻）、admin COA 视图更新；删除全部孤儿代码（Outstanding/FeeAccrual/SettlementBatch/EOD/FxEod/旧科目/旧 transfer codes/五公式引擎/旧白名单）。验收：渲染截图比对 + build 绿 + 无死引用。

> 每期单独走 writing-plans 出实施计划。本设计文档是 Phase A 计划的输入。

---

## 9. 推后 / 不做（out of scope）

- **LP 平盘**：`FIRM_LIQ` 本版挂着不用；公司 FX 头寸 = 公司账户余额，不实时平盘、不建 FX 科目。
- **利润表**：不单列收入科目；P&L 从打标签的手续费/点差流水算。
- **数据迁移**：本仓库处于重建期，默认**新库 / 新 TB ledger 起**；若需迁移历史 Outstanding/FeeAccrual 余额，另列迁移脚本（待定）。
- **多币种扩展**：当前仅 AED+USDT，故兑换恒为 币↔法币。未来若加币种出现 币↔币 兑换（两腿皆 crypto 直连、无 SET），需补流程（未做）。

---

## 10. 不变量速查

- 每客户：`vault/vIBAN 余额 = CLIENT_PAYABLE[c] + DEPOSIT_SUSPENSE[c]`
- 每公司账户：`余额 = 对应 FIRM_* 权益`
- 逐币种：`CLIENT_ASSET = Σ(CLIENT_PAYABLE + DEPOSIT_SUSPENSE)`；`FIRM_ASSET = FIRM_OPS + FIRM_SET(法币) + FIRM_FEE + FIRM_LIQ`
- `FIRM_SET` 常态净额 ≈ 0（过路）
- 兑换：先转出后转入；`FIRM_SET` 仅用于 vIBAN↔OPS 腿
- 手续费：真实从客户账户扣出 → `FIRM_FEE`

---

## 11. 决策日志（2026-06-25 brainstorm 收口）

1. 账户结构：资产聚合（客户/公司各一）、负债/权益按账户 1:1。✅
2. 兑换结算模型：选 **A 实时物理结算**（每笔真搬钱）；**不做每笔 LP 平盘**（池子假设够）；**先转出再转入**。✅
3. 手续费：真相层 = 真实从客户账户扣出的一笔；展示层 = 合并一行 + 下钻。✅
4. 公司侧「其余都不要了」：删收入/点差/FX/留存科目；公司账户记为权益。✅
5. COA：8 code（§2），owner 亲自定名 + 确认。✅
6. `FIRM_SET_AED` 因银行硬性约束保留（法币 vIBAN↔OPS 必经）；`FIRM_LIQ` 挂着。✅
7. 法币路由：vIBAN↔OPS 经 SET；vIBAN→FEE 直连；vIBAN→外部 直连；crypto 直连；crypto 提现 vault 直出。✅
8. V8 五公式对账引擎退役。✅
9. 实施：分期。✅

# TC-02 · 资金单（Funds Order）测试用例

> 对应 PRD《2. 资金单 · Funds》v2.1 ｜ 域码 `FND` ｜ 30 条
> 口径与排除范围见 [README.md](README.md)

**本篇排除**：演示用模拟推进 advance 端点（PRD 非目标 5）；记账失败的专用修复入口（G2）。
**触发方式说明**：外部确认（链上 / 银行）当前由 demo 脚手架驱动，用例中「令资金单达 CONFIRMED」指经该路径触发，不影响断言。

---

## 1. 建单与父子关系（FR-1）

| ID | 锚点 | 类型 | P | 标题 | 前置 | 步骤 | 预期 | 备注 |
|---|---|---|---|---|---|---|---|---|
| TC-FND-001 | FR-1 | 正例 | P0 | 每次真实资金移动建一张单并生成业务键 | — | ① 发起一笔充值 ② 查资金单 | 生成 1 张资金单，有唯一 `fundsOrderNo`；挂 `depositTransactionId`；`legSeq=1`、`attempt=1` | 追账只认 fundsOrderNo |
| TC-FND-002 | FR-1 | 边界 | P1 | 三个父 FK 恰一有值 | — | ① 分别查充值/提现/兑换产生的资金单 | 每张单 deposit / withdraw / swap 三个父 FK **恰有一个非空**；方向由其决定（IN / OUT / INTERNAL） | 三者互斥 |
| TC-FND-003 | FR-1 | 正例 | P1 | 多腿业务的腿序号正确 | — | ① 跑一笔含手续费的提现 ② 跑一笔兑换 | 提现 = 2 张（legSeq 1 本金、2 手续费）；兑换 = 4 张（legSeq 1~4）；同父下 legSeq 不重复 | — |

## 2. 状态机四套迁移表（3. 状态机 · AC-1.x）

| ID | 锚点 | 类型 | P | 标题 | 前置 | 步骤 | 预期 | 备注 |
|---|---|---|---|---|---|---|---|---|
| TC-FND-004 | AC-1.1 | 正例 | P0 | CRYPTO_OUT 五步全程 | 发起虚拟币提现 | ① 依次推进 SUBMIT → OBSERVE_CONFIRMING → CONFIRM → CLEAR | 状态依次 `CREATED → SUBMITTED → CONFIRMING → CONFIRMED → CLEARED`，每步成功 | 提现/兑换币腿 |
| TC-FND-005 | AC-1.1 | 反例 | P0 | 非法跳步被拒 | 单据处于 CREATED | ① 直接执行 CONFIRM（跳过 SUBMITTED/CONFIRMING） | 被拒绝，状态仍 `CREATED`；错误明确为非法跃迁 | 逐步不跳步 |
| TC-FND-006 | AC-1.2 | 正例 | P0 | FIAT_IN 出生即 CONFIRMED 且单跳 CLEARED | 发起法币充值 | ① 查建单后初始状态 ② 执行 CLEAR | 出生态 = `CONFIRMED`（无 CREATED/SUBMITTED/CONFIRMING）；一跳到 `CLEARED` | 法币充值无确认阶段 |
| TC-FND-007 | 3. 迁移表 | 正例 | P1 | CRYPTO_IN 出生 SUBMITTED、无 CREATED 段 | 发起虚拟币充值 | ① 查建单后初始状态 ② 全程推进 | 出生态 = `SUBMITTED`；路径 SUBMITTED → CONFIRMING → CONFIRMED → CLEARED；**无 TIMEOUT 旁支** | — |
| TC-FND-008 | 3. 迁移表 | 正例 | P1 | FIAT_OUT 跳过 CONFIRMING | 发起法币提现 | ① 推进 SUBMIT → CONFIRM | `CREATED → SUBMITTED → CONFIRMED → CLEARED`；中间**无** CONFIRMING | — |
| TC-FND-009 | 3. 选表 | 边界 | P1 | INTERNAL 方向按资产走 OUT 表 | 跑一笔兑换（含币腿与法币腿） | ① 分别查币腿与法币腿的可用跃迁 | 币腿走 CRYPTO_OUT（5 步含 CONFIRMING）、法币腿走 FIAT_OUT（4 步）；均按 OUT 表而非 IN 表 | 机械路由 |
| TC-FND-010 | AC-1.3 / FR-2 | 反例 | P0 | 记账失败则不进终态 | 可注入记账失败 | ① 令 CLEAR 时记账失败 ② 查状态 | 状态**停在 CONFIRMED 不进 CLEARED**（fail-closed）；不出现「状态到终点账没记」 | 账钱一致铁律 |
| TC-FND-011 | 3. 约束 | 反例 | P1 | 终态不可逆 | 单据已 CLEARED / FAILED / TIMEOUT | ① 尝试对终态单执行任意动作 | 全部被拒，状态不变 | — |

## 3. CONFIRMED 回写（FR-3/FR-4 · T1 · AC-2.x）

| ID | 锚点 | 类型 | P | 标题 | 前置 | 步骤 | 预期 | 备注 |
|---|---|---|---|---|---|---|---|---|
| TC-FND-012 | AC-2.1 / FR-3 | 正例 | P0 | crypto 出账单 CONFIRMED 铸 txHash | 虚拟币提现推至 CONFIRMED | ① 查该单外部凭证字段 | `txHash` 非空（以 fundsOrderNo 为种子铸出）；`referenceNo` 为空 | — |
| TC-FND-013 | AC-2.1 / FR-3 | 正例 | P0 | fiat 出账单 CONFIRMED 铸 referenceNo | 法币提现推至 CONFIRMED | ① 查该单外部凭证字段 | `referenceNo` 非空；`txHash` 为空 | — |
| TC-FND-014 | AC-2.2 / FR-3 | 边界 | P0 | 充值 crypto 沿用入金真号、不被覆盖 | 侦测入金时带真实 txHash | ① 令该充值资金单达 CONFIRMED ② 比对 txHash | txHash **仍为发起方带入的真实值**，未被铸号覆盖 | 幂等的核心场景 |
| TC-FND-015 | FR-3 | 边界 | P1 | externalRef 只在首达 CONFIRMED 铸一次 | 单据已 CONFIRMED 且有 externalRef | ① 重复触发 CONFIRMED（重试/重放） | externalRef 值**不变**，不重新铸号 | 幂等 |
| TC-FND-016 | AC-2.3 / FR-4 | 正例 | P1 | crypto 单回写 gas 成本与币种 | 虚拟币单达 CONFIRMED | ① 查 transferCost / transferCostCurrency | 二者非空；币种为链原生币（如 `TRX`），数值为该笔链上 gas | 例：1.38985 TRX |
| TC-FND-017 | AC-2.3 / FR-4 | 边界 | P1 | 法币充值成本 11 AED、提现成本 12 AED | 分别跑法币充值与法币提现 | ① 各查 transferCost | 充值单 = `11 AED`；提现单 = `12 AED` | PRD 明列数值 |
| TC-FND-018 | FR-4 | 边界 | P1 | 内部账户互转不收成本 | 跑一笔兑换的公司内部腿 | ① 查该腿 transferCost | 为 0 / 空——内部互转不产生外部渠道成本 | — |
| TC-FND-019 | AC-2.4 / FR-4 | 边界 | P0 | transferCost 不参与净额计算 | 已知某单 amount 与 transferCost | ① 核对客户侧净额与账本记账额 | 净额与记账额**不因 transferCost 变化**；成本仅作独立记录 | 成本≠客户手续费 |
| TC-FND-020 | 4. 数据 | 边界 | P1 | 转账成本与客户手续费严格区分 | 一笔含手续费的提现 | ① 比对本金腿/费用腿的 transferCost 与订单层 feeAmount | 两者为**不同字段、不同语义**，数值互不影响；transferCost 记我方对外支出，feeAmount 记向客户收取 | 常见混淆点 |

## 4. 兑换腿自愈（FR-5 · T3/T4 · AC-3.x）

| ID | 锚点 | 类型 | P | 标题 | 前置 | 步骤 | 预期 | 备注 |
|---|---|---|---|---|---|---|---|---|
| TC-FND-021 | AC-3.1 / FR-5 | 正例 | P0 | 腿失败叠新 attempt、旧行留档 | 兑换某腿 attempt=1 | ① 令该腿 FAIL | 旧行保留为 `FAILED`（**不改写**）；新增同 legSeq、attempt=2 的新行；旧行 pending 已 void | 叠新行不改旧行 |
| TC-FND-022 | AC-3.2 / FR-5 | 边界 | P0 | 连续 3 次失败后不再自动重试 | 同腿已失败 2 次 | ① 令第 3 次 attempt 失败 | 不再产生 attempt=4；订单置 `needsReview`，等人工 resume | MAX_LEG_ATTEMPTS=3 |
| TC-FND-023 | FR-5 | 边界 | P1 | 活跃腿 = 同 legSeq 最大 attempt | 某 legSeq 存在 attempt 1(FAILED)、2(进行中) | ① 查该 legSeq 的活跃腿 | 返回 attempt=2 那行；attempt=1 仅作历史 | — |
| TC-FND-024 | T4 | 正例 | P1 | TIMEOUT 与 FAILED 同为异常终态 | 出账腿长时间无确认 | ① 触发 TIMEOUT | 状态 `TIMEOUT`（终态）；消费域按与 FAILED 相同方式处置（解锁 / 自愈） | CRYPTO_IN 无此旁支 |

## 5. 对账接缝与读面（FR-6/FR-7 · AC-4.x）

| ID | 锚点 | 类型 | P | 标题 | 前置 | 步骤 | 预期 | 备注 |
|---|---|---|---|---|---|---|---|---|
| TC-FND-025 | AC-4.1 | 正例 | P0 | 三视图分类正确 | 已有充值/提现/兑换各若干 | ① 分别取 payin / payout / internal 三视图 | payin = 挂 deposit 的单；payout = 挂 withdraw 且 legSeq=1；internal = 挂 swap 的单 | 供对账消费 |
| TC-FND-026 | AC-4.1 | 边界 | P0 | 提现手续费腿归 internal 而非 payout | 一笔含手续费提现（2 腿） | ① 查两腿各落哪个视图 | legSeq=1 → payout；**legSeq=2（费用腿）→ internal** | 易分错 |
| TC-FND-027 | AC-4.2 | 正例 | P0 | 非终态单可被认领为在途 | 某钱包有非终态资金单 | ① 按钱包查非终态资金单 | 该单被返回，可与孤儿外部流水配对为「在途」；终态单不被返回 | 对账在途识别入口 |
| TC-FND-028 | AC-4.3 / FR-7 | 正例 | P2 | 运营读面可见单据与状态 | — | ① 打开资金单列表 ② 进详情 | 列表可见单号/类型/状态/金额/外部号；详情可见状态与关键时间 | — |
| TC-FND-029 | FR-6 | 正例 | P2 | 四种筛选可用 | 列表有多类数据 | ① 按 fundsOrderNo 筛 ② 按订单类型（充/提/兑）筛 ③ 按资金单状态筛 ④ 按钱包 / IBAN 地址筛 | 四种筛选各自命中且结果正确；可组合 | — |
| TC-FND-030 | 3. 约束 | 正例 | P2 | 推进只留 statusHistory、不产生独立审计事件 | 一张已走完全程的单 | ① 查该单 statusHistory ② 查审计日志 | statusHistory 完整记录每一步（含时间）；审计日志中**无**资金单级生命周期事件（业务审计挂订单实体） | 分层原则 |

---

**覆盖对账**：AC-1.1→004/005 ｜ AC-1.2→006 ｜ AC-1.3→010 ｜ AC-2.1→012/013 ｜ AC-2.2→014 ｜ AC-2.3→016/017 ｜ AC-2.4→019 ｜ AC-3.1→021 ｜ AC-3.2→022 ｜ AC-4.1→025/026 ｜ AC-4.2→027 ｜ AC-4.3→028；FR-1→001~003 ｜ FR-2→010 ｜ FR-3→012~015 ｜ FR-4→016~020 ｜ FR-5→021~023 ｜ FR-6→029 ｜ FR-7→028；四套迁移表→004/006/007/008 + 选表 009；T1→012~019 ｜ T2→004/006 ｜ T3→021 ｜ T4→024。

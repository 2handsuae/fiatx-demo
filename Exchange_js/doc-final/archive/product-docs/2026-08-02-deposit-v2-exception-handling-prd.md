# 充值 V2 — 异常处理全流程 PRD

**文档定位**：本篇是《充值》文档集的第二期。V1 交付 happy path（钱到账 → 合规通过 → 入客户账）；**本篇交付的是「不 happy 的那一半」**——合规不通过、客户不配合、金额不够、Sumsub 改口、资金要退回或上缴时，系统各自怎么办。

**状态机归属**：充值单的完整状态机（14 状态 / 15 动作 / 26 跃迁）由**本篇独家维护**。V1 只用到其中的线性子集，完整状态机是本期才建成的。V1 相关章节应改为指针，不重复表述。

---

## 0 变更记录

| 版本 | 日期 | 修订人 | 变更摘要 |
|---|---|---|---|
| v1.0 | 2026-08-02 | Shawn | 首次定稿。驱动源：merge `22936487`（86 commit）。含 Sumsub 单笔提交 + VARA TR 类型判定（模块 5.4）、充值状态机收窄至 14/15/26（模块 5.3）、小额充值口径反转与 `OPERATION_PENDING`（模块 5.2/5.3）、客户端执法态展示收敛（模块 5.5）、仿真裁决按钮（模块 5.7） |

---

## 1 背景与问题陈述

**充值是资金进入体系的唯一客户侧入口，也是合规判定的输入端。** 一笔充值的钱一旦上链到账，就已经在我们的托管地址里——此后我们能决定的只有「给不给客户」，不能决定「收不收」。这个不可逆性，决定了充值的异常处理必须把每一条岔路都走到有资金归宿的终点。

V1 交付的 happy path 是：钱到账 → Gate 0 → 报 Sumsub → 裁决 approved → 入客户账。真实世界里这条路只占一部分。剩下的情况是：Sumsub 判了制裁命中；Sumsub 要求客户补充资料而客户不理；金额小到退回手续费比本金还高；MLRO 判定应当原路退回；执法机关要求上缴；以及——**Sumsub 会改口**：一笔已经 `completed / RED` 的交易，officer 可以随时改回 `awaitingUser`。

本期必须同时解决的矛盾：

• **资金必须有归宿** —— 钱已到账，任何终局都要说得出「这笔钱去哪了」。说不出的终态就是资金悬空。
• **合规裁决优先于业务便利** —— 制裁命中要能落地，不能因为这单金额小、正排在运营队列里就落不下来。
• **裁决会来回翻，状态机必须接得住改口** —— Sumsub 侧 officer 改状态会再发一个 webhook 过来，我方接不住就是单子永久卡死而对方早已改口。
• **对被调查人不得泄露调查状态（tipping-off）** —— 客户端不能让客户看出自己这笔单与众不同。
• **无法验证来源的钱不能收下** —— 我们要求了资料而对方不给，等于来源不明。

**形态共用声明**：crypto 与 fiat 充值共用同一条工作流与同一套状态机，差异仅两处：① TR 类型判定只对 crypto 生效（fiat 恒 `finance`）；② 对手方 VASP 字段只在 crypto 采集，fiat 不得携带。

---

## 2 目标

• **每个终态都能回答「钱去哪了」** —— 5 个终态各有明确资金归宿，无悬空终态。
• **合规裁决 fail-closed 且可落地** —— 判定依据缺失时从严；制裁/冻结裁决在任何非终态都能落地，不因业务状态而被拒。
• **VARA Travel Rule 类型判定可判定、可追溯** —— 三条件 AND，判定理由随审计留痕。
• **客户端对执法态零信息泄露** —— 执法四态与正常处理中在客户端逐字段一致。
• **全流程审计完整** —— 每次状态跃迁、每次裁决落地、每次资金处置均有审计事件。

---

## 3 监管依据

**牌照边界先行**：平台持 VARA **Broker-Dealer（BD）**牌照，**不持** VA Transfer & Settlement 牌照。托管与链上结算职责经 HexTrust 合同传导，本篇不直接引用 T&S Rulebook 条款。

| # | 义务内容 | 来源锚点 |
|---|---|---|
| R-1 | 对虚拟资产转账进行交易监控与风险评分，命中制裁名单须冻结并报告 | ⚠ **待定：逐条条款号待合规锚定**（CRM Rulebook 交易监控章） |
| R-2 | 虚拟资产转账金额达到门槛且对手方为 VASP 时，须交换 Travel Rule 报文 | ⚠ **待定：VARA TR 门槛条款号待合规锚定** |
| R-3 | 不得向被调查主体泄露其正被调查（tipping-off 禁止） | ⚠ **待定：条款号待合规锚定** |
| R-4 | 客户尽职调查资料不足时不得建立/继续业务关系 | CRM Rulebook I.E（客户尽职调查） |
| R-5 | 全部活动留痕并保存 8 年，接受 MLRO 复核 | ⚠ **待定：条款号待合规锚定** |

R-1 / R-2 / R-3 在模块 5.1 的 FR 表中标 **Must（监管）**，不可被砍。

---

## 4 角色与用例

### 4.1 主要角色（人）

| 角色 | 定义 | 目标 | 权限边界 | 频率 |
|---|---|---|---|---|
| 客户 Customer | 在平台开户并充值的自然人 | 把钱充进来并可用 | 只能看自己的充值单；看不到任何执法/处置细节 | 每日 |
| 合规专员 Compliance Officer | 处理人工复核队列的一线合规 | 对 `MANUAL_CHECKING` 的单作出处置 | 可放行、可升级冻结；不可单人解冻 | 每日 |
| MLRO | 反洗钱报告官 | 对冻结/退回/上缴作终局决定 | 冻结单的唯一合法解冻人；退回单签、上缴复签。**不参与小额没收审批** | 每周 |
| 高级管理人员 Senior Management Officer | 上缴（政府移交）的第一签 | 依执法令批准上缴 | 仅 `DEPOSIT_SEIZE` 首签 | 罕见 |
| 运营 Ops | 处置小额充值单 | 对 `OPERATION_PENDING` 的单放行或没收 | 可放行；发起并审批没收（`DEPOSIT_CONFISCATION` = `OPS_OFFICER` 单签）；不可越过合规 | 每周 |

### 4.2 次要角色（外部系统）

| 角色 | 定义 | 与本系统的交互 |
|---|---|---|
| Sumsub（KYT 交易监控） | 交易监控与风险评分服务商 | 接收我方提交的交易 → 跑规则 → 以 webhook 通知 → 我方拉 `getTxn` 取当前状态 |
| HexTrust（托管） | 托管与链上结算服务商 | 提供充值地址、上报到账 |

> **系统本身不是角色。** 充值工作流、SLA 定时器、webhook 处理器均为被设计系统的部件，其自动行为在 5.2/5.3 中以保留词 **「系统（自动）」** 表示。

### 4.3 用例清单

| 编号 | 角色 | 用例 |
|---|---|---|
| UC-1 | 客户 | 充值到账后等待处理直至可用或被退回 |
| UC-2 | 客户 | 按要求补充资料以解除挂起 |
| UC-3 | 合规专员 | 处置人工复核队列中的充值单 |
| UC-4 | MLRO | 解冻一笔被冻结的充值单 |
| UC-5 | MLRO | 批准将一笔充值原路退回 |
| UC-6 | 高级管理人员 + MLRO | 依执法令上缴一笔充值 |
| UC-7 | 运营 | 处置低于下限的小额充值单 |

### 4.4 关键用例展开

**UC-3 合规专员处置人工复核队列**

| 字段 | 内容 |
|---|---|
| 主要角色 | 合规专员 |
| 前置 | 充值单处于 `MANUAL_CHECKING` |
| 触发 | Sumsub 判 rejected 且无处置 tag；或挂起/补料超时 |
| 主成功场景 | 1) 专员打开充值单详情，查看 Sumsub 报文（分数、命中规则、标签）→ 系统展示完整存证；2) 专员判定风险可接受，点击放行 → 系统入客户账并落 `SUCCESS`；3) 系统写 `DEPOSIT_MANUAL_APPROVED` 与 `DEPOSIT_APPROVED` 审计 |
| 异常流 2a | 专员判定应升级冻结 → 系统落 `FROZEN`，此后仅 MLRO 可解冻 |
| 异常流 2b | 金额低于下限 → 系统不入账，转 `OPERATION_PENDING` 交运营处置 |
| 异常流 2c | Sumsub 改口发来 `awaitingUser` → 系统自动转回 `ACTION_PENDING` 等客户补料 |
| 后置-成功保证 | 资金进入客户可用余额，充值单终态 `SUCCESS` |
| **后置-最低保证** | **任何分支下，资金要么仍锁在托管暂记账、要么已按某个终态完成处置；不存在既未入账又无归宿的状态** |

**UC-7 运营处置小额充值单**

| 字段 | 内容 |
|---|---|
| 主要角色 | 运营 |
| 前置 | 充值单处于 `OPERATION_PENDING`（合规已通过，金额低于下限） |
| 触发 | 合规裁决 approved 后金额闸判定金额 < 单笔下限 |
| 主成功场景 | 1) 运营查看单据 → 系统展示金额与下限差额；2) 运营选择放行 → 系统清除挂起标记并入客户账，落 `SUCCESS` |
| 异常流 2a | 运营选择没收（退回成本高于本金）→ 开 `DEPOSIT_CONFISCATION` 审批 → 批准后走 `CONFISCATING` → 结算落 `CONFISCATED` |
| 后置-成功保证 | 资金入客户账或收归公司，二者必居其一 |
| **后置-最低保证** | **未处置前资金锁在托管暂记账；该单对客户全程不可见，不产生「钱到了但查不到」的投诉** |

### 4.5 角色 × 子流程矩阵

| 子流程 | 客户 | 合规专员 | MLRO | 高管 | 运营 |
|---|---|---|---|---|---|
| 补料 | 执行 | — | — | — | — |
| 人工复核处置 | — | 执行 | 知会 | — | — |
| 冻结 | — | 发起 | — | — | — |
| 解冻 | — | — | 审批 | — | — |
| 原路退回 | — | 发起 | 审批 | — | — |
| 上缴 | — | — | 复签 | 首签 | — |
| 小额处置 | — | — | — | — | 发起 + 审批没收 |

**职责分离**：**冻结的发起人与解冻的审批人不得为同一角色；上缴须高管首签 + MLRO 复签，单人不可完成。**

**四类审批的签数（`approval.constants.ts`，全部 48 小时超时）**

| 审批类型 | 签数 | 签字角色 |
|---|---|---|
| 小额没收 `DEPOSIT_CONFISCATION` | 1 | `OPS_OFFICER` |
| 原路退回 `DEPOSIT_RETURN` | 1 | `MLRO` |
| 解冻 `DEPOSIT_UNFREEZE` | 1 | `MLRO` |
| 上缴 `DEPOSIT_SEIZE` | **2** | `SENIOR_MANAGEMENT_OFFICER` → `MLRO` |

---

## 5 功能需求

### 5.0 部件清单

| 实体 | 在本流程扮演什么 | 归属文档 | 本文档只写什么 |
|---|---|---|---|
| 充值单 DepositTransaction | 主线单据，状态机主体 | **本篇** | 全部 |
| 资金单 FundsOrder | 每条动钱腿的执行凭证（payin / 没收 / 退回 / 上缴） | 《资金单》 | 接缝：何时建、何时收口 |
| 账本 Ledger | 记账落点 | 《账本》 | 接缝：各处置腿的借贷方向 |
| 审批单 ApprovalCase | 没收 / 退回 / 上缴 / 解冻的 maker-checker 载体 | 《权限与审计》 | 接缝：何时开、批准后驱动什么 |
| Sumsub 交易 | 合规裁决的外部真相源 | **本篇** | 全部（V1 未覆盖） |

### 5.1 功能清单

| FR | 需求（系统应…） | 级别 |
|---|---|---|
| FR-1 | 对每一笔充值**只向 Sumsub 提交一笔交易**，其 `type` 由 TR 判定器决定，不得为同一笔充值提交两笔 | Must |
| FR-2 | 按「虚拟币 ∧ 对手方为 VASP ∧ 金额 ≥ 币种阈值」三条件 AND 判定 `type=travelRule`，否则 `finance`；阈值 USDT=1000、AED=3500 | **Must（监管 R-2）** |
| FR-3 | 判定理由码（`TR_REQUIRED` / `NOT_CRYPTO` / `COUNTERPARTY_NOT_VASP` / `BELOW_TR_THRESHOLD` / `NO_TR_THRESHOLD_CONFIGURED`）随提交审计留痕 | Must |
| FR-4 | crypto 充值必须采集对手方是否为 VASP；**fiat 充值不得携带该字段** | Must |
| FR-5 | 在**资金入账的唯一出口**处执行金额闸：合规通过后金额 < 下限则转 `OPERATION_PENDING`，不入账 | Must |
| FR-6 | 金额闸判定依据取建单时落的挂起标记，**不在放行时重查限额规则** | Must |
| FR-7 | 制裁命中或 MLRO 冻结指令须落 `FROZEN` 且零记账 | **Must（监管 R-1）** |
| FR-8 | `FROZEN` 的唯一合法解除路径为 MLRO 解冻审批；任何单条 webhook 不得解除冻结 | **Must（监管 R-1）** |
| FR-9 | 挂起超时与补料超时均为 7 日，超时转 `MANUAL_CHECKING`，且两条路径用不同动作以保留成因 | Must |
| FR-10 | 客户端对 `FROZEN` / `SEIZING` / `SEIZED` / `MANUAL_CHECKING` 的展示须与 `COMPLIANCE_PENDING` **逐字段一致** | **Must（监管 R-3）** |
| FR-11 | 低于下限的充值单对客户**全程不可见**（服务端过滤，非前端隐藏）；放行清标后方可见 | Must |
| FR-12 | 每条处置腿结算完成后须将其资金单收口至 `CLEARED` | Must |
| FR-13 | 仿真模式下提供 9 个单步裁决按钮，可自由串联；报文按该单实际 `type` 分型生成 | Should |

### 5.2 端到端流程

**主干**

```
客户充值 → 到账 → PAYIN_PENDING
                      │ 系统（自动）：payin 确认
                      ↓
              COMPLIANCE_PENDING ─── 系统（自动）：报 Sumsub 一笔交易
                      │                         （type 由 5.4-A 判定）
                      ↓ 收到裁决 webhook → 拉 getTxn 取当前状态
              ┌───────┴────────────────────────────────┐
        approved                              非 approved
              │                                        │
        【金额闸 5.4-B】                    按 5.4-C 决策表分流
        ┌─────┴─────┐                    ├─ awaitUser  → ACTION_PENDING
    ≥下限        <下限                    ├─ onHold     → 状态不变 + SLA 计时
        │             │                    ├─ rejected+SANCTION/FROZEN_BY_MLRO → FROZEN
     SUCCESS   OPERATION_PENDING           ├─ rejected+RETURN_TO_SENDER → 开退回审批
                      │                    └─ rejected+其它/无 tag → MANUAL_CHECKING
              ┌───────┴───────┐
           放行            没收
              │               │
          SUCCESS      CONFISCATING → CONFISCATED
```

**处置弧**

```
FROZEN ──MLRO 解冻审批──→ COMPLIANCE_PENDING（回炉重审）
       └─高管首签+MLRO复签→ SEIZING → SEIZED

MANUAL_CHECKING ──MLRO 退回审批──→ RETURNING → RETURNED
```

> ⚠ **本节图管全貌，具体值与副作用以 5.3 跃迁表、5.4 决策表为准。** 图上判定只写名字，改值不改图。

### 5.3 状态机

**5.3.1 状态定义**

| 状态 | 含义 | 资金位置 | 客户可见 | 终态 |
|---|---|---|---|---|
| `PAYIN_PENDING` | 等到账 | 未入托管 | 是 | |
| `COMPLIANCE_PENDING` | 合规审查中 | 托管暂记账 | 是 | |
| `ACTION_PENDING` | 等客户补料 | 托管暂记账 | 是 | |
| `OPERATION_PENDING` | 等运营处置（金额低于下限） | 托管暂记账 | **否** | |
| `MANUAL_CHECKING` | 我方人工复核 | 托管暂记账 | 是 | |
| `FROZEN` | 制裁 / MLRO 冻结 | 托管暂记账 | 是 | |
| `CONFISCATING` | 没收在途 | 记账 pending 锁 | **否** | |
| `RETURNING` | 退回在途 | 记账 pending 锁 | 是 | |
| `SEIZING` | 上缴在途 | 记账 pending 锁 | 是 | |
| `SUCCESS` | 已入客户账 | 客户可用余额 | 是 | ✓ |
| `FAILED` | 到账失败 | 未入托管 | 是 | ✓ |
| `CONFISCATED` | 收归公司 | 公司账 | **否** | ✓ |
| `RETURNED` | 已退回原付款方 | 已出体系 | 是 | ✓ |
| `SEIZED` | 已上缴执法 | 已出体系 | 是 | ✓ |

**5.3.2 跃迁表（26 条）**

信封：每次跃迁均写状态历史条目（含起止状态、成因、操作者、时间）；下表「副作用」仅列此外的额外动作。

| T | 起始 | 动作 | 目标 | 触发条件 | 副作用 |
|---|---|---|---|---|---|
| T-01 | `PAYIN_PENDING` | `payin_confirmed` | `COMPLIANCE_PENDING` | 系统（自动）：payin 资金单 CONFIRMED | 记账 DR 客户资产 / CR 托管暂记；payin 腿收口 CLEARED；报 Sumsub 一笔交易 |
| T-02 | `PAYIN_PENDING` | `fail` | `FAILED` | 系统（自动）：payin 资金单 FAILED | 无记账 |
| T-03 | `COMPLIANCE_PENDING` | `approve` | `SUCCESS` | 系统（自动）：裁决 approved 且金额 ≥ 下限 | 记账 DR 托管暂记 / CR 客户应付 |
| T-04 | `COMPLIANCE_PENDING` | `operation_pending` | `OPERATION_PENDING` | 系统（自动）：裁决 approved 且金额 < 下限 | 审计 `DEPOSIT_HELD_BELOW_MIN`；不记账 |
| T-05 | `COMPLIANCE_PENDING` | `action_pending` | `ACTION_PENDING` | 系统（自动）：裁决 awaitUser | 设补料 SLA 截止（7 日） |
| T-06 | `COMPLIANCE_PENDING` | `sla_breach` | `MANUAL_CHECKING` | 系统（自动）：挂起超过 SLA 截止 | 置 `slaBreached`；审计 `DEPOSIT_SLA_BREACHED` |
| T-07 | `COMPLIANCE_PENDING` | `kyt_rejected` | `MANUAL_CHECKING` | 系统（自动）：裁决 rejected 且无处置 tag | 审计 `DEPOSIT_MANUAL_CHECKING` |
| T-08 | `COMPLIANCE_PENDING` | `freeze` | `FROZEN` | 系统（自动）：裁决 rejected 且 tag ∈ {SANCTION, FROZEN_BY_MLRO} | **零记账**；审计 `DEPOSIT_FROZEN` |
| T-09 | `ACTION_PENDING` | `approve` | `SUCCESS` | 系统（自动）：补料后重评 approved 且金额 ≥ 下限 | 记账同 T-03 |
| T-10 | `ACTION_PENDING` | `operation_pending` | `OPERATION_PENDING` | 系统（自动）：补料后重评 approved 且金额 < 下限 | 同 T-04 |
| T-11 | `ACTION_PENDING` | `sla_breach` | `MANUAL_CHECKING` | 系统（自动）：补料超过 SLA 截止 | 同 T-06 |
| T-12 | `ACTION_PENDING` | `kyt_rejected` | `MANUAL_CHECKING` | 系统（自动）：收到最新 rejected 裁决 | 同 T-07 |
| T-13 | `ACTION_PENDING` | `freeze` | `FROZEN` | 系统（自动）：补料后判制裁 | 同 T-08 |
| T-14 | `ACTION_PENDING` | `resume` | `COMPLIANCE_PENDING` | 系统（自动）：回炉重审 | 无 |
| T-15 | `OPERATION_PENDING` | `approve` | `SUCCESS` | 运营：放行（清除挂起标记） | 清 `limitHoldReason`；记账同 T-03；该单转为客户可见 |
| T-16 | `OPERATION_PENDING` | `confiscate_start` | `CONFISCATING` | 系统（自动）：没收审批通过 | 记账 pending 锁两腿；建没收资金单 |
| T-17 | `MANUAL_CHECKING` | `approve` | `SUCCESS` | 合规专员：翻案放行 | 审计 `DEPOSIT_MANUAL_APPROVED`；记账同 T-03 |
| T-18 | `MANUAL_CHECKING` | `operation_pending` | `OPERATION_PENDING` | 系统（自动）：翻案放行但金额 < 下限 | 同 T-04 |
| T-19 | `MANUAL_CHECKING` | `action_pending` | `ACTION_PENDING` | 系统（自动）：Sumsub officer 改回 awaitingUser | 设补料 SLA 截止 |
| T-20 | `MANUAL_CHECKING` | `freeze` | `FROZEN` | 合规专员：升级冻结 | 同 T-08 |
| T-21 | `MANUAL_CHECKING` | `return` | `RETURNING` | 系统（自动）：退回审批通过 | 记账 pending 锁；建退回资金单（目的地=原付款方） |
| T-22 | `FROZEN` | `resume` | `COMPLIANCE_PENDING` | 系统（自动）：MLRO 解冻审批通过 | **零记账**；审计 `DEPOSIT_UNFROZEN` |
| T-23 | `FROZEN` | `seize` | `SEIZING` | 系统（自动）：上缴审批（高管首签+MLRO 复签）通过 | 记账 pending 锁；建上缴资金单 |
| T-24 | `CONFISCATING` | `confiscate_settle` | `CONFISCATED` | 系统（自动）：没收资金单 CONFIRMED | post 两腿；收口该腿至 CLEARED |
| T-25 | `RETURNING` | `returned_done` | `RETURNED` | 系统（自动）：退回资金单 CONFIRMED | post 单腿；收口该腿至 CLEARED |
| T-26 | `SEIZING` | `seized_done` | `SEIZED` | 系统（自动）：上缴资金单 CONFIRMED | post 单腿；收口该腿至 CLEARED |

**5.3.3 约束**

• **每个终态都有资金归宿**：`SUCCESS`=入客户账｜`FAILED`=钱未到｜`CONFISCATED`=收归公司｜`RETURNED`=退回原路｜`SEIZED`=上缴执法。**新增终态必须先回答「钱去哪了」。**
• **`FAILED` 仅从 `PAYIN_PENDING` 可达** —— payin 结束即钱已到，此后不再有失败终态（暂不建模链上重组）。
• **`FROZEN` 无 `approve` 出边** —— 冻结不可被单操作者放行；唯二出口为 MLRO 解冻与依令上缴。
• **锁定与解锁严格配对** —— 任何 pending 锁必有对应 post 或 void。
• **处置腿资金单必与充值单终态同步收口** —— 结算完成即 `CLEARED`。

### 5.4 判定决策表

**5.4-A　Sumsub 交易类型判定（VARA Travel Rule）**

| # | 资产类型 | 对手方为 VASP | 金额 vs 币种阈值 | 阈值已配置 | → type | 理由码 |
|---|---|---|---|---|---|---|
| A1 | 非 crypto | — | — | — | `finance` | `NOT_CRYPTO` |
| A2 | crypto | 否 / 未提供 | — | — | `finance` | `COUNTERPARTY_NOT_VASP` |
| A3 | crypto | 是 | — | **否** | `finance` | `NO_TR_THRESHOLD_CONFIGURED`（**fail-safe：漏配币种不卡单，但落 warn 日志可被发现**） |
| A4 | crypto | 是 | < 阈值 | 是 | `finance` | `BELOW_TR_THRESHOLD` |
| A5 | crypto | 是 | **≥ 阈值** | 是 | `travelRule` | `TR_REQUIRED` |

阈值：USDT = 1000｜AED = 3500。**边界为「大于等于阈值即需 TR」。**

**5.4-B　金额闸（合规通过后）**

| # | 建单时挂起标记 | → 去向 | 记账 |
|---|---|---|---|
| B1 | 无 | `SUCCESS` | DR 托管暂记 / CR 客户应付 |
| B2 | `BELOW_MIN` | `OPERATION_PENDING` | 不记账，审计 `DEPOSIT_HELD_BELOW_MIN` |

**判定依据取建单时的标记，不在放行时重查限额规则**——规则可能在单子生命周期内被改，用出生时的标记更稳定、可追溯。单笔下限当前种子值为 100。

**5.4-C　Sumsub 当前状态 → 我方去向**

| # | `review.reviewStatus` | `reviewAnswer` | 处置 tag | → 我方 |
|---|---|---|---|---|
| C1 | `completed` | `GREEN` | — | 走 5.4-B 金额闸 |
| C2 | `completed` | `RED` | `SANCTION` 或 `FROZEN_BY_MLRO` | `FROZEN` |
| C3 | `completed` | `RED` | `RETURN_TO_SENDER` | 开退回审批，留 `MANUAL_CHECKING` |
| C4 | `completed` | `RED` | 其它 tag 或无 tag | `MANUAL_CHECKING` |
| C5 | `awaitingUser` | 空 | — | `ACTION_PENDING` |
| C6 | `onHold` | 空 | — | 状态不变 + 设 7 日 SLA |
| C7 | `init` | 空 | — | 状态不变 |

> **`reviewResult` 只在 `reviewStatus=completed` 时存在**——裁决只在审核完成时产生。`scoringResult.action` 是首次跑规则的快照，**不反映当前状态**，不得用作路由依据。

### 5.5 客户端展示映射

| 我方状态 | 客户看到 | 副文案 | 色调 |
|---|---|---|---|
| `PAYIN_PENDING` / `COMPLIANCE_PENDING` | PROCESSING | 无 | 中性 |
| `ACTION_PENDING` | ACTION REQUIRED | Please provide additional information | 警示 |
| **`FROZEN` / `SEIZING` / `SEIZED` / `MANUAL_CHECKING`** | **PROCESSING** | **无** | **中性** |
| `RETURNING` | RETURNING | Funds are being returned to the original sender | 警示 |
| `RETURNED` | RETURNED | Funds were returned to the original sender | 中性 |
| `SUCCESS` | SUCCESS | 无 | 正向 |
| `FAILED` | FAILED | 无 | 危险 |
| `OPERATION_PENDING` / `CONFISCATING` / `CONFISCATED` | —（服务端过滤，客户拿不到数据） | — | — |

**执法四态与 `COMPLIANCE_PENDING` 逐字段一致（label + 无副文案 + 中性色）。** 只统一 label 不够——警示色或「联系客服」提示本身就是可辨识信号。代价是客户拿不到求助路径，这是有意接受的取舍：对制裁/执法在办的单，引导客户来问本身就是不该做的动作。

### 5.6 审计事件

信封字段（实体类型/实体号/操作者/traceId/工作流类型/时间）每条均记，下表不逐行重复。

| Action 常量 | 触发时机 | 记录内容 |
|---|---|---|
| `DEPOSIT_CREATED` | 检测到入账信号建单 | 金额、资产、来源地址 |
| `DEPOSIT_PAYIN_CONFIRMED` | payin 资金单确认 | 资金单号 |
| `DEPOSIT_COMPLIANCE_STARTED` | 进入合规审查 | — |
| `DEPOSIT_GATE0_PASSED` | 客户合规状态门通过 | 客户状态 |
| `DEPOSIT_SUMSUB_SUBMITTED` | 提交 Sumsub 交易 | Sumsub 交易号、**type、判定理由码** |
| `DEPOSIT_HELD_BELOW_MIN` | 合规通过但金额低于下限 | 金额、下限 |
| `DEPOSIT_ONHOLD` | 裁决 onHold | SLA 截止时间 |
| `DEPOSIT_SLA_BREACHED` | 挂起/补料超时 | 原状态、SLA 截止时间 |
| `DEPOSIT_FROZEN` | 制裁/MLRO 冻结落地 | 冻结成因（SANCTION / FROZEN_BY_MLRO） |
| `DEPOSIT_APPROVE_BLOCKED_FROZEN` | 冻结期间收到 approved 裁决 | 被忽略的裁决 |
| `DEPOSIT_MANUAL_APPROVED` | 人工复核翻案放行 | — |
| `DEPOSIT_APPROVED` / `DEPOSIT_COMPLETED` | 入账完成 | 入账金额 |
| `DEPOSIT_LIMIT_WAIVED` | 小额放行 | 操作者 |
| `DEPOSIT_CONFISCATION_REQUESTED` / `_STARTED` / `_EXECUTED` / `_FAILED` | 没收各阶段 | 审批单号、资金单号 |
| `DEPOSIT_RETURN_APPROVAL_REQUESTED` / `_STARTED` / `DEPOSIT_RETURNED` / `_RETRIED` / `_STUCK` | 退回各阶段 | 同上 |
| `DEPOSIT_SEIZE_APPROVAL_REQUESTED` / `_STARTED` / `DEPOSIT_SEIZED` / `_RETRIED` / `_STUCK` | 上缴各阶段 | 同上 + 执法令文书号 |
| `DEPOSIT_UNFREEZE_APPROVAL_REQUESTED` / `DEPOSIT_UNFROZEN` | 解冻 | 审批单号 |
| `DEPOSIT_LEG_CLEAR_FAILED` | 处置腿结算完成但资金单未能收口 | 资金单号、错误 |

### 5.7 仿真裁决按钮（演示专用）

仅在 `SUMSUB_MOCK_MODE=true` 时注册。**语义：一个按钮 = 投递一次 Sumsub webhook + 一份配套报文**，状态去向完全交给正式处理链路决定，operator 可自由串联（如 ② → ① 表示补料后通过；⑦ → ⑤ 表示复核后 MLRO 冻结）。

| 按钮 | `scoringResult.action` | 分数 | 处置 tag | 补料任务 | 预期去向 |
|---|---|---|---|---|---|
| ① Approved | `score` | 5 | — | — | 走金额闸 |
| ② Awaiting user | `awaitUser` | 40 | — | 有 | `ACTION_PENDING` |
| ③ Awaiting user · PEP | `awaitUser` | 62 | `PEP` | 有 | `ACTION_PENDING` |
| ④ Rejected · Sanctions | `reject` | 98 | `SANCTION` | — | `FROZEN` |
| ⑤ Rejected · MLRO freeze | `reject` | 84 | `FROZEN_BY_MLRO` | — | `FROZEN` |
| ⑥ Rejected · MLRO return | `reject` | 79 | `RETURN_TO_SENDER` | — | 开退回审批，留 `MANUAL_CHECKING` |
| ⑦ Rejected · no tag | `reject` | 71 | — | — | `MANUAL_CHECKING` |
| ⑧ On hold | `onHold` | 55 | — | — | 状态不变 + SLA 计时 |
| ⑨ Rejected · SLA breach | `reject` | 55 | `SLA_BREACH` | — | `MANUAL_CHECKING` |

报文按 Sumsub 官方 `getTxn` schema 生成，并依该单实际 `type` 分型：`data.type` 取 `finance`/`travelRule`；`travelRuleInfo` 仅在 `travelRule` 出现；`cryptoTxnInfo` 仅在虚拟币出现。

---

## 6 范围与非目标

**范围**：单笔客户充值单从「检测到入账」到「五个终态之一」的全部异常路径，含合规判定、金额闸、四条处置弧、客户端展示。crypto 与 fiat 同管。

1）**Travel Rule 报文的实际交换** —— 本期只做 Sumsub 交易 `type` 的判定与提交，报文收发是独立协议流程，不在本篇。
2）**对手方 VASP 归属识别服务** —— 演示系统由客户端弹窗录入；真实场景需接入 VASP 目录服务，属另一议题。
3）**TR 阈值的可配置化** —— 当前按币种硬编码（VARA 要求，非业务参数）。改为可配置需先解决「谁有权改监管阈值」的治理问题。
4）**资金单自身的状态机与记账明细** —— 详见《资金单》《账本》，本篇只写接缝。
5）**审批流的角色/权限模型** —— 详见《权限与审计》，本篇只写「谁签几道」。
6）**提现与兑换的合规判定** —— 相邻流程，各有自己的判定链路。
7）**链上重组导致的事后到账失败** —— 明确不建模；payin 结束即视为钱已到（见 5.3.3 约束）。

> **非目标 ≠ 缺口。** 本期已知但未做完的缺口一律进模块 8，不写入本节。

---

## 7 验收标准

**A 组　TR 类型判定（对应 FR-2/FR-3、5.4-A 全 5 行）**

□ AC-1　fiat 充值 3500 AED、对手方任意 → 提交 `type=finance`，审计理由码 `NOT_CRYPTO`
□ AC-2　crypto 3000 USDT、对手方非 VASP → `finance`，理由码 `COUNTERPARTY_NOT_VASP`
□ AC-3　crypto 3000 USDT、对手方 VASP → `travelRule`，理由码 `TR_REQUIRED`
□ AC-4　**边界：crypto 恰好 1000 USDT、对手方 VASP → `travelRule`**（大于等于即需 TR）
□ AC-5　**边界：crypto 999.99 USDT、对手方 VASP → `finance`**，理由码 `BELOW_TR_THRESHOLD`
□ AC-6　**fail-safe：crypto、对手方 VASP、币种未配阈值 → `finance`**，理由码 `NO_TR_THRESHOLD_CONFIGURED` 且日志有 warn
□ AC-7　fiat 充值请求携带对手方 VASP 字段 → 服务端拒绝建单（对应 FR-4）
□ AC-8　crypto 充值请求缺对手方 VASP 字段 → 服务端拒绝建单（对应 FR-4）

**B 组　金额闸（对应 FR-5/FR-6、5.4-B 两行、T-03/T-04/T-09/T-10/T-15/T-18）**

□ AC-9　合规通过、金额 150（下限 100）→ `SUCCESS`，客户余额 +150
□ AC-10　**边界：合规通过、金额恰好 100 → `SUCCESS`**（等于下限放行）
□ AC-11　**边界：合规通过、金额 99 → `OPERATION_PENDING`**，客户余额不变，审计 `DEPOSIT_HELD_BELOW_MIN`
□ AC-12　金额 99 的单从 `ACTION_PENDING` 出发被 approved → 落 `OPERATION_PENDING`（不报错）
□ AC-13　金额 99 的单从 `MANUAL_CHECKING` 出发被翻案放行 → 落 `OPERATION_PENDING`（不报错）
□ AC-14　`OPERATION_PENDING` 单被运营放行 → `SUCCESS`，挂起标记清空，该单转为客户可见
□ AC-15　对已在 `OPERATION_PENDING` 的单重复放行 → 干净 no-op，不报 500

**C 组　裁决分流（对应 5.4-C 全 7 行、T-05/T-07/T-08/T-12/T-19）**

□ AC-16　`completed`+`GREEN` → 走金额闸
□ AC-17　`completed`+`RED`+`SANCTION` → `FROZEN`，**账本零变动**
□ AC-18　`completed`+`RED`+`FROZEN_BY_MLRO` → `FROZEN`，账本零变动
□ AC-19　`completed`+`RED`+`RETURN_TO_SENDER` → 开 `DEPOSIT_RETURN` 审批，状态留 `MANUAL_CHECKING`
□ AC-20　`completed`+`RED`+无 tag → `MANUAL_CHECKING`
□ AC-21　`awaitingUser` → `ACTION_PENDING`，且详情页可见补料任务号
□ AC-22　`onHold` → **状态不变**，但分数与报文已落库可见
□ AC-23　`init` → 状态不变，不产生任何跃迁

**D 组　冻结不可绕过（对应 FR-7/FR-8、T-08/T-13/T-20/T-22/T-23）**

□ AC-24　`FROZEN` 单收到迟到的 approved 裁决 → 状态不变，审计 `DEPOSIT_APPROVE_BLOCKED_FROZEN`
□ AC-25　`FROZEN` 单由单一操作者尝试放行 → 被拒
□ AC-26　`FROZEN` 单经 MLRO 解冻审批 → `COMPLIANCE_PENDING`，**零记账**
□ AC-27　`FROZEN` 单经高管首签 + MLRO 复签 → `SEIZING`，仅一签时不得推进

**E 组　超时与改口（对应 FR-9、T-06/T-11/T-19）**

□ AC-28　`COMPLIANCE_PENDING` 挂起超 7 日 → `MANUAL_CHECKING`，审计 `DEPOSIT_SLA_BREACHED`
□ AC-29　`ACTION_PENDING` 补料超 7 日 → `MANUAL_CHECKING`，审计同上，且状态历史成因可区分于裁决 rejected
□ AC-30　`MANUAL_CHECKING` 单收到 Sumsub 改口的 `awaitingUser` → 转 `ACTION_PENDING`（不报错）

**F 组　客户端信息隔离（对应 FR-10/FR-11、5.5）**

□ AC-31　`FROZEN` 单在客户端渲染为 PROCESSING、无副文案、中性色，与 `COMPLIANCE_PENDING` 像素级一致
□ AC-32　`SEIZED` 单同上
□ AC-33　`MANUAL_CHECKING` 单同上
□ AC-34　客户端任何位置不出现 UNDER REVIEW / FROZEN / SEIZED / 制裁等字样
□ AC-35　`OPERATION_PENDING` 单在客户充值列表接口响应中**不存在**（服务端过滤，非前端隐藏）
□ AC-36　`CONFISCATED` 单同上

**G 组　资金归宿完整性（对应 FR-12、T-16/T-21/T-23/T-24/T-25/T-26）**

□ AC-37　没收结算完成 → `CONFISCATED`，没收腿资金单 `CLEARED`，账本恒等式通过
□ AC-38　退回结算完成 → `RETURNED`，退回腿资金单 `CLEARED`，账本恒等式通过
□ AC-39　上缴结算完成 → `SEIZED`，上缴腿资金单 `CLEARED`，账本恒等式通过
□ AC-40　**失败路径：结算 post 连续失败 3 次 → 状态停在在途态，落 `_STUCK` 审计，不产生半截记账**
□ AC-41　**失败路径：处置腿结算成功但资金单收口失败 → 记账与充值单终态不受影响，落 `DEPOSIT_LEG_CLEAR_FAILED`**
□ AC-42　任一终态下，该充值单名下全部资金单均为 `CLEARED`

**H 组　审计时序（对应 5.6）**

□ AC-43　一笔走完 payin → 合规 → 入账的单，审计事件按 `DEPOSIT_CREATED` → `PAYIN_CONFIRMED` → `COMPLIANCE_STARTED` → `GATE0_PASSED` → `SUMSUB_SUBMITTED` → `APPROVED` → `COMPLETED` 顺序出现且无缺项
□ AC-44　`DEPOSIT_SUMSUB_SUBMITTED` 的记录内容含 `type` 与判定理由码

**覆盖对账**

• **FR 覆盖**：FR-1 由 AC-1~AC-6 隐含（每笔仅一次提交）｜FR-2/3 → A 组｜FR-4 → AC-7/8｜FR-5/6 → B 组｜FR-7/8 → D 组｜FR-9 → E 组｜FR-10/11 → F 组｜FR-12 → AC-37~42｜**FR-13（仿真按钮）不设独立验收**——演示工具非交付物，其正确性由 A~G 组间接覆盖。
• **跃迁覆盖**：T-01/T-02 属 V1 happy path 范围，本篇不重复验收；T-03~T-26 共 24 条，逐条被 B/C/D/E/G 组覆盖。
• **决策表覆盖**：5.4-A 五行 → AC-1/2/3/4/6（A4 由 AC-5 覆盖）｜5.4-B 两行 → AC-9/AC-11｜5.4-C 七行 → AC-16~AC-23。
• **未验收项**：模块 8 的 G-1~G-4 为已知缺口，按「未实现的不写验收」原则不设 AC。

---

## 8 待决问题

### 8.1 待决策 Q（等人拍板）

| 编号 | 问题 | 类型 | 影响 | 等谁 |
|---|---|---|---|---|
| Q-1 | 补料超时（7 日）后资金的最终归宿。应然分析结论为**原路退回**（我方要求资料而对方不给＝来源无法确认，不应收下），但退回有链上/银行成本，小额单可能成本高于本金 | 业务口径 | 决定 `MANUAL_CHECKING` 后是否需要新增 officer 发起退回的入口，以及小额单是否改走没收 | 业主 + 合规 |
| Q-2 | 补料时限 7 日是否足够。跨境客户凑齐资金来源证明通常需更久，多数机构给 14–30 日并发两次提醒 | 业务口径 | 影响 SLA 常量与提醒机制 | 业主 + 合规 |
| Q-3 | 退回失败（原地址失效/账户注销）的资金归宿。长期挂账等认领，还是达到时限后收归？ | 监管口径 | 无人认领资产的处理在监管上有明确要求 | 合规 |
| Q-4 | 我方租户的 Sumsub reject 规则是否会产出 `reviewRejectType=RETRY`。沙盒两笔样本均为 `FINAL` | 技术确认 | 若恒 `FINAL`，则任何基于 RETRY 的分支设计均为空转 | 合规 + Sumsub |
| Q-5 | 客户端 KYC 材料审核页的 "Under Review" 是否也需收敛为 PROCESSING。该场景为客户主动提交后等审，不涉及 tipping-off | 产品口径 | 影响《客户身份认证》文档，非本篇 | 业主 |

### 8.2 已知缺口 G（等实现）

**缺口唯一真相源为 `doc-final/BACKLOG.md`，本节为本篇相关子集快照。**

| 编号 | 缺口 | 影响 |
|---|---|---|
| G-1 | `OPERATION_PENDING` 收到迟到的制裁/补料裁决会抛错 → webhook 重试耗尽进死信，**静默无人知** | 按当前口径不给这些出边是有意的，但应改为**显式 no-op + 落审计**而非抛错 |
| G-2 | `FROZEN` 收到任何 Sumsub 裁决均抛错，同 G-1 | 冻结单若被 Sumsub 改口，我方不会知道 |
| G-3 | payin 事后掉链（`COMPLIANCE_PENDING` 之后 payin 报失败）当前仅 warn，未落审计 | 运营无法从审计发现该异常 |
| G-4 | 合规专员无法发起原路退回——`return` 跃迁仅由 Sumsub 打 `RETURN_TO_SENDER` tag 触发，**无 officer 入口** | 直接导致 Q-1 的应然操作在系统上不可执行 |
| G-5 | `scripts/e2e-confiscation-async.ts` 已随本期改造修正但未在隔离环境实跑验证 | 没收 money-path 活体验收暂缺 |

---

## 9 附录 A　数据模型（业务级）

**充值单本期新增/变更字段**

| 字段 | 含义 | 取值 | 谁写 |
|---|---|---|---|
| `sumsubTxnId` | 该充值对应的唯一 Sumsub 交易号 | 24 位十六进制 | 系统提交时 |
| `sumsubTxnType` | 该交易的 Sumsub 类型 | `finance` / `travelRule` | 系统提交时（由 5.4-A 判定） |
| `sumsubVerdict` | 最近一次裁决 | `approved` / `rejected` / `awaitUser` / `onHold` | webhook 处理时 |
| `sumsubScore` | 最近一次风险分 | 整数 | 拉 `getTxn` 时 |
| `sumsubTxnDetailJson` | 最近一次 `getTxn` 报文存证 | 官方 schema 原文 | 拉 `getTxn` 时 |
| `counterpartyIsVasp` | 对手方是否为 VASP | `true`/`false`；**fiat 恒为空** | 建单时由入账信号携带 |
| `limitHoldReason` | 低于下限的挂起标记 | `BELOW_MIN` / 空 | 建单时落标；放行时清除 |
| `slaDeadline` / `slaBreached` | SLA 截止与是否已超时 | 时间戳 / 布尔 | 进挂起态时设；超时扫描时置 |

**关系**：一笔充值单 ↔ 一笔 Sumsub 交易（1:1）；一笔充值单 ↔ N 条资金单（payin 必有，处置腿按弧新增）。

---

<div align="center">— 文档结束 —</div>

# Transaction Limit（金额闸门）— 设计 spec

日期：2026-07-16 ｜ 状态：设计定稿（业主逐节确认）｜ 落点：资产域

## 0. 一句话定位

一张统一限额规则表 + 一台 L1 判定引擎：A（单笔上下限）/ B（等级累计限额）/ D1（提现大额审批）/ D2（TR 阈值标记）。本轮交付**配置台 + 提现/兑换接入**；充值接入另起任务。

## 1. 脑暴定界（为什么是 A/B/D1/D2）

金额相关的动作分两种，判别线：**动作由「金额过死线」决定 → 金额闸门；由「风险评分」决定 → 风险引擎**（金额只是喂给风险的信号）。

- ✅ **A 单笔 min/max**：死线直比，硬拒。原散落 Asset 4 字段（min/maxDeposit/WithdrawAmount），收编统一；swap 原本无 min/max，统一后补上。
- ✅ **B 周期累计限额**：死线（tier 配值）+ 有状态（累加客户窗口用量），硬拒。两层结构 = 政策层（tier×方向×周期 → **默认值 + cap 双数字**）+ 客户微调层（本轮不做，cap 字段占位）。
- ✅ **D1 大额审批门**：死线，软门（≥ 阈值 → SMO 审批）。**业主拍板：仅提现，兑换不做**。现役 20 万 AED 常量收编进配置（数字是平台定的，属业务决策）。
- ✅ **D2 TR 阈值**：死线，软门（≥ 3,500 AED → 打 TR 标）。本轮仅提现 crypto；充值侧随充值任务。**业主拍板：不进配置表，写死代码常量**——治理原则：*谁定的数字走谁的变更通道*，3,500 是 VARA 法定明线，改它=rulebook 修订=合规事件+发版，不该给运营留可调入口（防误调静音 TR）。roadmap V3 ADVANCED「阈值参数配置治理（TR 阈值出硬编码）」是将来多辖区时的账，本轮明确不做。
- ❌ **D3 SOF/EDD**：因果链是 大额→风险↑→SOF，评分驱动 → 归风险引擎（业主纠偏）。
- ❌ **D4 拆单聚合**：行为模式识别 → 归交易监控/AML（业主纠偏）。
- ⏸️ **C 持仓上限 / E 平台熔断**：demo 非必需，不做。

## 2. 数据模型

**新表 `transaction_limit_rules`**（模块 `src/modules/asset-treasury/transaction-limits/`），三种行形状锁死（每 gateType 固定哪些维度必填/必空，**无通配优先级问题**）：

| gateType | 必填维度 | 金额字段 | 单位 |
|---|---|---|---|
| `SINGLE`（A） | operation × assetId | `minAmount` / `maxAmount`（可只填一边） | 原生币种 |
| `CUMULATIVE`（B） | operation × tradingTier × period(DAILY/MONTHLY) | `defaultLimit` + `cap` | AED |
| `LARGE_APPROVAL`（D1） | operation（本轮仅 WITHDRAWAL） | `threshold` | AED |

**D2 不进表**：`TRAVEL_RULE_AED_THRESHOLD = 3500` 代码常量（样式照抄 `WITHDRAW_APPROVAL_AED_THRESHOLD`，配套单测锁值——改数字必先改测试，天然双人复核）。

公共字段：`ruleNo`（业务键）、`status`、审批挂钩字段、时间戳。唯一约束 =（gateType, operation, assetId?, tradingTier?, period?）。

**订单侧新列**：withdraw/swap 订单加 `aedValueSnapshot`（创建时按当时汇率定格），B 用量 = SUM 该列，免历史重算。

**吸收退役**：
- 旧 `governance/transaction-limits` 模块 + `TransactionLimitPolicy`/`TransactionLimitChangeRequest` 两表退役（零消费方；了结 BACKLOG「限额执行接入 vs 明示退役」待决策）。创建/变更审批工作流**模式**照抄进新模块。
- Asset 4 个 min/max 字段：值迁入种子 A 行；资产表单移除 4 输入框；schema 列暂留（记 BACKLOG 待 drop）。
- 现常量 `WITHDRAW_APPROVAL_AED_THRESHOLD`（200,000）退役，值进种子 D1 行。

## 3. 判定引擎

`TransactionLimitGateService.evaluate({ operation, customerId, assetId, amount })`，L1 一次调用全闸出结果：

```
① A: 本笔 vs 该资产 SINGLE 行（原生币种直比）→ 不过即 REJECT
② 折 AED（复用现有汇率服务；取不到 → fail-closed，同现 D1 语义）
③ B: 客户 tradingTier → CUMULATIVE 行；用量 =（迪拜日历日/月内该客户该方向
   [非终态+成功] 订单 aedValueSnapshot 之和）+ 本笔 ≤ defaultLimit → 不过即 REJECT
④ D1: 本笔 AED ≥ D1 行 threshold → requiresLargeApproval = true（仅提现）
⑤ D2: crypto 且本笔 AED ≥ TRAVEL_RULE_AED_THRESHOLD 常量 → travelRuleRequired = true（仅提现）
返回: { pass | rejectCode+限额上下文, requiresLargeApproval, travelRuleRequired, aedValue }
```

要点：
- **B 计在途**：用量含非终态订单，防并发绕限（业主流程确认第 2 点修正）。
- **窗口**：迪拜时区日历日/日历月，不做滚动窗。
- **A/B 拒绝时序**：在订单 persist 前、quote 消费前抛业务异常 → 订单不生、quote 原封不动。
- **拒绝留痕**：审计事件 `TRANSACTION_LIMIT_REJECTED`（客户/方向/金额/命中规则）。

## 4. 接入点（本轮两处）

- **提现** `withdraw-workflow.service.ts → createWithdrawal()`：现有 `ensureCustomerCanTransact` 之后、`$transaction` 之前调 evaluate；A/B 拒绝抛出；D1 结果取代死常量判定；D2 结果落单（travelRuleRequired）。
- **兑换** `swap-workflow.service.ts → executeSwap()`：同位置调 evaluate，仅消费 A/B（无 D1/D2）。
- 已核实：两链路 L1 均在订单落库之前（withdraw pre-$transaction / swap pre-$transaction），插入点现成。

**大流程合同**（业主确认）：① 配置多条目 → ② B 经客户已有 `tradingTier` 关联（客户侧零改动；用量现算不落客户资料）→ ③ L1 统一判定：A/B 不创建订单直接拦，D 类创建订单走审批/打标（"L1 判定，D 类延迟发力"）。

## 5. 配置台（admin）

- 新页 **Transaction Limits**，挂 **Assets 菜单组**——复活 `DashboardLayout.tsx` 中被注释的原入口（`/admin/assets/transaction-limits`，roadmap「入口已隐藏 84cfffb」原位）。
- 三 tab = 三 gateType（SINGLE/CUMULATIVE/LARGE_APPROVAL），各一张小表；创建/变更走 **OPS_OFFICER 单步审批**（与费率等级同款）。D2 无配置面（法定常量）。
- 新权限 `TRANSACTION_LIMIT_READ/WRITE` 登记 `rbac.catalog.ts`；⚠️ 需 `db:base:sync` + **重启后端**方生效。

## 6. 种子数据（业主定：走业务数据初始化命令）

种子写进 `prisma/seed.business.ts`（原 `seedTransactionLimitPolicies` 段原位替换为新表种子），即 `db:biz:init` / `main:reset:biz` 链路注入：
- A：每资产 × WITHDRAWAL/SWAP min/max（值迁自现 Asset 字段，swap 补默认）
- B：BASIC/PREMIUM × WITHDRAWAL/SWAP × DAILY/MONTHLY 共 8 行（BASIC 日提现 5 万 / PREMIUM 50 万量级）
- D1：WITHDRAWAL 200,000 AED（D2 是代码常量，不入种子）

## 7. 验证

- 单测：引擎四闸边界（等于线/差一分/汇率失败 fail-closed/窗口跨日/在途计入）
- 回归：`tsc` 0 新增、`demo:all 8/8`、`verify:coa` PASS、jest 净新 0
- demo 剧本：小额提现被 A 拦 → 连续提现撞 B 日限 → 20 万触发 SMO 审批 → crypto 提现 ≥3,500 带 TR 标 → admin 改限额走审批生效

## 8. 本轮明确不做（占位已留）

- **充值接入**（另起任务）：BELOW_MIN/超上限 **挂起处置**（业主拍板甲案）——复用 `DEPOSIT_HELD_NOT_TRADING_READY` 挂起模式（停 COMPLIANCE_PENDING + holdReason，不加第 9 状态）；admin 处置 [放行]=摘标重跑 checkAutoApproval / [退回]=**真回退**（Step1 反向分录 SUSPENSE→CLIENT_ASSET，顺手落 roadmap V4 ⚖️P0「已记账异常终态 TB 回退」第一块）
- 客户微调层（银行式自助限额；cap 字段已占位，将来 `customer_limits` 表 + 调低即时/调高审批）
- C 持仓上限 / E 平台熔断 ｜ D3/D4（归风险引擎/AML）｜ TR hosted/unhosted 条件②（依赖 V3 地址打标）｜ 兑换大额审批（业主明确不做）

## 9. 文档同步义务（实施时）

truth：v5-withdraw / v6-swap 加金额闸门节、v3-financial-config 金额闸门条目更新；BACKLOG：勾掉「限额执行接入 vs 退役」待决策、新记 Asset 4 列待 drop；roadmap：V3「金额闸门体系 [~]」改状态。

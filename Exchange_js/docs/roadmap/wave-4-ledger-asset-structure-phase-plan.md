Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-23
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/roadmap/project-version-plan.md`, `docs/constraints/backend-architecture-constraints.md`, `docs/constraints/customer-transaction-flow-constraints.md`, `docs/constraints/internal-transaction-flow-constraints.md`
Source of Truth Level: roadmap

# Wave 4 账务内核与资产结构分阶段规划（Ledger + Asset Structure）

## 1. 文档目的

本文件用于把总版本规划中的 `Wave 4` 进一步拆成多个可执行 `phase`，作为后续开发、产品、测试、agent 协作时的统一参考。

适用原则：

- 本文是 `Wave 4` 的专项规划文档，不替代 `AGENTS.md` 与 `docs/constraints/**`。
- `Wave 4` 当前已经完成 `Phase 0-5` 的 implemented-scope closeout，并已进入 post-closeout remediation 收口。
- 本文定义的是 `Wave 4` 的阶段范围、顺序、交付边界、已实现切片、cleanup 结果与剩余验收路径。
- `Wave 4` 的长期语义必须继续下沉到：
  - `docs/adr/**`
  - `docs/constraints/**`
  - `docs/specs/**`
  - `docs/acceptance/**`
- 当单个需求只完成部分能力时，以 `phase` 的 `DoD` 判断是否可交付，而不是以“账务/钱包/报价”名字是否出现来判断。

### 当前状态说明

- `Wave 1-3` 已完成治理底座、合规中台与 customer onboarding / periodic review 主线。
- 当前代码已经存在 `assets / wallets / acct-events / journal templates / clearing templates / journals / pricing policies / quotes / internal transactions` 等实现锚点。
- 当前 `Wave 4` 已完成：
  - `Phase 0`：文档与 ADR 基线
  - `Phase 1`：wallet / account model 与基础资金池语义收口
  - `Phase 2`：业务基础配置治理 runtime、只读查询与发布脚本基线
  - `Phase 3`：`Withdraw` 统一事件执行切片
  - `Phase 4`：`swap + withdraw` 统一 quote runtime
  - `Phase 5`：implemented-scope migration / smoke / acceptance closeout
  - cleanup round `1-3`：compatibility shell 删除与 wallet shadow balance schema retirement
  - post-closeout remediation：governance audit logging 与核心 runtime type hardening
- 当前 `Wave 4` 的主要缺口已经转移到：
  - `PricingCenterService` 更广范围类型治理
  - 前端 pricing config edit shell 收口
  - 尚未纳入 closeout 阻塞项的 downstream 扩展验收

---

## 2. Wave 4 总目标

`Wave 4` 的目标不是直接做完 `deposit / swap / withdraw` 业务闭环，而是先把这些后续业务都会复用的资金底座做成平台标准件：

- 资产主数据与钱包/账户结构定型
- 账务配置中心和发布治理模型定型
- `AcctEvent -> clearing + journal` 驱动链定型
- 钱包余额投影、回放与失败阻断规则定型
- `PricingPolicy -> quote snapshot -> transaction` 的定价主线定型
- fee skeleton 成为后续 `Wave 5/6/7` 可复用合同

本波的成功标志不是“页面更多了”，而是：

- 后续业务波次不再临时发明 wallet/accounting/pricing 语义
- 清分与记账由同一个事件驱动
- 配置发布、历史回看和失败定位有统一口径

---

## 3. 已锁定决策

### 3.1 Wallet / Account Carrier

- `Wallet` 继续作为统一载体，承载：
  - crypto wallet
  - bank-like account
- `Wave 4` 不新建独立 `BankAccount` 聚合。
- `Asset` 在 `Wave 4 Phase 1` 先作为 `master data` 定型，不纳入第一版 `revision + subject release` 模型。

### 3.2 Business Base Config Governance

- 业务基础配置对象固定为：
  - `COA`
  - `AcctEvent`
  - `ClearingTemplate`
  - `JournalTemplate`
  - `PricingPolicy`
- 配置 authoring 采用 `config-as-code`。
- 后台只提供只读视图：
  - `Current`
  - `As-Of-Release`
  - `Revision Detail`
  - `Release Diff`
- `ConfigRelease` 按主体拆分，不做“全平台一张总 release”。

### 3.3 Pricing / Clearing / Journal Relationship

- `Price Center` 只负责：
  - rate
  - fee calculation
  - `quote snapshot`
- `Price Center` 不直接驱动 `clearing` 或 `journal`。
- `AcctEvent` 是 `clearing` 与 `journal` 的共同驱动器。
- `quote` 先被业务交易消费，再由交易推进到特定业务时刻触发 `AcctEvent`。

### 3.4 Template Versioning Rule

- `JournalHeaderTemplate + JournalLineTemplate` 必须作为一个 bundle 一起版本化。
- `ClearingTemplate + ClearingLineTemplate` 必须作为一个 bundle 一起版本化。
- 不允许 line 独立版本流。

---

## 4. Wave 4 分期总览

| Phase | 名称 | 目标 |
| --- | --- | --- |
| `Phase 0` | 语义冻结与文档基线 | 先把 `Wave 4` 的目标语义、非目标和发布治理模型落档 |
| `Phase 1` | Asset / Wallet / Account Model | 定型资产主数据、统一 `Wallet` 载体和 demo 基线 |
| `Phase 2` | Business Base Config Release Model | 定型 `revision + subject release + change ticket + approval + manual publish` |
| `Phase 3` | Event -> Clearing / Journal / Balance Projection | 定型 `AcctEvent` 驱动链、分录平衡、余额投影与 reversal 合同 |
| `Phase 4` | Pricing Center / Quote / Fee Skeleton | 定型 `PricingPolicy`、`quote snapshot`、fee skeleton 与消费者边界 |
| `Phase 5` | Acceptance And Downstream Readiness | 形成 `Wave 4` 验收清单，并明确 `Wave 5/6` 接线前提 |

建议执行顺序：

1. 先完成 `Phase 0`
2. 再完成 `Phase 1`
3. 然后 `Phase 2`
4. 再进入 `Phase 3`
5. 最后以 `Phase 4` 和 `Phase 5` 收口

---

## 5. Phase 0：语义冻结与文档基线

**目标**

先把 `Wave 4` 的长期领域语言和治理模型锁死，避免一边开发一边改名词。

**P0 交付物**

- `Wave 4` phase plan
- `business-base-config-release-model` ADR
- `Wave 4` 约束、specs、acceptance 文档骨架
- `clearing` 作为唯一长期名词收口

**DoD**

- `Wave 4` 的范围与非目标清楚
- `quote / event / clearing / journal / wallet balance` 的关系清楚
- 配置治理模型不再停留在聊天口径

---

## 6. Phase 1：Asset / Wallet / Account Model

**目标**

把资产主数据、统一钱包载体和系统钱包路由规则定型，为后续资金业务提供统一资产结构。

**P0 交付物**

- `Asset master` 语义和状态约束落档
- `Wallet` 统一载体语义落档：
  - `ownerType`
  - `ownerId`
  - `type`
  - `direction`
  - `walletRole`
  - `walletNo`
- customer / platform baseline 落档：
  - 客户资金池基础配置：`MASTER`、`PAYOUT`、`CUST_BANK`
  - 公司资金池基础配置：`LIQ`、`LIQ_BANK`
  - 客户 `DEPOSIT` 充值地址 / vIBAN 按需生成，不属于预置基础配置
- 系统钱包编号与 role-based routing 规则落档

**DoD**

- 后续文档和开发不再讨论“是否要单独建 BankAccount”
- wallet routing 和 owner scope 规则统一
- `Wave 5/6/7` 可直接复用同一套 wallet/account 口径

---

## 7. Phase 2：Business Base Config Release Model

**目标**

把业务基础配置从“可 CRUD 的配置表”提升为“有历史、有发布、有回看”的治理对象。

**当前状态**

- `Phase 2` 核心 runtime 已实现，并已补齐一次本地 closeout smoke：
  - `business_config_revisions / releases / release_items`
  - `config:release:stage / validate / publish`
  - `Business Config Releases` 只读查询接口与 admin 只读页
  - `Subject Release` 生命周期动作已接入 canonical audit logging
  - 旧 `COA / AcctEvent / JournalTemplate / ClearingTemplate / PricingPolicy` 写入口已物理删除
- `Phase 2` 现在可视为完成；后续只剩与 `Phase 3/4/5` 衔接时的增量回归，不再阻塞本 phase closeout。

**P0 交付物**

- `Business Base Config Subject` 范围锁定：
  - `COA`
  - `AcctEvent`
  - `ClearingTemplate`
  - `JournalTemplate`
  - `PricingPolicy`
- `Revision` 与 `Subject Release` 语义锁定
- `Change Ticket + Approval + manual publish` 激活链路落档
- 后台只读视图语义落档：
  - `Current`
  - `As-Of-Release`
  - `Revision Detail`
  - `Release Diff`

**DoD**

- 单条配置的历史和主体级快照都能被文档清楚区分
- 不再把“直接后台修改配置”当成 `Wave 4` 主方案
- `Asset` 与业务基础配置的治理边界清楚

---

## 8. Phase 3：Event -> Clearing / Journal / Balance Projection

**目标**

把 `AcctEvent` 驱动链定型，使清分、记账和钱包余额投影共享同一份业务输入快照。

当前 runtime 的首个实现切片已经锁定为 `Withdraw`：

- 统一事件执行器驱动 `withdraw quote -> withdrawal -> AcctEvent -> clearing + journal`
- `Withdraw` 的 `APPROVED / SUCCESS / FAILED / RETURNED / CANCELLED / REJECTED` 事件已接入统一执行器
- `Deposit / Swap / InternalTx` 暂时仍走兼容路径，不属于本阶段已实现范围

**P0 交付物**

- `AcctEvent` 作为业务时刻驱动器的语义落档
- template resolution 规则落档：
  - missing template hard fail
  - source context evaluation
  - idempotent replay
- `journal` 合同落档：
  - strong balance check
  - source-level idempotency
  - reversal / bulk reversal
- `wallet balance` 投影合同落档：
  - snapshot
  - entry
  - negative balance blocking

**DoD**

- `clearing` 与 `journal` 关系清楚：
  - 同事件驱动
  - 同上下文消费
  - 互不派生
- `Withdraw` 可通过现有 `quote` 主链完成：
  - `quote -> withdrawal -> approved event -> clearing + journal -> wallet balance projection`
- `Withdraw` 终态事件保持 event-governed：
  - `SUCCESS`
  - `FAILED`
  - `RETURNED`
  - `CANCELLED`
  - `REJECTED`
- 失败阻断和不污染余额成为硬约束
- `Wave 5/6/7` 的 posting 主线不再需要临时定义

---

## 9. Phase 4：Pricing Center / Quote / Fee Skeleton

**目标**

把 `PricingPolicy`、`quote snapshot` 和 fee skeleton 定型，为 `swap` 与 `withdraw` 提供统一的定价前置能力。

**P0 交付物**

- `Price Center` 范围锁定：
  - policy management
  - simulation
  - quote generation
- `Quote Snapshot` 语义锁定：
  - rate
  - fee breakdown
  - totals
  - `policyRef`
  - TTL / consume-once
- fee skeleton 合同落档：
  - fee item
  - rounding
  - totals
  - downstream consumption

**DoD**

- `swap` 与 `withdraw` 两类消费者边界清楚
- `Price Center` 不再被混成 event/posting engine
- fee skeleton 已可作为后续波次共享合同

**当前运行时状态（2026-03-23）**

- `PricingCenterService` 已成为 `swap + withdraw` 的统一 quote runtime owner
- `SwapQuotesService` 已在 cleanup round 2 中物理删除，所有 swap quote 调用点已直接接到 `PricingCenterService`
- `WithdrawPricingQuote` 继续使用真实 TTL；cleanup round 2 不再为 far-expiry 历史数据保留运行时兼容
- admin `/dashboard/pricing/quotes` 已扩成统一只读 `Quote Center`
- 本阶段仍未引入统一 `Quote` 总表，继续保留 `SwapQuote` 与 `WithdrawPricingQuote`

---

## 10. Phase 5：Acceptance And Downstream Readiness

**目标**

把 `Wave 4` 做成可验证、可演示、可作为下一波前置条件的底座。

**当前运行时状态（2026-03-23）**

- `Phase 4` 的 `swap + withdraw quote` 统一 runtime 已交付
- `Phase 5` 当前采用 implemented-scope closeout：
  - local `main` DB migration
  - `swap/withdraw quote` API smoke
  - acceptance evidence 写回文档
- implemented-scope closeout evidence has been recorded on `2026-03-23`
- 本阶段的 closeout 不要求补完原始蓝图里的所有 downstream 业务链
- clean reset 后的 full-stack `dev:start` 仍存在本地 backend 进程不稳定问题；当前 closeout 已通过同一 `main` DB 的 backend-only runtime 完成，不阻塞本 phase 完结

**P0 交付物**

- `Wave 4` acceptance checklist
- 配置发布校验与 smoke 基线
- 与 `Wave 5/6` 的前置依赖说明

**代表性验收主线**

- `COA release` 历史回看
- `withdraw quote -> transaction -> approved event -> clearing + journal`
- `swap/withdraw quote lifecycle -> unified Quote Center`

**代表性异常线**

- missing template
- journal unbalanced
- repeated event / repeated publish idempotency block

**DoD**

- 验收路径不再停留在“开发自己口头说明”
- downstream 波次知道自己依赖 `Wave 4` 的哪些合同

**当前不阻塞 closeout 的剩余 gap**

- full `swap` lifecycle acceptance
- full `deposit` lifecycle acceptance
- `InternalTx` unified event execution acceptance
- 更广义 downstream readiness 与 end-to-end settlement 演练

---

## 11. Post-Closeout Remediation

`Phase 5` implemented-scope closeout 完成后，`Wave 4` 又补齐了两项 `P1` 级整改：

- `business config release` 的 `stage / validate / publish` 已接入 canonical audit logging
- `BusinessConfigService / TreasuryService / WalletsService / WithdrawWorkflowOrchestrator` 已完成核心运行时代码 `as any` 清理

这两项整改不单独形成新的 `Phase 6`，而是归入 `Wave 4 post-closeout remediation`。

当前已关闭的 remediation 范围：

- governance change lifecycle 有 durable audit evidence
- `Wave 4` 核心账务/钱包/治理链路的高风险类型逃逸点已清理

当前仍未宣称完成的范围：

- `PricingCenterService` 的更广范围类型清理
- 前端 pricing config edit shell 的最终只读收口

---

## 12. 文档落档清单

`Wave 4` 的文档交付结构固定为：

- `docs/roadmap/wave-4-ledger-asset-structure-phase-plan.md`
- `docs/adr/business-base-config-release-model.md`
- `docs/constraints/wallet-account-model-constraints.md`
- `docs/constraints/business-base-config-release-constraints.md`
- `docs/constraints/posting-clearing-balance-projection-constraints.md`
- `docs/constraints/pricing-and-quote-constraints.md`
- `docs/specs/modules/accounting-ledger-module.md`
- `docs/specs/modules/pricing-center-module.md`
- `docs/specs/modules/asset-treasury-foundation-module.md`
- `docs/specs/entities/wallet-entity.md`
- `docs/specs/entities/business-config-release-entity.md`
- `docs/specs/entities/pricing-quote-entity.md`
- `docs/specs/workflows/config-release-activation-workflow.md`
- `docs/specs/workflows/quote-event-clearing-journal-workflow.md`
- `docs/acceptance/wave-4-ledger-asset-structure-acceptance-checklist.md`

---

## 13. 明确不做

`Wave 4` 明确不做这些完整业务闭环：

- payin/deposit 实际入账链路
- swap 全生命周期
- withdraw 全生命周期
- 平台全局总 release 模型
- 后台在线编辑业务基础配置
- 独立 `BankAccount` 聚合

---

## 14. 与后续波次关系

- `Wave 5` 依赖 `Wave 4` 的资产结构、posting、wallet/balance 与 config release 基线
- `Wave 6` 依赖 `Wave 4` 的 `pricing policy + quote snapshot + fee skeleton`
- `Wave 7` 依赖 `Wave 4` 的 withdraw pricing、bank-like wallet 语义和 reversal/balance 规则

本文件当前用于描述 `Wave 4` 已实现切片、cleanup 结果、post-closeout remediation 与剩余 gap，不再只是待实现阶段规划。

# 系统一页纸（overview）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-08-26 ｜ agent 首读文档

## 0. 这是什么系统

虚拟币 / 法币 broker-dealer 演示系统：客户完成开户合规后，**充值 → 兑换 → 提现**，全程被合规筛查（Sumsub）、审批治理（maker/checker）、复式账本（实时 1:1 记账）和对账覆盖。三个使用面：客户端（3002）、管理台（3001）、后端 API（3000）。外部依赖——Sumsub 合规、链上、银行——**全部是模拟的**（详见 `demo/simulated-externals.md`）。

## 1. 九个模块与依赖

| 模块 | 管什么 | 一句话 |
|---|---|---|
| V1 治理底座 | 审批 / 审计 / RBAC / 管理员生命周期 | 谁能做什么、做过什么都查得到 |
| V2 客户与合规 | 开户 onboarding / 客户档案 / 限制与标签 / 风险评估 | 客户是谁、能不能交易 |
| V3 财务配置 | 资产 / 钱包 / 费率 / 限额 / 定价 | 交易的静态参数从哪来 |
| V4 充值 | 客户入金全流程（KYT 筛查、冻结处置、没收/退回/上缴） | 钱怎么进来 |
| V5 提现 | 客户出金全流程（10 态状态机、审批门、补料） | 钱怎么出去 |
| V6 兑换 | 币币/法币兑换（四腿记账、合规裁决） | 钱怎么换 |
| V7 财资 | 公司自有资金（已瘦身，非交易链路） | 公司自己的钱 |
| V8 对账 | 账本 vs 外部余额核对、破口分案处置 | 账对不对得上 |
| 共享域 | 账本（TigerBeetle 复式记账）/ 资金单（物理转账镜像）/ Sumsub 接入 | 三条交易流程共用的地基 |

依赖：V1+V2+V3 是地基；V4/V5/V6 是三条平行的交易流程；V8 在事后核对；账本与资金单被三条流程共用。

## 2. 资金从入到出（全景）

```
客户充值（链上/法币） ──► 客户钱包（账本贷记客户应付）
                              │
                              ▼ 兑换（卖出腿+买入腿+费腿，四腿就地记账）
                              │
                              ▼ 提现（本金腿+费腿）──► 客户收款地址/账户
公司收入：各流程费腿 ──► 公司费用户（FIRM）
```

每一步都是同一个节拍：**状态机推进 + 资金单（物理转账 1:1 镜像）+ 账本记账（实时、逐腿）+ 审计留痕**。异常结局（冻结、没收、退回、上缴、解冻）走 maker/checker 审批后同样记账、同样留痕。对账引擎（V8）事后核对账本与外部余额，破口开案。

## 3. 四类业务键

| 类 | 键 | 用途 |
|---|---|---|
| 客户 | `customerNo` | 客户对外唯一识别 |
| 订单 | `depositNo` / `withdrawNo` / `swapNo` | 三域交易单号 |
| 资金单 | `fundsOrderNo` | 物理转账镜像单号 |
| 治理 | `approvalNo` / `caseNo`（对账另有 `runNo`） | 审批单与案件号 |

铁律：对外识别一律用业务键，不用内部 id；管理台不暴露 UUID。

## 4. 各模块权限包拆分

角色可随时在管理台创建，所以**不做角色矩阵**；稳定的是**权限包**（PermissionGroup）——角色由包组合出来，SoD（职责分离）靠包的边界演示。按模块列包：

| 模块 | 权限包 | 说明 |
|---|---|---|
| 通用 | BASE_ACCESS | 登录管理台的底权 |
| V1 · IAM | IAM_MEMBER_READ / IAM_MEMBER_MANAGE ｜ IAM_ROLE_READ / IAM_ROLE_ASSIGN / IAM_ROLE_DEFINE ｜ IAM_CREDENTIAL_RESET | 成员查/管、角色查/授/定义、凭据重置 |
| V1 · 审批 | GOV_APPROVAL_READ / WRITE / DECIDE ｜ GOV_APPROVAL_POLICY_READ / WRITE ｜ GOV_REGULATORY_GATE_WRITE | 看单、提单、裁决分离；审批策略与监管闸门 |
| V1 · 审计 | AUDIT_READ ｜ AUDIT_EXPORT_READ / CREATE | 看日志与证据包导出分离 |
| V2 · 客户 | CUSTOMER_READ / WRITE ｜ CUSTOMER_TAG_VIEW / MANAGE ｜ CUSTOMER_RESTRICTION_READ / WRITE / RELEASE ｜ RISK_DECISION_RECORD_READ / WRITE | 档案、标签、限制（开/解分离）、风险决策记录 |
| V3 · 财务配置 | ASSET_CONFIG_READ / WRITE ｜ WALLET_READ / WRITE ｜ WITHDRAWAL_ADDRESS_READ / WRITE ｜ TRANSACTION_LIMIT_READ / WRITE ｜ CUSTOMER_RATE_READ | 资产、钱包、提现地址、限额、费率 |
| V4 充值 | TRADING_DEPOSIT_READ / WRITE | 看单与操作分离（放行/冻结/处置归 WRITE） |
| V5 提现 | TRADING_WITHDRAW_READ / WRITE | 同上 |
| V6 兑换 | TRADING_SWAP_READ / WRITE | 同上 |
| V7 财资 | INTERNAL_TRANSFER_READ / WRITE ｜ INTERNAL_FUND_READ | 公司自有资金 |
| V8 对账 | RECON_RUN_READ / WRITE ｜ RECON_CASE_READ ｜ RECON_EXTERNAL_BALANCE_READ | 跑批、案件、外部余额 |
| 账本 | LEDGER_ACCOUNT_READ / WRITE ｜ LEDGER_EVIDENCE_READ ｜ LEDGER_FLOW_READ | 科目、凭证、流水 |
| 对手方 | COUNTERPARTY_READ / WRITE | VASP 对手方档案 |
| 演示专用 | SIMULATE_EXPIRED_WRITE 等 | ⚡模拟按钮（拨 SLA、喂裁决），仅演示模式注册 |

另有**职务谓词**（少数端点直接点名职务当硬门）：MLRO、CISO、OPS_OFFICER、INVESTOR_OVERRIDE——"职务即权限"，用于合规处置这类必须指名到人的动作。

> 包的权威清单在代码 `src/modules/identity/access-control/rbac.catalog.ts`（含端点登记与 action-bucket 目录）；本节是其业务口径快照，权限点变动时由 agent 同步。

## 5. 关键技术节点（overview 级）

- 后端模块根 `src/modules/`：trading（三域交易）、identity（客户+IAM）、governance（审批）、asset-treasury（资产钱包）、accounting（账本）、clearing-settle（对账）、audit-logging、funds-orders、deposit/swap/withdraw-sumsub + sumsub-ingestion（合规接入）
- 状态机：各域 service 内显式迁移表（如 `withdraw-transactions.service.ts` 的 10 态 20 边）；工作流（`*-workflow.service.ts`）串主体
- 账本：TigerBeetle 复式记账，9 码科目表，实时 1:1 逐腿 post；对账引擎在 `clearing-settle`
- 权限：`rbac.catalog.ts` 集中登记端点 × 权限包

## 6. 演示缺口

待 Phase 3 各模块文档就位后按模块汇总；当前看 `BACKLOG.md`。

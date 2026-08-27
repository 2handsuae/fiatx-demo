# V8 对账站设计稿（Phase 4 · 站5，2026-08-27 α 盘点）

## 盘点结论：这一域比预想干净

历轮重构已把重活干完：引擎只剩 v2 单套（1:1 钱包级比对，五公式身位已被取代）；forwardRef 零张；案件/跑批留痕已用业务键（caseNo/runId）；推单已走操作员通道。本站是小站。

## 家底

- **模块**：clearing-settle/reconciliation（3369 行非测试）——engine/v2 三件（余额比对/流水匹配/分桶）+ workflow（跑批 961 行）+ domain（查询 856 行）+ disposition（推单+回执查找）+ projector（账本流水投影）+ sweep（每日 02:30 Dubai cron）+ admin controller（9 端点）
- **模型 6 张**：AccountFlow / ReconciliationRun / Case / LineItem / RunWallet / ExternalBalance
- **页面 7 张**：Runs 列表/详情、Cases 列表/详情、External Balances、Demo Compare、AccountFlow
- **现役词 5 个**：RECON_CASE_OPENED ｜ SYSTEM_RECON_CASE_AUTO_HEALED ｜ SYSTEM_RECON_RUN_COMPLETED ｜ RECON_PUSH_ORDER_SYNCED ｜ RECON_PUSH_ORDER_MANUAL
- **案件生命周期**：OPEN → (复跑确认续开 / 自动愈合 RESOLVED)；人工 RESOLVED / WAIVED 只是 schema 注释，无端点无写方（缓做，BACKLOG 口径）

## α 发现

1. **五公式残渣**（constants/reconciliation.constants.ts）：CLIENT_ASSET_CODES / CLIENT_LIABILITY_CODES / LAYER_ASSET_CODE / UnmatchedType 四个出口零引用，注释还写着"I1 / I5 左侧"、科目用的是点分旧名——全仓只有 AMOUNT_TOLERANCE 一个出口活着。
2. **铁律①缺口**：POST /admin/reconciliation/runs/wallet 是操作员动作，但 run() 不收 actor，完跑只写 recordSystem——**管理员手动触发跑批查不到是谁按的**。
3. **推单留痕三处旧**：主对象类型还挂 INTERNAL_FUND（表已更名 funds_orders）；不继承父单（充值/提现/兑换）的旅程号——三查里"按旅程"看不到对账处置这一步；SYNCED / MANUAL 两码实为同一个"推单落地"动作，只差证据通道，metadata.manualConfirm 本来就在区分。
4. **命名口径**：五词里两个带 SYSTEM_ 前缀、三个不带，同域不同姓。

## β 提案：V8_RECON_AUDIT_ACTIONS 名册 4 码（5 旧词 → 4 新词）

对账件天生无客户旅程，用第三种 correlation 模式 **NONE**（机器闸现成支持）；唯一例外是推单——它落在别人的旅程里，INHERIT 父单。

| 码 | 模式 | 硬字段 | 说明 |
|---|---|---|---|
| RECON_RUN_COMPLETED | NONE | — | 改名收编 SYSTEM_RECON_RUN_COMPLETED；**双通道**：cron 走系统通道、管理员触发走操作员通道（同动作不因语境拆名，谁跑的落 actor 字段）——顺手补铁律①缺口 |
| RECON_CASE_OPENED | NONE | walletRef, bucket, deltaAmount | 现名保守；破口立案 |
| RECON_CASE_AUTO_HEALED | NONE | — | 改名收编 SYSTEM_RECON_CASE_AUTO_HEALED |
| RECON_PUSH_ORDER | INHERIT（父单旅程） | fromStatus, toStatus | 合并 SYNCED+MANUAL（同动作不因语境拆名；manualConfirm/证据三件套在 metadata）；主对象类型 INTERNAL_FUND→FUNDS_ORDER；OWNER=父单客户号 |

**退役 4 名**进拒写闸：SYSTEM_RECON_RUN_COMPLETED ｜ SYSTEM_RECON_CASE_AUTO_HEALED ｜ RECON_PUSH_ORDER_SYNCED ｜ RECON_PUSH_ORDER_MANUAL。

## 本站不做

人工 RESOLVED/WAIVED 处置功能（缓做在案）｜ bucket 四桶语义 ｜ recon:demo:break 7/9 两 MISSED（BACKLOG 在案）｜ RECONCILIATION_RUN_V8 实体类型名（现名保守）｜ 引擎/查询/页面结构（能跑不折腾）

# 设计 · Travel Rule 交换实体落地（状态机 + Sumsub 模拟 + 充值/提现接入）

Date: 2026-07-12 ｜ Status: Draft（实现设计，将接 writing-plans）｜ 来源: brainstorming（本会话）
关联业务口径: 《Travel Rule 交换 PRD》（Lark `RYzDdhCZbotE4rxsfTxlEkLTg8g`）+ 《交易风控三闸门》§11

> 把 TR 从「订单上的字符串字段」升级为「独立交换实体 + 6 态状态机」，用 Sumsub 事件模拟驱动流转，接入充值/提现 L2。**本设计 = 甲方选定的第一版范围（订单锚定）**。

---

## 1. 范围（业主 2026-07-12 定）

- **做**：完整 6 态交换实体 + 状态机 + Sumsub 事件模拟 + **订单锚定**接入充值/提现 L2。
- **不做（非目标）**：场景 A 预告登记 / 认领匹配引擎（地址+金额+时间窗）/ `consumeTtl` 驱动 / 真实 Sumsub webhook 接线 / 入站 TR 消息处理。这些是纯增量子系统，本期建表留字段但不驱动。
- **理由**：6 态在订单锚定下**全部可达**（待认领→已消费只是「订单已在时秒过」），状态机完整实现；场景 A 只多一个「钱先于单」的入口。

## 2. 锁定决策

| # | 决策 | 选择 |
|---|---|---|
| K1 | 范围 | 甲：完整状态机 + 订单锚定接入；场景 A 推后 |
| K2 | 订单 `travelRuleStatus` 字段 | 甲：**保留作判决摘要**，由交换实体驱动；L2 汇合逻辑（`checkAutoApproval`/`checkScreenPass`）不动 |
| K3 | 产出 | 乙：设计→writing-plans→**开 worktree 落地** |
| K4 | Sumsub 事件映射 | 模拟端点发 4 种事件驱动 webhook 类转换（T1/T3/T4）；平台类转换（T2/T3 否认/T5）不由模拟驱动 |

## 3. 数据模型

新表 `travel_rule_exchanges`（字段照 PRD §3.1）：
- 身份/关联：`trExchangeNo`(TRX- 业务键)、`direction`(OUTBOUND/INBOUND)、`sumsubTxnId`(orderNo 派生·幂等键)、`orderType`+`orderNo`、`txHash?`、`customerNo`、`traceId`
- 对手/交易：`counterpartyVasp?`、`counterpartyAddress`、`assetCode`、`declaredAmount`
- 状态：`status`(6 态字符串，无 Prisma enum——与现仓一致)、`failReason?`、`verifiedAt?`、`lastExternalState?`
- 时钟：`sessionDeadline?`（本期驱动 T4）、`consumeTtl?`（**建列不驱动**，场景 A 复用）
- 审计：`createdAt`/`updatedAt`

订单侧（不删，作镜像摘要）：`deposit_transactions.travelRuleStatus`(schema.prisma:960-964)、`withdraw_transactions.travelRuleStatus`(schema.prisma:1183-1187) 保留，值由交换实体驱动。

## 4. 状态机（新 `travel-rule/constants/travel-rule-transitions.constant.ts`，照 `funds-orders/constants/funds-order-transitions.constant.ts` 模板）

状态：`EXCHANGING`(交换中) / `VERIFIED`(待认领) / `CONSUMED`(已消费✓) / `REJECTED`(未通过✗) / `EXPIRED`(已超时✗) / `CANCELLED`(已取消⏹)。`TERMINAL_STATUSES = {CONSUMED, REJECTED, EXPIRED, CANCELLED}`。

跃迁（`Transitions` map + 每条守卫 `writer: 'webhook' | 'platform'`）：

| # | 起 → 止 | 触发 | writer |
|---|---|---|---|
| T1 | EXCHANGING → VERIFIED | 核验成立 | webhook |
| T2 | VERIFIED → CONSUMED | 被订单认领/闭环 | platform |
| T3 | EXCHANGING → REJECTED | 数据不匹配 / 对方拒绝（webhook）· 归属否认（platform） | webhook / platform |
| T4 | EXCHANGING → EXPIRED | 会话超时（sessionDeadline） | platform(sweep) |
| T5 | EXCHANGING → CANCELLED | 母单中止 | platform |
| T6 | VERIFIED → EXPIRED | consumeTtl 到期 | platform(sweep)（**本期不接线，留守卫**） |

守卫铁律：终态不可逆；`REJECTED(OWNERSHIP_DENIED)` 永不可写 orderNo；T2 只触发一次（一次性消费）；非法跃迁抛显式异常。

## 5. 服务与模块（遵三层规则）

- **`TravelRuleExchangeService`（领域服务）**：持实体 + 转换方法 `open()/verify()/reject()/expire()/consume()/cancel()`，每个方法查 transitions map 守卫、写 DB、**emit domain event**（own entity state change）。不订阅事件、不写业务审计（审计归调用它的 workflow）。写方法接 `tx?: Prisma.TransactionClient`。
- **模块归属**：新建 `src/modules/trading/travel-rule/`（与 deposit/withdraw 平级，同属 trading 域），含 `travel-rule-exchange.service.ts` + `constants/` + `travel-rule.module.ts`。
- 交换到终态 emit `travelrule.exchange.settled`（payload `{orderType, orderNo, direction, outcome: PASSED|FAILED}`）；充值/提现 workflow 订阅。

## 6. Sumsub 接入 + 模拟

- **dispatch 改路由**（`sumsub-ingestion.service.ts:122/:137`）：`travelRuleCheckSimulated`（充值）/`withdrawTravelRuleCheckSimulated`（提现）从「直写订单 `applyTrResult`/`updateTravelRuleStatus`」改为「按事件类型调 `exchangeService.verify/reject`」。
- **模拟端点扩展**（`admin-sumsub-simulation.controller.ts:374 tr-check` / `:470 withdraw-tr`）：Body 增 `event` 字段——
  | event | 转换 |
  |---|---|
  | `approved` | T1 → VERIFIED |
  | `mismatch` | T3 → REJECTED(MISMATCH) |
  | `declined` | T3 → REJECTED(COUNTERPARTY_DECLINE) |
  | `session_timeout` | T4 → EXPIRED(SESSION) |
  兼容:旧 `result: PASS/FAIL` 映射到 `approved`/`mismatch`,避免破坏现有 demo。
- 幂等:`sumsubTxnId + event` 去重(现 dispatch 已有 webhook 落库,复用)。

## 7. 订单接入（镜像，订单锚定）

- **建交换**：充值 `deposit-transactions.service.ts:343 initializeComplianceGates`（现 :354 置 `travelRuleStatus=PENDING`）+ 提现 `withdraw-workflow.service.ts:738 initializeTransactionScreen`（现 :749 置 PENDING）→ 改为 **TR 适用时 `exchangeService.open(orderRef)`**（交换中），并同置订单 `travelRuleStatus=PENDING`（镜像初值）。TR 不适用（法币/未达阈值）→ 不建交换、订单直接 `NOT_REQUIRED`。
- **镜像回写**：workflow 订阅 `travelrule.exchange.settled`：
  - VERIFIED → 订单 `travelRuleStatus=PASSED` → 触发既有汇合（充值 `checkAutoApproval` deposit-workflow.service.ts:176 / 提现 `checkScreenPass` :759）→ 随即 `exchangeService.consume(orderRef)`（→CONSUMED，订单锚定下秒过）。
  - REJECTED/EXPIRED → 订单 `travelRuleStatus=FAILED` → 订单 FROZEN（走既有失败分支）。
- **充值侧补 domain event**：现充值 TR 全直调（无 event，Explore 证）。新增 `travelrule.exchange.settled` 订阅使充值对齐提现的事件驱动，符合后端「domain emit / workflow subscribe」规则。提现侧已有事件驱动（`WITHDRAWAL_TRAVELRULE_UPDATED` domain-events.constants.ts:37），复用模式。
- **母单终止联动**：订单被 KYT 拒/取消时，workflow 调 `exchangeService.cancel(orderRef)`（T5）。

## 8. 审计与事件登记

- 新 domain event `TRAVELRULE_EXCHANGE_SETTLED`（`travelrule.exchange.settled`）写入 `domain-events.constants.ts`，payload shape 声明。
- 交换每次转换写审计（workflow 层）：`workflowType=TR_EXCHANGE`，action 按转换命名（`TR_EXCHANGE_OPENED`/`_VERIFIED`/`_REJECTED`/`_EXPIRED`/`_CONSUMED`/`_CANCELLED`），traceId 继承订单 traceId。

## 9. 影响面（改动文件）

新增:`trading/travel-rule/`(service + constants + module)、schema `travel_rule_exchanges` 表 + migration。
改:`sumsub-ingestion.service.ts`(dispatch:122/:137 改路由)、`admin-sumsub-simulation.controller.ts`(:374/:470 扩 event)、`deposit-workflow.service.ts`(:131 建交换 + 订阅 settled + consume/cancel)、`deposit-transactions.service.ts`(:343/:370)、`withdraw-workflow.service.ts`(:738/:759 + 订阅)、`withdraw-transactions.service.ts`(:693)、`domain-events.constants.ts`(+1 event)、`audit-actions.constant.ts`(+TR_EXCHANGE actions)。

## 10. 测试

- 转换单测:合法 T1–T6、非法跃迁拒绝、writer 守卫(webhook vs platform)、终态不可逆、一次性消费。
- 模拟 e2e:逐 event(approved/mismatch/declined/timeout)驱动 → 验交换态 + 订单 `travelRuleStatus` 镜像 + 汇合放行/FROZEN。
- 集成:充值 happy(建交换→approved→VERIFIED→PASSED→SUCCESS+CONSUMED)/ fail(mismatch→REJECTED→FROZEN);提现同构(含 preKyt 两阶段不受影响)。
- 硬闸:tsc0、现有 deposit/withdraw e2e 不回归。

## 11. 非目标（Not In Scope）

1）场景 A 预告登记 + 认领匹配引擎（地址+金额+时间窗）+ `consumeTtl` 驱动 —— 建列/留守卫，不接线。
2）真实 Sumsub webhook 接线（替换模拟端点）—— 另期。
3）入站 TR 消息（对方先发）处理 + `travelRuleOwnership` 应答 —— 场景 A 一并。
4）订单 `travelRuleStatus` 字段移除 —— K2 定保留作摘要。
5）前端 admin 交换列表/详情页 —— 可另起，本期聚焦后端状态机 + 接入。

## 12. 验收标准

□ `travel_rule_exchanges` 表 + 6 态状态机可用；转换守卫（webhook/platform、终态、一次性消费、否认不绑单）生效
□ 模拟端点 4 event 驱动 T1/T3/T4；旧 result:PASS/FAIL 兼容
□ 充值/提现 TR 适用时建交换、镜像回写订单 `travelRuleStatus`、汇合逻辑不改仍正确放行/FROZEN
□ 充值侧接入 `travelrule.exchange.settled` 订阅（补 domain event）；提现侧复用事件驱动
□ 交换转换有审计（TR_EXCHANGE_*）+ traceId 继承订单
□ 场景 A 相关（consumeTtl/预告/认领）未接线，字段/守卫就位
□ tsc0 + 现有 deposit/withdraw e2e 不回归

## 13. 关键锚点

`prisma/schema.prisma:960-964,1183-1187` ｜ `sumsub-ingestion/sumsub-ingestion.service.ts:97,122,137` ｜ `sumsub-ingestion/admin-sumsub-simulation.controller.ts:374,470` ｜ `trading/deposit-transactions/{deposit-workflow.service.ts:131,155,176 , deposit-transactions.service.ts:343,370}` ｜ `trading/withdraw-transactions/{withdraw-workflow.service.ts:738,759 , withdraw-transactions.service.ts:693}` ｜ `common/events/domain-events.constants.ts:37` ｜ 模板 `funds-orders/constants/funds-order-transitions.constant.ts`

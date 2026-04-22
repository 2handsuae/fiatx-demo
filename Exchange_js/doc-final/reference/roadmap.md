# Wave 规划快速参考（Wave 1–4 已交付）

Last Updated: 2026-04-21
Full detail: `docs/roadmap/project-version-plan.md`

---

## 已交付 Wave（1–4）

| Wave | 主题 | 核心交付 | 状态 |
|---|---|---|---|
| Wave 1 | 治理控制底座 | RBAC、Change Ticket、Delete Request、Approval Engine、Audit Evidence | 🟢 完成 |
| Wave 2 | Sumsub 集成 | Webhook 路由（5路径）、Sumsub 模拟中心（6 endpoints）| 🟢 完成 |
| Wave 3 | Onboarding & 复审 | 客户 onboarding 状态机、Material Refresh、Periodic Review、Tier Upgrade | 🟢 完成 |
| Wave 4 | 账务底座 & 配置 UI | COA/AcctEvent/Journal/Clearing/Pricing/Asset 6个配置发布流程、Wallet UI（部分）| 🟢 完成（未验收） |

---

## 待交付 Wave（5–9 规划）

| Wave | 主题 | 核心内容 |
|---|---|---|
| Wave 5 | PayIn → Deposit | 充值入账链路 + Provider connectors |
| Wave 6 | Quote → Swap | 定价 + firm quote TTL + swap 成交 + SWAP Policy UI + Outstanding / PoolSettlementBatch / PricingPolicy 实体激活 |
| Wave 7 | Withdraw → Payout | 提现 + payout 编排 + safeguarding 对账 + WITHDRAWAL Policy UI |
| Wave 8 | Internal Treasury | 内部归集/调拨、全量保障对账 + FeeOccurrence 实体激活 |
| Wave 9 | Governance Ops | SLA Timer / GovernanceRegistry 平台、Filing/Receipt、监管报送日历 |

---

## Wave 4 补充说明

- PRICING_POLICY、Outstanding、PoolSettlementBatch → **Wave 6** 范围，Wave 4 代码已预建但无数据创建路径
- FeeOccurrence → **Wave 8** 范围
- SLA Timer / GovernanceRegistry → **Wave 9** 范围
- Wallet create/edit 表单 → Wave 4 范围缺口，待补充
- 配置发布状态机：`DRAFT → VALIDATED → ACTIVE / SUPERSEDED`（无 STAGED 状态）
- 账务执行路径：`AccountingEventExecutionService` 同时调用 `JournalsService` + `ClearingsService`（两者独立，不互相调用）

---

## 关键依赖链

```
Wave 1（控制底座）
  └→ Wave 3（MLRO/SMO 审批）、Wave 4（Config Release CT 门）

Wave 2（Sumsub）
  └→ Wave 3（onboarding callbacks、material refresh、tier upgrade）

Wave 3（客户准入）
  └→ Wave 5/6/7（交易资格门 — 未 APPROVED 不得交易）

Wave 4（账务配置）
  └→ Wave 5/6/7（所有交易都依赖 COA + AcctEvent + Templates）
```

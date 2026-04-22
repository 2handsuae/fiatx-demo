# Wave 1–4 验收状态

Last Updated: 2026-04-22（Wave 2 全部通过；Wave 4 subjects 1-5 通过）

图例：🟢 已验收 | 🔴 未验收 | ⚠️ 部分实现

---

## Wave 1 — 治理控制底座

**整体状态：🟢 已验收**（验收文档：`doc-final/acceptance/wave1-acceptance-tests.md`）

> 范围边界：SLA Timer / GovernanceRegistry → Wave 9，不在 Wave 1 范围。

| # | 工作流 | 验收状态 | 说明 |
|---|---|---|---|
| 1 | 创建 admin（邀请 + 激活） | 🟢 | Change Ticket (ADMIN_INVITE) → invitation activation |
| 2 | 变更 admin 角色 | 🟢 | Change Ticket (ROLE_BINDING) → maker-checker → executeGovernedRoleBindingChange |
| 3 | 导出审计证据包 | 🟢 | Approval (DIRECT_EXECUTE) → 审批即执行，无 consume 步骤 |
| 4 | 删除 admin | 🟢 | Delete Request (target: ADMIN_USER) → creator ≠ consumer |
| 5 | 删除 Change Ticket | 🟢 | Delete Request (target: CHANGE_TICKET) → CT 必须处于终态 |
| 6 | 删除证据包 | 🟢 | Delete Request (target: AUDIT_EVIDENCE_PACKAGE) → maker-checker |

---

## Wave 2 — Sumsub 集成

**整体状态：🟢 已验收**（验收文档：`doc-final/acceptance/wave2-acceptance-tests.md`）

> 范围边界：KytCase / TravelRuleCase 废弃，不在 Wave 2 范围。

| # | 功能 | 验收状态 | 说明 |
|---|---|---|---|
| 1 | Sumsub webhook 路由 | 🟢 | 5 路径分发：onboarding / AML / material refresh / tier upgrade / case decision |
| 2 | Sumsub 模拟中心（后端） | 🟢 | 6 个 simulate endpoints：`/admin/sumsub/simulate/*` |
| 3 | Sumsub 模拟中心（Admin UI） | 🟢 | 5 个场景 tab：SumsubEventsPage.tsx |

> Wave 2 无新治理工作流，所有功能以 Sumsub 集成为核心。

---

## Wave 3 — Onboarding & 定期复审

**整体状态：🔴 未验收**

| # | 工作流 | 验收状态 | 说明 |
|---|---|---|---|
| 1 | 客户 onboarding（主流程） | 🔴 | PENDING_VERIFICATION → CDD → (EDD) → FINAL_APPROVAL → APPROVED/REJECTED |
| 2 | 材料过期补充（Material Refresh） | 🔴 | NUDGE_ONLY → URGENT → BLOCKING → RESOLVED；交易暂停直至解决 |
| 3 | 周期性风险复审 | 🔴 | PeriodicReviewSweepService 每 60s 扫描，高风险 90d / 标准 1y；到期限制交易 |
| 4 | Tier Upgrade Level 2 | 🔴 | Phase1(CRA HIGH) → Phase2(Sumsub Level2) → Phase3(MLRO + SMO 双签) |

---

## Wave 4 — 账务底座 & 配置管理 UI

**整体状态：⚠️ 部分验收**（配置发布 5 subjects 已验收；钱包 Create/Edit 未实现）（验收文档：`doc-final/acceptance/wave4-acceptance-tests.md`）

> 范围边界：Outstanding / PoolSettlementBatch / PricingPolicy → Wave 6；FeeOccurrence → Wave 8。

### 配置发布流程（5 个 subject）

| # | Subject | Admin UI | 验收状态 | 说明 |
|---|---|---|---|---|
| 1 | ASSET_CONFIG | List / Detail / Snapshot / History | 🟢 | 资产主数据，5 subjects 中的参考设计 |
| 2 | COA | List / Detail / Snapshot / History | 🟢 | 会计科目表，含 T-Account 图示 |
| 3 | ACCT_EVENT | List / Detail / Snapshot / History | 🟢 | 会计事件代码，含状态转换图；含自引用 FK 修复 |
| 4 | JOURNAL_TEMPLATE | List / Detail / Snapshot / History | 🟢 | 日记账模板，含 DR/CR 双栏分录 |
| 5 | CLEARING_TEMPLATE | List / Detail / Snapshot / History | 🟢 | 清算模板，含 INCOMING → Pool → FEE/OUTGOING 流程图；含 DB schema 漂移修复 |

所有 subject 发布路径：DRAFT → VALIDATED → ACTIVE / SUPERSEDED（Change Ticket 审批门可选）

### 钱包管理 UI（部分实现）

| # | 功能 | 验收状态 | 说明 |
|---|---|---|---|
| 6 | Wallet List 页面 | ⚠️ | 已实现 (WalletList.tsx) |
| 7 | Wallet Detail 页面 | ⚠️ | 已实现 (WalletDetail.tsx) |
| 8 | Create / Edit 表单 | 🔴 | 未实现，Wave 4 范围缺口 |

---

## 验收进度汇总

| Wave | 整体状态 | 工作流总数 | 已验收 | 未验收 |
|---|---|---|---|---|
| Wave 1 | 🟢 已验收 | 6 | 6 | 0 |
| Wave 2 | 🟢 已验收 | 3 | 3 | 0 |
| Wave 3 | 🔴 未验收 | 4 | 0 | 4 |
| Wave 4 | ⚠️ 部分验收 | 8 | 5 | 3 (含 2 个⚠️部分实现) |

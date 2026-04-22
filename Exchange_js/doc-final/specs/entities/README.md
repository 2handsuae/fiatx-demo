# Entity Specs Index (Wave 1–4)

Last Updated: 2026-04-22
Source: `doc-final/specs/entities/`

> SLA Timer → Wave 9 范围。Outstanding / PoolSettlementBatch / PricingPolicy → Wave 6 范围。FeeOccurrence → Wave 8 范围。KytCase / TravelRuleCase → 废弃，不在任何 Wave。

---

## Wave 1 — 治理实体

| 实体文件 | 业务对象 |
|---|---|
| `doc-final/specs/entities/admin-user.md` | Admin 用户 |
| `doc-final/specs/entities/role.md` | RBAC 角色 |
| `doc-final/specs/entities/permission.md` | 权限项 |
| `doc-final/specs/entities/change-ticket.md` | 变更单 |
| `doc-final/specs/entities/delete-request.md` | 删除请求 |
| `doc-final/specs/entities/approval-case.md` | 审批 case |
| `doc-final/specs/entities/audit-evidence-package.md` | 审计证据包 |

---

## Wave 3 — 客户 & 合规实体

| 实体文件 | 业务对象 |
|---|---|
| `doc-final/specs/entities/customer.md` | 客户主档（CustomerMain） |

> Wave 3 实体补充（MaterialRefreshCycle、PeriodicReviewCycle、TierUpgradeCase 等）待代码稳定后补录。

---

## Wave 4 — 账务 & 配置实体

| 实体文件 | 业务对象 |
|---|---|
| `doc-final/specs/entities/asset.md` | 资产主数据 |
| `doc-final/specs/entities/coa.md` | 会计科目（COA）|
| `doc-final/specs/entities/acct-event.md` | 会计事件代码 |
| `doc-final/specs/entities/journal.md` | 日记账分录 |
| `doc-final/specs/entities/clearing.md` | 清算条目 |
| `doc-final/specs/entities/business-config-release.md` | 配置发布版本 |
| `doc-final/specs/entities/wallet.md` | 钱包 |

---

## 范围外实体（跨 Wave 标注）

| 实体 | 归属 Wave |
|---|---|
| SlaTimer / GovernanceRegistry | Wave 9 |
| Outstanding / PoolSettlementBatch / PricingPolicy | Wave 6 |
| FeeOccurrence | Wave 8 |
| KytCase / TravelRuleCase | 废弃 |

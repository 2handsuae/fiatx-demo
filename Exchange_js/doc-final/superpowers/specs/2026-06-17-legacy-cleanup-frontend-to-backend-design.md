# Legacy Cleanup (Frontend-Dead → Backend-Dead) — Design Spec

> Status: design / approved-for-spec-review (brainstorm + 4-agent trace done 2026-06-17)
> Scope: **T1 + T2-A + T2-B**(用户选定)。T3、T4 明确 OUT。
> 前置事实:admin IA 重构已落地(菜单收敛到 `/admin/<domain>/`);非侧边栏页 = 用户判定 legacy。见 memory `admin-legacy-pages-to-clean`。

---

## 1. 调研结论(为什么是这个范围)

从前端废弃页**反向追溯**到后端(4 个 read-only trace agent 取证),核心洞察:**前端死 ≠ 后端死**,落到 4 类处置:

| 层 | 后端真相 | 本轮 |
|---|---|---|
| **T1 纯死** | 后端 controller 从未实现(运行时 404),无 model | ✅ 删 |
| **T2-A reimbursement** | `ReimbursementObligationsService` 零 workflow/cron/event 调用 | ✅ 删整模块 |
| **T2-B config-release** | 仅被死页+脚本用,`publishRelease` 已坏;`PricingPolicy` 写而不读;Regulatory Gates 未启用→FK 卡点解除 | ✅ **全删**(含 release 表 + 反向解 regulatory-gates FK) |
| T3 live 视图 | `Onboarding`/`TransactionCompliance`/`RiskEngine` = 充提兑/onboarding/风控的 LIVE 执行脊柱(10~13+ 调用点) | ❌ 不动 |
| T4 internal-* | WORKFLOW-COUPLED + funds-layer 双写 | ❌ 另起 migration spec |

## 2. 删除清单(IN SCOPE)

### T1 — 纯死前端页 + 残留

**前端页(`admin-web/src/pages/`,删文件 + App.tsx 的 lazy import + `<Route>`):**
- `ComplianceAlertsPage` / `ComplianceAlertDetailPage`(`compliance/alerts*`)
- `ComplianceCasesPage` / `ComplianceCaseDetailPage`(`compliance/cases*`)
- `CaseEvidenceExportsPage` / `CaseEvidenceExportDetailPage`(`compliance/case-evidence-exports*`)
- `OutstandingSettlementList` / `OutstandingSettlementDetail`(`reconciliation/outstanding-settlements*`)
- `PoolSettlementBatchListPage` / `PoolSettlementBatchDetailPage`(`treasury/pool-settlement-batches*`)
- `InternalCollectionsPage`(`treasury/deposit-wallet-monitor` + `treasury/internal-collections` redirect)
- `TreasuryResourcePage` / `TreasuryResourceDetailPage`(`treasury/fee-occurrences*` —— 注:该组件也服务 reimbursement,见 T2-A,两者同删故组件可删)+ `wave8OpsConfig.ts` 中 fee-occurrences/reimbursement 条目
- `compliance/audit-logs` legacy redirect 路由

**后端/契约残留:**
- RBAC catalog(`src/modules/identity/access-control/rbac.catalog.ts`):`alerts` 5 条(L272-276)、`cases` 11 条(L277-338)、`case-evidence` 4 条(L339-362)、`PermissionGroup` union 成员 `ALERT_*`/`CASE_*`/`CASE_EXPORT_*`(L30-35)、4 个角色的对应 binding(L1060-63,1134-41,1165-72,1207-09)
- 前端 `admin-web/src/rbac/permissions.ts`:`ALERTS_*`/`CASES_*`/`CASE_EVIDENCE_*`(L64-77)、phantom `OUTSTANDING_SETTLEMENT*`(L30-32)
- `audit-logs.service.ts` 死分支:`db.complianceAlert?.findMany` + `db.complianceIncident?.findMany`(~L1926-2708,3 处各 2)—— 删这些 enrichment 分支
- Prisma 孤儿列:`SwapTransaction.alertId`(`schema:1681`)、`SwapTransaction.caseId`(`schema:1682`)→ migration drop
- 未用常量:`POOL_SETTLEMENT_BATCH_APPROVAL`(`approval.constants.ts:29,201`)、`FEE_OCCURRENCE` audit 常量(`audit-actions.constant.ts:61`)—— 删前确认零引用

### T2-A — `reimbursement-obligations` 整模块

**后端(删整目录 `src/modules/asset-treasury/reimbursement-obligations/`):** controller + service + module + dto。从 `app.module.ts` 移除 `ReimbursementObligationsModule`。
**RBAC:** `rbac.catalog.ts:453,459,465` 的 reimbursement 路由。
**前端:** TreasuryResource 的 reimbursement-obligations 入口(随 T1 的 TreasuryResourcePage 删除)+ permissions `REIMBURSEMENT_OBLIGATION*`。
**Prisma:** `ReimbursementObligation` model —— ⚠️ 删前确认无其它 FK/relation(roadmap 曾说挪 V8,但当前零 workflow 引用);若 `Wallet`/其它 model 有 relation 字段需一并清。
> 证据:`ReimbursementObligationsService` 全仓零注入(仅自身 controller)。

### T2-B — config-release 簇

**后端(删):** `src/modules/governance/business-config/` 下 `business-config.controller.ts`、`business-config.service.ts`、`business-config.module.ts`、`legacy-ct-stubs.ts`、dto;从 `governance.module.ts:12` 移除 `BusinessConfigModule`。
**脚本(删 + 移除 package.json):** `scripts/config-release-stage.ts`、`config-release-validate.ts`、`config-release-publish.ts`、`config-release-publish-from-governance.ts`;`package.json` 的 `config:release:stage/validate/publish`。
**前端(删):** `PricingPolicyList`、`PricingPolicyHistory`、`PricingWithdrawalConfigPage`、`BusinessConfigReleasesPage` + App.tsx routes/imports + permissions `PRICING_POLICIES_*`/`PRICING_WITHDRAW_CONFIG_*`/business-config-releases。
**Prisma(全删 model):** `PricingPolicy`、`BusinessConfigRevision`、`BusinessConfigReleaseItem`、**`BusinessConfigRelease`**(连表一起删)、`changeTicketId` 列。

**✅ FK 卡点已解除(用户确认 Regulatory Gates 未启用):** 连 `BusinessConfigRelease` 表一起删,但需**反向解开保留模块 regulatory-gates 对它的耦合**(已取证,耦合面 bounded):
- **schema**:删 `RegulatoryGateItem.businessConfigReleaseId`(`String?`,onDelete:SetNull)+ `businessConfigRelease` relation + `BusinessConfigRelease.regulatoryGateItems` 反向 relation。
- **`regulatory-gates.service.ts`(~18 处)**:删 LICENSE_SCOPE_CHANGE 分支的 require+findUnique+bind release(L440-458)、`businessConfigReleaseId: null` 赋值(L400,434,482)、map 投影(L267,306-311,588)、所有 `businessConfigRelease: true` include(L337,605,687,740,807,866,939,1008);LICENSE_SCOPE_CHANGE gate 改为不绑定 release(该 subtype 简化)。
- **`demo/wave8-gov02-demo.util.ts`**:删 businessConfigRelease teardown 引用(L25,94,100,151,153)。
> 即:config-release **整簇连表全下线**;regulatory-gates 失去"绑定 config release"能力(未启用,可接受),页面与其余 gate 类型不变。

## 3. KEEP 护栏(看着像但**禁止**删 —— 防误杀)

| 必须保留 | 为什么 | 证据 |
|---|---|---|
| `OutstandingsService`/`Controller`/`Module`(`/admin/reconciliation/outstandings`,**无** `-settlements`) | swap-workflow 注入 + live Reconciliation 页 | `swap-workflow.service.ts:17` |
| `AuditEvidencePackage`(`/admin/audit/evidence-packages`,Audit Center) | live,与死的 compliance case-evidence 不同 | `audit-evidence-package.controller.ts:22` |
| `ComplianceSession.caseId`(`schema:444`) | onboarding session 字段,非 compliance incident | — |
| T3 全部:`OnboardingService`/`TransactionComplianceService`/`TransactionRiskBridgeService`/`RiskEngineService`/`RiskDecisionRecordsService` + 其 POST callback/simulate 端点 | 充提兑/onboarding/风控 LIVE 脊柱 | 10~13+ 调用点 |
| T4 全部:`internal-transactions`/`internal-funds`/`internal-transaction-workflow` + `exchange/internal-transactions` 页 | WORKFLOW-COUPLED,留待 funds-layer 迁移 spec | trading `findFundsOrderBySource` + 审批 `@OnEvent` |

## 4. 验证计划(闭环)

1. **后端** `npm run build`(nest)= exit 0;`npx prisma validate` + `prisma migrate`(dev:rebuild)无破坏。
2. **前端** `cd admin-web && npx tsc -b && npm run build` = exit 0。
3. **grep 零残留**:删除的页/service/model 名全仓零引用(`rg <Name>`)。
4. **行为不回归(关键)**:删 T2/T1 后,跑一次 sim(充值→兑换→提现→EOD)确认 T3/T4 的 live 合规/结算/记账链**不受影响**(`scripts/verify-two-book.ts` 或现有 sim)。
5. **渲染**:登录 `/admin`,确认 14 组菜单页全部正常(未误删 live 页);旧死页路径访问优雅兜底不白屏。

## 5. Out of Scope

- **T3**(cdd/edd/tx-compliance/risk admin 视图):保留。若后续产品确认运营不需要这些查看页,另起一轮(仅删页+只读 GET 端点,service 留)。
- **T4**(internal-* 双写收口):独立 funds-layer migration spec。
- IA 路由重构本身(已落地)。

## 6. 风险

- **config-release 全删 + regulatory-gates 解耦**最易出错:删 4 个 model(含 `BusinessConfigRelease`)+ `changeTicketId` 列 + 反向清 regulatory-gates ~18 处 release 引用 + schema FK 字段;migration 在 `dev:rebuild` 下验证;改完确认 Regulatory Gates 页与各 gate 类型仍正常(LICENSE_SCOPE_CHANGE 不再绑 release)。
- **reimbursement model 删除**:确认无残留 FK relation 字段(Wallet 等)需同步清。
- T1 的 RBAC/permissions 删除面广,逐条 grep 确认零引用再删,避免 RBAC catalog spec 测试挂。

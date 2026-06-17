# Legacy Cleanup (T1 + T2-A + T2-B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`).

**Goal:** 删除 admin 的 legacy 死代码三簇 —— T1(纯死前端页+残留)、T2-A(reimbursement-obligations 整模块)、T2-B(config-release 整簇连表全删 + regulatory-gates 反向解 FK),零 live 行为回归。

**Architecture:** 删除-by-symbol:每删一个页/模块,grep 其符号全仓 → 移除所有引用(import/route/RBAC/permission)→ 验证 `rg <symbol>` = 0 → build。Prisma model/列删除放**最后**(等所有代码引用清干净再 drop,避免编译断)。

**Tech Stack:** NestJS(`src/`)+ Prisma(SQLite)+ React admin(`admin-web/src/`)+ scripts。验证 = `tsc -b` + `npm run build` + `rg` 零残留 + `prisma validate`/`dev:rebuild` + 回归 sim + `/admin` 渲染。

**Spec:** `doc-final/superpowers/specs/2026-06-17-legacy-cleanup-frontend-to-backend-design.md`

---

## ⛔ KEEP 护栏(禁止删 —— 每个 Task 开工前默念)

| 禁删 | 与谁易混 |
|---|---|
| `OutstandingsService`/`Controller`/`Module`(`reconciliation/outstandings`,**无** `-settlements`) | vs 删 `OutstandingSettlement*`(带 `-settlements`) |
| `ReconciliationResourcePage`/`ReconciliationResourceDetailPage` + `wave8OpsConfig.ts`(safeguarding warnings/runs/fiat 条目) | vs 删 `TreasuryResourcePage`(fee-occurrences/reimbursement) |
| `FeeAccrualList`/`Detail`(`funds/fee-accruals`,菜单页) | vs 删 `fee-occurrences`(TreasuryResource) |
| `AuditEvidencePackage` 后端 + `EvidenceExportsPage`(`audit/evidence-packages`,菜单页) | vs 删 `CaseEvidenceExports*`(compliance case 证据) |
| T3 全部:`CddResponsesPage`/`EddResponsesPage`/`TransactionKyt*`/`TransactionTravelRule*`/`TransactionCompliance*`/`RiskPolicyExecutionsPage` + 其后端 service | 本轮**不删** |
| T4 全部:`InternalTransactionList`/`Detail` + `internal-transactions`/`internal-funds`/`internal-transaction-workflow` 模块 | 本轮**不删** |
| `RegulatoryGate*` 页 + service(只解除其对 release 的引用,**模块保留**) | 仅删 businessConfigRelease 耦合 |
| `ComplianceSession.caseId`(onboarding 字段) | vs 删 `SwapTransaction.alertId/caseId` |

---

### Task 1: 删 T1 + T2-B 死前端页 + 路由/imports

**Files (admin-web/src/pages/ — 删文件):**
- T1: `ComplianceAlertsPage.tsx` `ComplianceAlertDetailPage.tsx` `ComplianceCasesPage.tsx` `ComplianceCaseDetailPage.tsx` `CaseEvidenceExportsPage.tsx` `CaseEvidenceExportDetailPage.tsx` `OutstandingSettlementList.tsx` `OutstandingSettlementDetail.tsx` `PoolSettlementBatchListPage.tsx` `PoolSettlementBatchDetailPage.tsx` `InternalCollectionsPage.tsx` `TreasuryResourcePage.tsx` `TreasuryResourceDetailPage.tsx`
- T2-B: `PricingPolicyList.tsx` `PricingPolicyHistory.tsx`(确认确切文件名)`PricingWithdrawalConfigPage.tsx` `BusinessConfigReleasesPage.tsx`
- Modify: `admin-web/src/App.tsx`(删对应 lazy import + `<Route>`)、`admin-web/src/pages/wave8OpsConfig.ts`(**仅删** fee-occurrences + reimbursement-obligations 条目,**保留** safeguarding warnings/runs/fiat-statements)

- [ ] **Step 1: 删除上述页面文件**

```bash
cd admin-web/src/pages
rm ComplianceAlertsPage.tsx ComplianceAlertDetailPage.tsx ComplianceCasesPage.tsx ComplianceCaseDetailPage.tsx \
   CaseEvidenceExportsPage.tsx CaseEvidenceExportDetailPage.tsx \
   OutstandingSettlementList.tsx OutstandingSettlementDetail.tsx \
   PoolSettlementBatchListPage.tsx PoolSettlementBatchDetailPage.tsx \
   InternalCollectionsPage.tsx TreasuryResourcePage.tsx TreasuryResourceDetailPage.tsx \
   PricingPolicyList.tsx PricingWithdrawalConfigPage.tsx BusinessConfigReleasesPage.tsx
# PricingPolicyHistory: 先确认文件名再 rm
rg -l "PricingPolicyHistory" .. | head
```

- [ ] **Step 2: 移除 App.tsx 的 lazy import + Route**

对每个被删组件名,在 `admin-web/src/App.tsx` 删除其 `const X = lazy(...)` 行 + 所有 `<Route ... element={...<X .../>...}>` 行。定位:
```bash
cd admin-web && for C in ComplianceAlertsPage ComplianceAlertDetailPage ComplianceCasesPage ComplianceCaseDetailPage CaseEvidenceExportsPage CaseEvidenceExportDetailPage OutstandingSettlementList OutstandingSettlementDetail PoolSettlementBatchListPage PoolSettlementBatchDetailPage InternalCollectionsPage TreasuryResourcePage TreasuryResourceDetailPage PricingPolicyList PricingPolicyHistory PricingWithdrawalConfigPage BusinessConfigReleasesPage; do echo "== $C =="; rg -n "$C" src/App.tsx; done
```
删除每个匹配行(import + route)。注意 `compliance/audit-logs` redirect 路由(`<Navigate to=...audit-logs>`)一并删。

- [ ] **Step 3: 验证零残留**

```bash
cd admin-web && for C in ComplianceAlertsPage ComplianceCasesPage CaseEvidenceExportsPage OutstandingSettlementList PoolSettlementBatchListPage InternalCollectionsPage TreasuryResourcePage PricingPolicyList PricingWithdrawalConfigPage BusinessConfigReleasesPage; do rg -l "$C" src/ && echo "RESIDUAL: $C"; done; echo done
```
Expected: 仅 `echo done`,无 `RESIDUAL`。

- [ ] **Step 4: 前端 build**

Run: `cd admin-web && npx tsc -b && npm run build`
Expected: 两个 exit 0。(若报 `wave8OpsConfig` 类型错 → 确认只删了 treasury 条目、保留 safeguarding。)

---

### Task 2: 删 T2-A `reimbursement-obligations` 后端模块

**Files:**
- Delete dir: `src/modules/asset-treasury/reimbursement-obligations/`
- Modify: `src/app.module.ts`(删 `ReimbursementObligationsModule` import + imports[] 条目)

- [ ] **Step 1: 确认零外部引用(护栏)**

```bash
cd "$(git rev-parse --show-toplevel)"
rg -n "ReimbursementObligationsService" src/ -g '!**/reimbursement-obligations/**'
```
Expected: 无输出(若有非自身模块引用 → 停,报告)。

- [ ] **Step 2: 删模块 + 解除注册**

```bash
rm -rf src/modules/asset-treasury/reimbursement-obligations
rg -n "ReimbursementObligationsModule" src/app.module.ts
```
删 `src/app.module.ts` 中 `ReimbursementObligationsModule` 的 import 行 + imports[] 数组里的条目。

- [ ] **Step 3: 验证 + 后端 build**

```bash
rg -l "ReimbursementObligationsModule|ReimbursementObligationsService|ReimbursementObligationsController" src/ && echo RESIDUAL || echo clean
npm run build
```
Expected: `clean` + build exit 0。(`ReimbursementObligation` prisma model 留到 Task 6。)

---

### Task 3: 删 T2-B config-release 后端 + 脚本

**Files:**
- Delete dir: `src/modules/governance/business-config/`
- Modify: `src/modules/governance/governance.module.ts`(删 `BusinessConfigModule`)
- Delete: `scripts/config-release-stage.ts` `scripts/config-release-validate.ts` `scripts/config-release-publish.ts` `scripts/config-release-publish-from-governance.ts`
- Modify: `package.json`(删 `config:release:stage/validate/publish` 三行)

- [ ] **Step 1: 确认 business-config 仅被自身 + 脚本引用(护栏)**

```bash
rg -n "BusinessConfigModule|BusinessConfigService" src/ -g '!**/business-config/**'
```
Expected: 仅 `governance.module.ts` 命中(import + imports[])。其它命中 → 停报告。

- [ ] **Step 2: 删后端模块 + 脚本 + package.json**

```bash
rm -rf src/modules/governance/business-config
rm scripts/config-release-stage.ts scripts/config-release-validate.ts scripts/config-release-publish.ts scripts/config-release-publish-from-governance.ts
rg -n "BusinessConfigModule" src/modules/governance/governance.module.ts
rg -n "config:release" package.json
```
删 `governance.module.ts` 的 `BusinessConfigModule` import + imports[] 条目;删 `package.json` 的 `config:release:stage/validate/publish` 三行。

- [ ] **Step 3: 验证(model 引用此时仍在 regulatory-gates → Task 4 处理)**

```bash
rg -l "business-config|BusinessConfigService|BusinessConfigController" src/ && echo CHECK || echo clean
```
Expected: 此时后端**不 build**(regulatory-gates 仍引用 `businessConfigRelease` model,Task 4 解);Task 4 后再 build。

---

### Task 4: T2-B regulatory-gates 反向解 FK(保留模块,去 release 耦合)

**Files:**
- Modify: `src/modules/governance/regulatory-gates/regulatory-gates.service.ts`(~18 处)
- Modify: `src/modules/governance/regulatory-gates/demo/wave8-gov02-demo.util.ts`(L25,94,100,151,153)
- Modify: regulatory-gates DTO(删 `businessConfigReleaseId` 字段,若有)

- [ ] **Step 1: 列出所有 release 引用点**

```bash
cd "$(git rev-parse --show-toplevel)"
rg -n "businessConfigRelease" src/modules/governance/regulatory-gates/
```

- [ ] **Step 2: 删除 service 中的 release 逻辑**

在 `regulatory-gates.service.ts` 删除:
- `businessConfigRelease: true` 的所有 include(L337,605,687,740,807,866,939,1008)
- map 投影里 `businessConfigRelease`/`businessConfigReleaseId` 字段(L267,306-311,588)
- `businessConfigReleaseId: null` 赋值(L400,434,482)
- LICENSE_SCOPE_CHANGE 分支里 `requiredString(dto.businessConfigReleaseId...)` + `db.businessConfigRelease.findUnique` + 抛错 + `businessConfigReleaseId: release.id` bind(L440-458)→ 该 gate 创建路径不再需要/绑定 release(subtype 简化:不写 businessConfigReleaseId)
- `demo/wave8-gov02-demo.util.ts`:删 `businessConfigRelease` delegate 字段 + teardown 调用(L25,94,100,151,153)
- DTO:删 `businessConfigReleaseId` 字段(若 DTO 有)

- [ ] **Step 3: 验证零 release 引用 + 后端 build**

```bash
rg -n "businessConfigRelease|BusinessConfigRelease" src/ -g '!**/business-config/**'
```
Expected: 仅剩 `prisma/schema.prisma` 的 model 定义 + `RegulatoryGateItem.businessConfigReleaseId` 字段(Task 6 删)。`src/` 代码零引用。
```bash
npm run build
```
Expected: exit 0(business-config 模块已删 + regulatory-gates 解耦完成)。

---

### Task 5: 删 T1 RBAC catalog + 前端 permissions + audit 死分支

**Files:**
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`
- Modify: `admin-web/src/rbac/permissions.ts`
- Modify: `src/modules/audit-logging/audit-logs.service.ts`

- [ ] **Step 1: RBAC catalog 删 alerts/cases/case-evidence**

`rbac.catalog.ts` 删除:
- `route('...','/admin/compliance/alerts'...)` 5 条(~L272-276)
- `route('...','/admin/compliance/cases'...)` 11 条(~L277-338)
- `route('...','/admin/compliance/cases/...evidence-package(s)'...)` 4 条(~L339-362)
- `PermissionGroup` union 成员 `ALERT_READ|ALERT_WRITE|CASE_READ|CASE_WRITE|CASE_EXPORT_READ|CASE_EXPORT_WRITE`(~L30-35)
- 4 个角色 binding 里这些 group(~L1060-63,1134-41,1165-72,1207-09)
- reimbursement 路由(~L453,459,465)+ config-release/pricing-policies 相关路由(grep `business-config`/`pricing/policies`/`pool-settlement`/`fee-occurrences`/`outstanding-settlements` in rbac.catalog 一并删死路由)

定位:`rg -n "compliance/alerts|compliance/cases|reimbursement|business-config|pricing/policies|pool-settlement|fee-occurrences|outstanding-settlements|ALERT_READ|CASE_READ|CASE_EXPORT" src/modules/identity/access-control/rbac.catalog.ts`

- [ ] **Step 2: 前端 permissions.ts 删对应常量**

`admin-web/src/rbac/permissions.ts` 删 `ALERTS_*`/`CASES_*`/`CASE_*MLRO*`/`CASE_EVIDENCE_*`(~L64-77)、`OUTSTANDING_SETTLEMENT*`(~L30-32)、`REIMBURSEMENT_OBLIGATION*`、`PRICING_POLICIES_*`/`PRICING_WITHDRAW_CONFIG_*`/`POOL_SETTLEMENT_BATCH*`/`FEE_OCCURRENCE*`。定位:`rg -n "ALERTS_|CASES_|CASE_EVIDENCE|OUTSTANDING_SETTLEMENT|REIMBURSEMENT_OBLIGATION|PRICING_POLICIES|PRICING_WITHDRAW_CONFIG|POOL_SETTLEMENT|FEE_OCCURRENCE" admin-web/src/rbac/permissions.ts`

- [ ] **Step 3: 删 audit-logs.service 死 enrichment 分支**

`src/modules/audit-logging/audit-logs.service.ts` 删 `db.complianceAlert?.findMany` 与 `db.complianceIncident?.findMany` 三组分支。定位:`rg -n "complianceAlert|complianceIncident" src/modules/audit-logging/audit-logs.service.ts` → 删每处的 optional-chain enrichment 块(确保删后函数语法完整)。

- [ ] **Step 4: 验证 + build(含 rbac.catalog.spec)**

```bash
rg -n "ALERT_READ|CASE_READ|CASE_EXPORT|complianceAlert|complianceIncident|REIMBURSEMENT_OBLIGATION" src/ admin-web/src/ | rg -v "\.spec\."
npm run build && cd admin-web && npx tsc -b && npm run build && cd ..
npm test -- rbac.catalog 2>&1 | tail -20
```
Expected: 零残留(spec 除外);build exit 0;rbac.catalog 测试通过(若 spec 断言删掉的路由 → 同步改 spec)。

---

### Task 6: Prisma migration —— drop models + columns(最后做)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: 新 migration(`prisma migrate dev`)

- [ ] **Step 1: 确认 model 无残留 relation(护栏)**

```bash
cd "$(git rev-parse --show-toplevel)"
rg -n "ReimbursementObligation|reimbursementObligation" prisma/schema.prisma   # 找它在别的 model 上的 relation 字段
rg -n "businessConfigRelease|businessConfigReleaseId|BusinessConfigRelease|BusinessConfigRevision|BusinessConfigReleaseItem|PricingPolicy|pricingPolicy" prisma/schema.prisma
```

- [ ] **Step 2: 编辑 schema.prisma**

删除 model:`PricingPolicy`、`BusinessConfigRevision`、`BusinessConfigReleaseItem`、`BusinessConfigRelease`、`ReimbursementObligation`。
删除列/relation:
- `SwapTransaction.alertId`、`SwapTransaction.caseId`(~L1681-82)
- `RegulatoryGateItem.businessConfigReleaseId` 字段 + `businessConfigRelease` relation(~L12,39)
- 任何 model 上指向被删 model 的反向 relation 字段(如 `Wallet` 上的 reimbursement relation、`RegulatoryGateItem` 上的 release relation)——Step 1 grep 结果逐条清。

- [ ] **Step 3: 生成 migration + 验证**

```bash
npx prisma validate
npx prisma generate
npm run dev:rebuild   # 在 branch DB 上重建,验证 migration 不破坏
```
Expected: validate OK;dev:rebuild 成功无报错。

- [ ] **Step 4: 后端 + 前端 build(prisma client 变了)**

Run: `npm run build && cd admin-web && npx tsc -b && npm run build && cd ..`
Expected: exit 0(确认删列后无遗漏引用)。

---

### Task 7: 最终验证 + 行为不回归 sim + 渲染

- [ ] **Step 1: 全量 build**

```bash
npm run build && cd admin-web && npx tsc -b && npm run build && cd ..
```
Expected: 全 exit 0。

- [ ] **Step 2: 全局零残留终检**

```bash
rg -rn "business-config|BusinessConfigService|ReimbursementObligationsService|ComplianceAlertsPage|ComplianceCasesPage|OutstandingSettlementList|PoolSettlementBatchListPage|TreasuryResourcePage|config-release" src/ admin-web/src/ scripts/ | rg -v "\.spec\.|node_modules"
```
Expected: 无输出(或仅注释/spec)。

- [ ] **Step 3: 行为不回归 sim(关键 —— 证明 T3/T4 live 链没被波及)**

```bash
npm run dev:start   # 若未起
npx ts-node scripts/verify-two-book.ts 2>&1 | tail -30   # 或现有充值→兑换→提现→EOD sim
```
Expected: sim PASS(合规/结算/记账链正常),证明删 config-release/reimbursement 没碰到 deposit/withdraw/swap/onboarding/risk 的 live 路径。

- [ ] **Step 4: 渲染 `/admin`(用户标准)**

preview 登录 `http://localhost:3501/admin`,确认:14 组菜单页全部正常渲染(尤其 Regulatory Gates 页 —— 解 FK 后仍正常)、Reconciliation 的 safeguarding 子页正常(未被 TreasuryResource 删除波及)。截图侧边栏 + Regulatory Gates + Reconciliation 页。

---

## 完成标准

- 后端 `npm run build` + 前端 `tsc -b`+`build` 全 0;`prisma validate` + `dev:rebuild` 通过。
- 删除符号全仓零残留(spec/注释除外)。
- 回归 sim PASS(T3/T4 live 链未受影响)。
- `/admin` 14 组渲染正常 + Regulatory Gates/Reconciliation 页正常(截图为证)。
- KEEP 护栏清单中所有项**未被改动**。

> 提交:按 standing rule 全程不 commit/不推;交付以验证 + 截图收口。

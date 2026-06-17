# Admin IA & Route-Domain Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 admin-web 侧边栏 14 个菜单组的所有页面，从 4 个旧路由根(`/dashboard` `/exchange` `/funds-layer` `/ledger`)收敛到单一根 `/admin/<domain>/<resource>`，菜单分组同步重构。

**Architecture:** 仅前端。先**双路由**(新 `/admin/*` 与旧路径并存)让 app 全程可用，再切菜单、切内部跳转，最后删旧路由。auth 页 `/admin/login|activate|mfa-binding|reset-password` 冻结；后端/RBAC 权限码不动；非侧边栏 legacy 页不碰。

**Tech Stack:** React + react-router-dom v6 + Vite + TS。验证用 `tsc -b` + `vite build` + grep + preview 渲染(branch 栈：admin 3501 / api 3500)。

**权威映射：** 完整旧→新路由见 spec `doc-final/superpowers/specs/2026-06-17-admin-ia-route-domain-redesign-design.md` §4；资源重命名见 §5。

**说明：** 本 codebase 路由无单元测试，验证 = tsc + build + grep-zero-residual + 渲染截图。提交按项目 standing rule **延迟**(不每任务 commit、不推 remote)；每任务以验证 gate 收口。

---

### Task 1: App.tsx — 新增 `/admin` 路由组(双路由，旧路径保留)

**Files:**
- Modify: `admin-web/src/App.tsx`(在 `<Routes>` 内、现有 `RequireAuthenticated+DashboardLayout` wrapper 下，旧 4 组之后新增 `/admin` 组)

- [ ] **Step 1: 在 wrapper 内新增 `<Route path="/admin">` 组，复用现有 lazy 组件，按 spec §4 新路径登记全部菜单页**

在 `admin-web/src/App.tsx` 中，紧接现有 `<Route path="/ledger">…</Route>`(约 L954)之后、`</Route>`(wrapper 闭合 L956)之前，插入新组。**复用文件顶部已 import 的 lazy 组件**(如 `PlatformMembers`、`DepositTransactionList` 等)，路径用新 `/admin/<domain>/<resource>`：

```tsx
<Route path="/admin">
  <Route index element={withPermission(<Wave8OpsDashboardPage />, [PERMISSIONS.BASE_ACCESS])} />

  {/* iam */}
  <Route path="iam/members" element={withPermission(<PlatformMembers />, [PERMISSIONS.USERS_READ])} />
  <Route path="iam/members/:id" element={withPermission(<MemberDetail />, [PERMISSIONS.USERS_READ])} />
  <Route path="iam/roles" element={withPermission(<RoleManagement />, [PERMISSIONS.IAM_ROLES_READ])} />
  <Route path="iam/roles/:code" element={withPermission(<RoleDetail />, [PERMISSIONS.IAM_ROLES_READ])} />

  {/* customers */}
  <Route path="customers" element={withPermission(<CustomerManagement />, [PERMISSIONS.CUSTOMERS_READ])} />
  <Route path="customers/:id" element={withPermission(<CustomerDetail />, [PERMISSIONS.CUSTOMERS_READ])} />
  <Route path="customers/material-holdings" element={withPermission(<MaterialHoldingsPage />, [PERMISSIONS.CUSTOMERS_READ])} />
  <Route path="customers/material-holdings/:holdingId" element={withPermission(<MaterialHoldingDetailPage />, [PERMISSIONS.CUSTOMERS_READ])} />
  <Route path="customers/refresh-cycles" element={withPermission(<RefreshCyclesPage />, [PERMISSIONS.CUSTOMERS_READ])} />
  <Route path="customers/refresh-cycles/:cycleId" element={withPermission(<RefreshCycleDetailPage />, [PERMISSIONS.CUSTOMERS_READ])} />

  {/* compliance */}
  <Route path="compliance/sumsub-events" element={withPermission(<SumsubEventsPage />, [PERMISSIONS.SUMSUB_EVENTS_READ])} />
  <Route path="compliance/risk-assessments" element={withPermission(<RiskAssessmentListPage />, [PERMISSIONS.RISK_ASSESSMENTS_READ])} />
  <Route path="compliance/risk-assessments/:assessmentId" element={withPermission(<RiskAssessmentDetailPage />, [PERMISSIONS.RISK_ASSESSMENTS_READ])} />

  {/* trading */}
  <Route path="trading/deposits" element={withPermission(<DepositTransactionList />, [PERMISSIONS.DEPOSIT_TRANSACTIONS_READ])} />
  <Route path="trading/deposits/:id" element={withPermission(<DepositTransactionDetail />, [PERMISSIONS.DEPOSIT_TRANSACTION_DETAIL_READ])} />
  <Route path="trading/withdrawals" element={withPermission(<WithdrawTransactionList />, [PERMISSIONS.WITHDRAW_TRANSACTIONS_READ])} />
  <Route path="trading/withdrawals/:id" element={withPermission(<WithdrawTransactionDetail />, [PERMISSIONS.WITHDRAW_TRANSACTION_DETAIL_READ])} />
  <Route path="trading/swaps" element={withPermission(<SwapTransactionList />, [PERMISSIONS.SWAP_TRANSACTIONS_READ])} />
  <Route path="trading/swaps/:id" element={withPermission(<SwapTransactionDetail />, [PERMISSIONS.SWAP_TRANSACTION_DETAIL_READ])} />
  <Route path="trading/payins" element={withPermission(<PayinList />, [PERMISSIONS.PAYINS_READ])} />
  <Route path="trading/payins/:id" element={withPermission(<PayinDetail />, [PERMISSIONS.PAYIN_DETAIL_READ])} />
  <Route path="trading/payouts" element={withPermission(<PayoutList />, [PERMISSIONS.PAYOUTS_READ])} />
  <Route path="trading/payouts/:id" element={withPermission(<PayoutDetail />, [PERMISSIONS.PAYOUT_DETAIL_READ])} />
  <Route path="trading/withdraw-quotes" element={withPermission(<WithdrawQuoteList />, [PERMISSIONS.WITHDRAW_QUOTES_READ])} />
  <Route path="trading/withdraw-quotes/:id" element={withPermission(<WithdrawQuoteDetail />, [PERMISSIONS.WITHDRAW_QUOTE_DETAIL_READ])} />
  <Route path="trading/swap-quotes" element={withPermission(<SwapQuoteList />, [PERMISSIONS.SWAP_QUOTES_READ])} />
  <Route path="trading/swap-quotes/:id" element={withPermission(<SwapQuoteDetail />, [PERMISSIONS.SWAP_QUOTE_DETAIL_READ])} />

  {/* funds */}
  <Route path="funds/transfers" element={withPermission(<InternalTransferListPage />, [PERMISSIONS.FUNDS_LAYER_TRANSFERS_READ])} />
  <Route path="funds/transfers/:internalTxNo" element={withPermission(<InternalTransferDetailPage />, [PERMISSIONS.FUNDS_LAYER_TRANSFER_DETAIL_READ])} />
  <Route path="funds/internal-funds" element={withPermission(<InternalFundListPage />, [PERMISSIONS.FUNDS_LAYER_FUNDS_READ])} />
  <Route path="funds/internal-funds/:internalFundNo" element={withPermission(<InternalFundDetailPage />, [PERMISSIONS.FUNDS_LAYER_FUND_DETAIL_READ])} />
  <Route path="funds/settlements" element={withPermission(<SettlementListPage />, [PERMISSIONS.FUNDS_LAYER_SETTLEMENTS_READ])} />
  <Route path="funds/settlements/:batchNo" element={withPermission(<SettlementDetailPage />, [PERMISSIONS.FUNDS_LAYER_SETTLEMENT_DETAIL_READ])} />
  <Route path="funds/outstandings" element={withPermission(<OutstandingList />, [PERMISSIONS.OUTSTANDINGS_READ])} />
  <Route path="funds/outstandings/:id" element={withPermission(<OutstandingDetail />, [PERMISSIONS.OUTSTANDING_DETAIL_READ])} />
  <Route path="funds/fee-accruals" element={withPermission(<FeeAccrualList />, [PERMISSIONS.FEE_ACCRUALS_READ])} />
  <Route path="funds/fee-accruals/:id" element={withPermission(<FeeAccrualDetail />, [PERMISSIONS.FEE_ACCRUAL_DETAIL_READ])} />

  {/* custody */}
  <Route path="custody/wallets" element={withPermission(<CustodianWalletList />, [PERMISSIONS.WALLETS_READ])} />
  <Route path="custody/wallets/:id" element={withPermission(<CustodianWalletDetail />, [PERMISSIONS.WALLETS_READ])} />
  <Route path="custody/withdrawal-addresses" element={withPermission(<WithdrawalAddressList />, [PERMISSIONS.BASE_ACCESS])} />
  <Route path="custody/withdrawal-addresses/:addressNo" element={withPermission(<WithdrawalAddressDetail />, [PERMISSIONS.BASE_ACCESS])} />

  {/* assets */}
  <Route path="assets" element={withPermission(<AssetList />, [PERMISSIONS.ASSETS_READ])} />
  <Route path="assets/create" element={withPermission(<AssetCreate />, [PERMISSIONS.ASSETS_CREATE])} />
  <Route path="assets/:assetNo" element={withPermission(<AssetDetail />, [PERMISSIONS.ASSETS_READ])} />
  <Route path="assets/:assetNo/edit" element={withPermission(<AssetEdit />, [PERMISSIONS.ASSETS_UPDATE])} />
  <Route path="assets/transaction-limits" element={withPermission(<TransactionLimitList />, [PERMISSIONS.TRANSACTION_LIMIT_POLICIES_READ])} />
  <Route path="assets/transaction-limits/:policyNo" element={withPermission(<TransactionLimitDetail />, [PERMISSIONS.TRANSACTION_LIMIT_POLICIES_READ])} />

  {/* pricing */}
  <Route path="pricing/withdrawal-fee-levels" element={withPermission(<WithdrawalFeeLevelList />, [PERMISSIONS.WITHDRAWAL_FEE_LEVELS_READ])} />
  <Route path="pricing/withdrawal-fee-levels/:levelCode" element={withPermission(<WithdrawalFeeLevelDetail />, [PERMISSIONS.WITHDRAWAL_FEE_LEVELS_READ])} />
  <Route path="pricing/swap-fee-levels" element={withPermission(<SwapFeeLevelList />, [PERMISSIONS.SWAP_FEE_LEVELS_READ])} />
  <Route path="pricing/swap-fee-levels/:levelCode" element={withPermission(<SwapFeeLevelDetail />, [PERMISSIONS.SWAP_FEE_LEVELS_READ])} />

  {/* reconciliation */}
  <Route path="reconciliation/safeguarding-breaks" element={withPermission(<SafeguardingBreakList />, [PERMISSIONS.SAFEGUARDING_BREAKS_READ])} />
  <Route path="reconciliation/safeguarding-breaks/:id" element={withPermission(<SafeguardingBreakDetail />, [PERMISSIONS.SAFEGUARDING_BREAKS_READ])} />
  <Route path="reconciliation/safeguarding-warnings" element={withPermission(<SafeguardingWarningList />, [PERMISSIONS.SAFEGUARDING_WARNINGS_READ])} />
  <Route path="reconciliation/safeguarding-warnings/:id" element={withPermission(<SafeguardingWarningDetail />, [PERMISSIONS.SAFEGUARDING_WARNINGS_READ])} />
  <Route path="reconciliation/safeguarding-runs" element={withPermission(<SafeguardingRunList />, [PERMISSIONS.SAFEGUARDING_RUNS_READ])} />
  <Route path="reconciliation/safeguarding-runs/:id" element={withPermission(<SafeguardingRunDetail />, [PERMISSIONS.SAFEGUARDING_RUNS_READ])} />
  <Route path="reconciliation/safeguarding-fiat-statements" element={withPermission(<FiatStatementImportList />, [PERMISSIONS.SAFEGUARDING_FIAT_IMPORTS_READ])} />
  <Route path="reconciliation/safeguarding-fiat-statements/:id" element={withPermission(<FiatStatementImportDetail />, [PERMISSIONS.SAFEGUARDING_FIAT_IMPORTS_READ])} />

  {/* ledger */}
  <Route path="ledger/accounts" element={withPermission(<LedgerAccountList />, [PERMISSIONS.TB_ACCOUNTS_READ])} />
  <Route path="ledger/accounts/:id" element={withPermission(<LedgerAccountDetail />, [PERMISSIONS.TB_ACCOUNTS_READ])} />
  <Route path="ledger/transfer-evidence" element={withPermission(<TransferEvidenceList />, [PERMISSIONS.TB_TRANSFERS_READ])} />
  <Route path="ledger/transfer-evidence/:tbTransferId" element={withPermission(<TransferEvidenceDetail />, [PERMISSIONS.TB_TRANSFER_DETAIL_READ])} />
  <Route path="ledger/account-statement" element={withPermission(<AccountStatementPage />, [PERMISSIONS.TB_ACCOUNTS_READ])} />

  {/* governance */}
  <Route path="governance/approvals" element={withPermission(<ApprovalList />, [PERMISSIONS.GOV_APPROVALS_READ])} />
  <Route path="governance/approvals/:id" element={withPermission(<ApprovalDetail />, [PERMISSIONS.GOV_APPROVALS_READ])} />
  <Route path="governance/approval-policies" element={withPermission(<ApprovalPolicyPage />, [PERMISSIONS.GOV_APPROVAL_POLICIES_READ])} />

  {/* audit */}
  <Route path="audit/logs" element={withPermission(<AuditLogPage />, [PERMISSIONS.AUDIT_LOGS_READ])} />
  <Route path="audit/logs/:id" element={withPermission(<AuditLogDetailPage />, [PERMISSIONS.AUDIT_LOGS_READ])} />
  <Route path="audit/evidence-packages" element={withPermission(<EvidenceExportsPage />, [PERMISSIONS.AUDIT_EVIDENCE_EXPORTS_READ])} />
  <Route path="audit/evidence-packages/:id" element={withPermission(<EvidenceExportDetailPage />, [PERMISSIONS.AUDIT_EVIDENCE_EXPORTS_READ])} />

  {/* registries (route-align only) */}
  <Route path="registries/shareholding-versions" element={…} />  {/* 等 6 项，按旧 governance/registries/* 逐一平移，组件/permission 不变 */}
  …(appointments / trainings / conflicts / wind-down-materials + 各自 create/edit/:id；regulatory-gates + create/:id)…

  {/* counterparty (route-align only) */}
  <Route path="counterparty/liquidity-providers" element={…} />
  …(liquidity-providers/create；liquidity-config + create/edit/:id)…
</Route>
```

> ⚠️ 组件名以 App.tsx 顶部**实际 lazy import 名为准**(上面用了推断名，执行时核对真名，不要新建组件)。registries/counterparty 两组逐条照搬旧 `<Route>` 的 element/permission，只改 `path` 去掉 `governance/`/`system/` 前缀。`/admin` index 暂用 `Wave8OpsDashboardPage`(spec §8)。

- [ ] **Step 2: tsc 验证(组件名/类型对得上)**

Run: `cd admin-web && npx tsc -b`
Expected: exit 0(若报 "Cannot find name <X>"，说明组件名猜错，回 Step 1 用真名修正)

- [ ] **Step 3: build 验证**

Run: `cd admin-web && npm run build`
Expected: exit 0

- [ ] **Step 4: 渲染抽验新路径可达**

确保 branch 栈在跑(`lsof -ti:3500,3501`)。preview 浏览器登录 `http://localhost:3501/admin/login`(admin@fiatx.com / 123456)→ 手动访问 `http://localhost:3501/admin/iam/members`、`/admin/funds/transfers`、`/admin/trading/deposits`，确认页面正常渲染(旧路径此时仍可用)。

---

### Task 2: DashboardLayout — 重写 menuItems(14 新组 + 新路径)+ 修 isPathActive

**Files:**
- Modify: `admin-web/src/components/DashboardLayout.tsx`(menuItems 数组 L100-475；isPathActive L54-62)

- [ ] **Step 1: 用下面整段替换 `menuItems` 数组(L100 起至闭合 `];`)**

```tsx
  const menuItems: MenuItem[] = [
    { path: '/admin', icon: <LayoutDashboard size={14} />, label: 'Overview', requiredPermissions: [PERMISSIONS.BASE_ACCESS] },
    { label: 'Identity & Access', icon: <UserCog size={12} />, children: [
      { path: '/admin/iam/members', label: 'Platform Members', icon: <UserCheck size={13} />, requiredPermissions: [PERMISSIONS.USERS_READ] },
      { path: '/admin/iam/roles', label: 'Role Management', icon: <ShieldCheck size={13} />, requiredPermissions: [PERMISSIONS.IAM_ROLES_READ] },
    ]},
    { label: 'Customers', icon: <Users size={12} />, children: [
      { path: '/admin/customers', label: 'Customer Management', icon: <Users size={13} />, requiredPermissions: [PERMISSIONS.CUSTOMERS_READ] },
      { path: '/admin/customers/material-holdings', label: 'Material Holdings', icon: <FileText size={13} />, requiredPermissions: [PERMISSIONS.CUSTOMERS_READ] },
      { path: '/admin/customers/refresh-cycles', label: 'Refresh Cycles', icon: <History size={13} />, requiredPermissions: [PERMISSIONS.CUSTOMERS_READ] },
    ]},
    { label: 'Compliance', icon: <ClipboardList size={12} />, children: [
      { path: '/admin/compliance/sumsub-events', label: 'Sumsub Events', icon: <Zap size={13} />, requiredPermissions: [PERMISSIONS.SUMSUB_EVENTS_READ] },
      { path: '/admin/compliance/risk-assessments', label: 'Risk Assessments', icon: <Shield size={13} />, requiredPermissions: [PERMISSIONS.RISK_ASSESSMENTS_READ] },
    ]},
    { label: 'Trading', icon: <ArrowLeftRight size={12} />, children: [
      { path: '/admin/trading/deposits', label: 'Deposit Transactions', icon: <Download size={13} />, requiredPermissions: [PERMISSIONS.DEPOSIT_TRANSACTIONS_READ] },
      { path: '/admin/trading/withdrawals', label: 'Withdraw Transactions', icon: <Upload size={13} />, requiredPermissions: [PERMISSIONS.WITHDRAW_TRANSACTIONS_READ] },
      { path: '/admin/trading/swaps', label: 'Swap Transactions', icon: <Repeat size={13} />, requiredPermissions: [PERMISSIONS.SWAP_TRANSACTIONS_READ] },
      { path: '/admin/trading/payins', label: 'Payin Records', icon: <LogIn size={13} />, requiredPermissions: [PERMISSIONS.PAYINS_READ] },
      { path: '/admin/trading/payouts', label: 'Payout Records', icon: <LogOut size={13} />, requiredPermissions: [PERMISSIONS.PAYOUTS_READ] },
      { path: '/admin/trading/withdraw-quotes', label: 'Withdraw Quotes', icon: <FileText size={13} />, requiredPermissions: [PERMISSIONS.WITHDRAW_QUOTES_READ] },
      { path: '/admin/trading/swap-quotes', label: 'Swap Quotes', icon: <FileText size={13} />, requiredPermissions: [PERMISSIONS.SWAP_QUOTES_READ] },
    ]},
    { label: 'Funds & Settlement', icon: <Layers size={12} />, children: [
      { path: '/admin/funds/transfers', label: 'Internal Transfers', icon: <Repeat size={13} />, requiredPermissions: [PERMISSIONS.FUNDS_LAYER_TRANSFERS_READ] },
      { path: '/admin/funds/internal-funds', label: 'Internal Funds', icon: <Activity size={13} />, requiredPermissions: [PERMISSIONS.FUNDS_LAYER_FUNDS_READ] },
      { path: '/admin/funds/settlements', label: 'Settlement Batches', icon: <Layers size={13} />, requiredPermissions: [PERMISSIONS.FUNDS_LAYER_SETTLEMENTS_READ] },
      { path: '/admin/funds/outstandings', label: 'Swap Outstandings', icon: <ClipboardList size={13} />, requiredPermissions: [PERMISSIONS.OUTSTANDINGS_READ] },
      { path: '/admin/funds/fee-accruals', label: 'Fee Accruals', icon: <ClipboardList size={13} />, requiredPermissions: [PERMISSIONS.FEE_ACCRUALS_READ] },
    ]},
    { label: 'Custody', icon: <Briefcase size={12} />, children: [
      { path: '/admin/custody/wallets', label: 'Custodian Wallets', icon: <Wallet size={13} />, requiredPermissions: [PERMISSIONS.WALLETS_READ] },
      { path: '/admin/custody/withdrawal-addresses', label: 'Withdrawal Addresses', icon: <Upload size={13} />, requiredPermissions: [PERMISSIONS.BASE_ACCESS] },
    ]},
    { label: 'Assets & Limits', icon: <Coins size={12} />, children: [
      { path: '/admin/assets', label: 'Assets', icon: <Coins size={13} />, requiredPermissions: [PERMISSIONS.ASSETS_READ] },
      { path: '/admin/assets/transaction-limits', label: 'Transaction Limits', icon: <Gauge size={13} />, requiredPermissions: [PERMISSIONS.TRANSACTION_LIMIT_POLICIES_READ] },
    ]},
    { label: 'Pricing', icon: <Coins size={12} />, children: [
      { path: '/admin/pricing/withdrawal-fee-levels', label: 'Withdrawal Fee Levels', icon: <Layers size={13} />, requiredPermissions: [PERMISSIONS.WITHDRAWAL_FEE_LEVELS_READ] },
      { path: '/admin/pricing/swap-fee-levels', label: 'Swap Fee Levels', icon: <Repeat size={13} />, requiredPermissions: [PERMISSIONS.SWAP_FEE_LEVELS_READ] },
    ]},
    { label: 'Reconciliation', icon: <Activity size={12} />, children: [
      { path: '/admin/reconciliation/safeguarding-breaks', label: 'Safeguarding Breaks', icon: <ClipboardList size={13} />, requiredPermissions: [PERMISSIONS.SAFEGUARDING_BREAKS_READ] },
      { path: '/admin/reconciliation/safeguarding-warnings', label: 'Safeguarding Warnings', icon: <AlertTriangle size={13} />, requiredPermissions: [PERMISSIONS.SAFEGUARDING_WARNINGS_READ] },
      { path: '/admin/reconciliation/safeguarding-runs', label: 'Safeguarding Runs', icon: <History size={13} />, requiredPermissions: [PERMISSIONS.SAFEGUARDING_RUNS_READ] },
      { path: '/admin/reconciliation/safeguarding-fiat-statements', label: 'Fiat Statement Imports', icon: <FileText size={13} />, requiredPermissions: [PERMISSIONS.SAFEGUARDING_FIAT_IMPORTS_READ] },
    ]},
    { label: 'Ledger', icon: <Library size={12} />, children: [
      { path: '/admin/ledger/accounts', label: 'Ledger Accounts', icon: <Database size={13} />, requiredPermissions: [PERMISSIONS.TB_ACCOUNTS_READ] },
      { path: '/admin/ledger/transfer-evidence', label: 'Transfer Evidence', icon: <Database size={13} />, requiredPermissions: [PERMISSIONS.TB_TRANSFERS_READ] },
      { path: '/admin/ledger/account-statement', label: 'Account Statement', icon: <Database size={13} />, requiredPermissions: [PERMISSIONS.TB_ACCOUNTS_READ] },
    ]},
    { label: 'Governance', icon: <ShieldCheck size={12} />, children: [
      { path: '/admin/governance/approvals', label: 'Approvals', icon: <Shield size={13} />, requiredPermissions: [PERMISSIONS.GOV_APPROVALS_READ] },
      { path: '/admin/governance/approval-policies', label: 'Approval Policies', icon: <Shield size={13} />, requiredPermissions: [PERMISSIONS.GOV_APPROVAL_POLICIES_READ] },
    ]},
    { label: 'Audit', icon: <FileText size={12} />, children: [
      { path: '/admin/audit/logs', label: 'Audit Log', icon: <FileText size={13} />, requiredPermissions: [PERMISSIONS.AUDIT_LOGS_READ] },
      { path: '/admin/audit/evidence-packages', label: 'Evidence Packages', icon: <Layers size={13} />, requiredPermissions: [PERMISSIONS.AUDIT_EVIDENCE_EXPORTS_READ] },
    ]},
    { label: 'Governance Registries', icon: <Library size={12} />, children: [
      { path: '/admin/registries/shareholding-versions', label: 'Shareholding Registry', icon: <Building2 size={13} />, requiredPermissions: [PERMISSIONS.GOV_SHAREHOLDING_REGISTRY_READ] },
      { path: '/admin/registries/appointments', label: 'Appointments', icon: <UserCheck size={13} />, requiredPermissions: [PERMISSIONS.GOV_APPOINTMENTS_READ] },
      { path: '/admin/registries/trainings', label: 'Trainings', icon: <ClipboardList size={13} />, requiredPermissions: [PERMISSIONS.GOV_TRAININGS_READ] },
      { path: '/admin/registries/conflicts', label: 'Conflicts', icon: <Shield size={13} />, requiredPermissions: [PERMISSIONS.GOV_CONFLICTS_READ] },
      { path: '/admin/registries/wind-down-materials', label: 'Wind-down Materials', icon: <FileText size={13} />, requiredPermissions: [PERMISSIONS.GOV_WIND_DOWN_MATERIALS_READ] },
      { path: '/admin/registries/regulatory-gates', label: 'Regulatory Gates', icon: <ShieldCheck size={13} />, requiredPermissions: [PERMISSIONS.GOV_REGULATORY_GATES_READ] },
    ]},
    { label: 'Counterparty', icon: <Handshake size={12} />, children: [
      { path: '/admin/counterparty/liquidity-providers', label: 'Liquidity Providers', icon: <Building2 size={13} />, requiredPermissions: [PERMISSIONS.LIQUIDITY_PROVIDERS_READ] },
      { path: '/admin/counterparty/liquidity-config', label: 'LP Liquidity Config', icon: <ShieldCheck size={13} />, requiredPermissions: [PERMISSIONS.LIQUIDITY_CONFIG_READ] },
    ]},
  ];
```

- [ ] **Step 2: 修 `isPathActive` 的特例(L54-62)**

把 `'/dashboard'` 改 `'/admin'`、`'/dashboard/members'` 改 `'/admin/iam/members'`：

```tsx
const isPathActive = (pathname: string, targetPath: string) => {
  if (targetPath === '/admin') {
    return pathname === '/admin' || pathname === '/admin/';
  }
  if (targetPath === '/admin/iam/members') {
    return pathname === targetPath;
  }
  return pathname === targetPath || pathname.startsWith(`${targetPath}/`);
};
```

- [ ] **Step 3: tsc + build**

Run: `cd admin-web && npx tsc -b && npm run build`
Expected: exit 0

- [ ] **Step 4: 渲染验证侧边栏(用户标准：截图)**

preview 登录后访问 `http://localhost:3501/admin`，截图侧边栏，核对：14 组、组名(Custody / Assets & Limits / Funds & Settlement 等)、点击每组首项路由解析成功(新 `/admin/*` 路由 Task 1 已存在)。

---

### Task 3: 内部跳转迁移 — 批次 A（trading + funds）

**Files:** 全 `admin-web/src`(`navigate()`/`<Link to>`/`<Navigate to>`/`to={\`...\`}`)

- [ ] **Step 1: 按下表逐对替换(nav 上下文)**

| 旧 | 新 |
|---|---|
| `/exchange/deposit-transactions` | `/admin/trading/deposits` |
| `/exchange/withdraw-transactions` | `/admin/trading/withdrawals` |
| `/exchange/swap-transactions` | `/admin/trading/swaps` |
| `/dashboard/treasury/payins` | `/admin/trading/payins` |
| `/dashboard/treasury/payouts` | `/admin/trading/payouts` |
| `/dashboard/pricing/withdraw-quotes` | `/admin/trading/withdraw-quotes` |
| `/dashboard/pricing/quotes` | `/admin/trading/swap-quotes` |
| `/funds-layer/transfers` | `/admin/funds/transfers` |
| `/funds-layer/funds` | `/admin/funds/internal-funds` |
| `/funds-layer/settlements` | `/admin/funds/settlements` |
| `/dashboard/reconciliation/outstandings` | `/admin/funds/outstandings` |
| `/dashboard/reconciliation/fee-accruals` | `/admin/funds/fee-accruals` |

定位命令：`rg -n "/exchange/|/funds-layer/|/dashboard/treasury/pay|/dashboard/pricing/quotes|/dashboard/pricing/withdraw-quotes|/dashboard/reconciliation/(outstandings|fee-accruals)" admin-web/src --glob '*.tsx' --glob '*.ts'`

- [ ] **Step 2: grep 验证该批旧路径在 nav 残留=0**

Run: `rg -n "/exchange/(deposit|withdraw|swap)-transactions|/funds-layer/(transfers|funds|settlements)" admin-web/src | rg "navigate\(|to=|Navigate to"`
Expected: 无输出(0 残留)

- [ ] **Step 3: tsc + build**

Run: `cd admin-web && npx tsc -b && npm run build`
Expected: exit 0

---

### Task 4: 内部跳转迁移 — 批次 B（custody + assets + pricing + ledger）

**Files:** 全 `admin-web/src`

- [ ] **Step 1: 逐对替换**

| 旧 | 新 |
|---|---|
| `/dashboard/treasury/custodian-wallets` | `/admin/custody/wallets` |
| `/dashboard/treasury/withdrawal-addresses` | `/admin/custody/withdrawal-addresses` |
| `/dashboard/system/assets` | `/admin/assets` |
| `/dashboard/system/transaction-limits` | `/admin/assets/transaction-limits` |
| `/dashboard/pricing/withdrawal-fee-levels` | `/admin/pricing/withdrawal-fee-levels` |
| `/dashboard/pricing/swap-fee-levels` | `/admin/pricing/swap-fee-levels` |
| `/ledger/accounts` | `/admin/ledger/accounts` |
| `/ledger/transfers` | `/admin/ledger/transfer-evidence` |
| `/ledger/account-statement` | `/admin/ledger/account-statement` |

> 注意 `/dashboard/pricing/quotes`/`withdraw-quotes` 已在批次 A 处理；本批只动 fee-levels。`/ledger/transfers` → `transfer-evidence`(改名)。

- [ ] **Step 2: grep 验证**

Run: `rg -n "/dashboard/treasury/(custodian-wallets|withdrawal-addresses)|/dashboard/system/(assets|transaction-limits)|/ledger/" admin-web/src | rg "navigate\(|to=|Navigate to"`
Expected: 无输出

- [ ] **Step 3: tsc + build** → exit 0

---

### Task 5: 内部跳转迁移 — 批次 C（iam + customers + compliance）

**Files:** 全 `admin-web/src`

- [ ] **Step 1: 逐对替换**

| 旧 | 新 |
|---|---|
| `/dashboard/members/roles` | `/admin/iam/roles` |
| `/dashboard/members` | `/admin/iam/members` |
| `/dashboard/customer/management` | `/admin/customers` |
| `/dashboard/customer/` (detail `/:id`) | `/admin/customers/` |
| `/dashboard/compliance/material-management` | `/admin/customers/material-holdings` |
| `/dashboard/compliance/refresh-cycles` | `/admin/customers/refresh-cycles` |
| `/dashboard/compliance/sumsub-events` | `/admin/compliance/sumsub-events` |
| `/dashboard/compliance/risk-assessments` | `/admin/compliance/risk-assessments` |

> ⚠️ 顺序：先替换更长的 `/dashboard/members/roles` 再替换 `/dashboard/members`，避免前缀误伤。`/dashboard/compliance/` 下只动 material-management/refresh-cycles/sumsub-events/risk-assessments 四项；**alerts/cases/cdd-responses/edd-responses/tx-* 是 legacy 不动**。

- [ ] **Step 2: grep 验证(只验已迁移项)**

Run: `rg -n "/dashboard/members|/dashboard/customer/|/dashboard/compliance/(material-management|refresh-cycles|sumsub-events|risk-assessments)" admin-web/src | rg "navigate\(|to=|Navigate to"`
Expected: 无输出

- [ ] **Step 3: tsc + build** → exit 0

---

### Task 6: 内部跳转迁移 — 批次 D（governance + audit + registries + counterparty + safeguarding）

**Files:** 全 `admin-web/src`

- [ ] **Step 1: 逐对替换**

| 旧 | 新 |
|---|---|
| `/dashboard/control-gates/approvals` | `/admin/governance/approvals` |
| `/dashboard/governance/approval-policies` | `/admin/governance/approval-policies` |
| `/dashboard/audit/audit-logs` | `/admin/audit/logs` |
| `/dashboard/audit/evidence-exports` | `/admin/audit/evidence-packages` |
| `/dashboard/governance/registries/` | `/admin/registries/` |
| `/dashboard/governance/regulatory-gates` | `/admin/registries/regulatory-gates` |
| `/dashboard/system/liquidity-providers` | `/admin/counterparty/liquidity-providers` |
| `/dashboard/system/liquidity-config` | `/admin/counterparty/liquidity-config` |
| `/dashboard/reconciliation/safeguarding-breaks` | `/admin/reconciliation/safeguarding-breaks` |
| `/dashboard/reconciliation/safeguarding-warnings` | `/admin/reconciliation/safeguarding-warnings` |
| `/dashboard/reconciliation/safeguarding-runs` | `/admin/reconciliation/safeguarding-runs` |
| `/dashboard/reconciliation/safeguarding-fiat-statements` | `/admin/reconciliation/safeguarding-fiat-statements` |

> `/dashboard/governance/` 下 **policy-change-requests 是隐藏 legacy，不动**；`/dashboard/control-gates/business-config-releases` 是 legacy，不动。

- [ ] **Step 2: grep 验证** → 无输出
- [ ] **Step 3: tsc + build** → exit 0

---

### Task 7: App.tsx — 删旧菜单路由 + 删空组 + 登录跳转

**Files:** Modify `admin-web/src/App.tsx`

- [ ] **Step 1: 删除已迁移的旧菜单页 `<Route>`**

- 删 `<Route path="/funds-layer">…</Route>` 整组(已全迁，空)。
- 删 `<Route path="/ledger">…</Route>` 整组(空)。
- `<Route path="/exchange">` 组内删 deposit/withdraw/swap-transactions(+:id)，**保留** `internal-transactions`(legacy)。
- `<Route path="/dashboard">` 组内删除所有已迁移菜单页 route(members/customer-management/compliance-的四项/treasury 的 wallets·addresses·payins·payouts/system 的 assets·transaction-limits·liquidity-*/pricing 的 fee-levels·quotes·withdraw-quotes/reconciliation 的 safeguarding-四项·outstandings·fee-accruals/audit/control-gates·governance 的 approvals·approval-policies·registries·regulatory-gates)。**保留** `/dashboard` index + 所有 legacy(alerts/cases/cdd-edd/tx-*/risk-policy-executions/Wave8 treasury 的 pool-settlement-batches·fee-occurrences·reimbursement-obligations·deposit-wallet-monitor·internal-collections/pricing 的 policies·withdraw-config/control-gates 的 business-config-releases/隐藏的 role-change-requests·policy-change-requests/compliance/audit-logs redirect)。

- [ ] **Step 2: 登录后跳转 `/dashboard` → `/admin`**

Run 定位: `rg -n "navigate\(['\"]/dashboard['\"]|to=['\"]/dashboard['\"]" admin-web/src`
把登录成功/默认跳转的 `/dashboard` 改成 `/admin`（典型在 LoginEntry / RequireAuthenticated / mfa 完成处）。`/` → `/admin/login` 与 `*` → `/` 不变。

- [ ] **Step 3: grep 全局验证已迁移旧路径零残留**

Run: `rg -n "/exchange/(deposit|withdraw|swap)|/funds-layer/|/ledger/(accounts|transfers|account-statement)|/dashboard/(members|customer/management|treasury/(custodian|withdrawal|payins|payouts)|system/(assets|transaction-limits|liquidity)|pricing/(withdrawal-fee|swap-fee|quotes|withdraw-quotes)|reconciliation/(safeguarding|outstandings|fee-accruals)|audit/|control-gates/approvals|governance/(approval-policies|registries|regulatory-gates))" admin-web/src/App.tsx`
Expected: 无输出(App.tsx 中这些已迁移路径只剩 `/admin/*` 形态)

- [ ] **Step 4: tsc + build** → exit 0

---

### Task 8: 最终验证 + 截图闭环

- [ ] **Step 1: 类型 + 构建**

Run: `cd admin-web && npx tsc -b && npm run build`
Expected: 两个都 exit 0

- [ ] **Step 2: 全局 nav 残留终检**

Run: `rg -rn "to=|navigate\(|Navigate to" admin-web/src --glob '*.tsx' | rg "/exchange/|/funds-layer/|/ledger/" ; rg -rn "to=|navigate\(" admin-web/src | rg "/dashboard/" | rg -v "alerts|cases|cdd-|edd-|tx-kyt|tx-travel|tx-evidence|risk/policy|pool-settlement|fee-occurrences|reimbursement|deposit-wallet-monitor|internal-collections|policies|withdraw-config|business-config|role-change-requests|policy-change-requests|audit-logs"`
Expected: 第一条无输出；第二条仅剩 legacy 页自身的内部链接(可接受)

- [ ] **Step 3: 渲染点测全部 14 组(用户标准)**

preview 登录 `/admin`，依次点开侧边栏 14 组每一项，确认 list 渲染、再点一行进 detail 渲染正常。重点抽验：trading/deposits→detail、funds/transfers→detail、custody/wallets→detail、assets→detail、governance/approvals→detail。截图侧边栏 + 4 个域页面。

- [ ] **Step 4: 旧路径回归确认**

访问保留的 legacy 路径(如 `http://localhost:3501/exchange/internal-transactions`)确认仍可达不报错；访问已删除的旧路径(如 `/funds-layer/transfers`)确认落到 `*` → `/admin/login`(不白屏崩溃)。

---

## 完成标准

- `tsc -b` + `npm run build` 双 0；
- 已迁移旧路径在 nav 零残留(legacy 路径除外)；
- 14 组侧边栏渲染 + 抽验 list/detail 跳转正常(截图为证)；
- legacy 页不受影响、旧菜单路径优雅兜底。

> 提交：按项目 standing rule 全程不 commit/不推；交付以验证截图收口，由用户决定最终提交时机。

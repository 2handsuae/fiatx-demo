import { lazy, Suspense, type ReactElement } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import AdminLogin from './pages/AdminLogin';
import AdminInviteActivate from './pages/AdminInviteActivate';
import AdminMfaBindingPage from './pages/AdminMfaBindingPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import DashboardLayout from './components/DashboardLayout';
import { useAdminSession } from './contexts/AdminSessionContext';
import { PERMISSIONS } from './rbac/permissions';

const PlatformMembers = lazy(() => import('./pages/PlatformMembers'));
const PlatformMemberDetailPage = lazy(() => import('./pages/PlatformMemberDetailPage'));
const CustomerManagement = lazy(() => import('./pages/CustomerManagement'));
const SwapQuoteList = lazy(() => import('./pages/SwapQuoteList'));
const SwapQuoteDetail = lazy(() => import('./pages/SwapQuoteDetail'));
const SwapOutstandingList = lazy(() => import('./pages/SwapOutstandingList'));
const SwapOutstandingDetail = lazy(() => import('./pages/SwapOutstandingDetail'));
const FeeAccrualList = lazy(() => import('./pages/FeeAccrualList'));
const FeeAccrualDetail = lazy(() => import('./pages/FeeAccrualDetail'));
const ReconciliationRunsListPage = lazy(() => import('./pages/ReconciliationRunsListPage'));
const ReconciliationRunsDetailPage = lazy(() => import('./pages/ReconciliationRunsDetailPage'));
const ReconciliationCasesListPage = lazy(() => import('./pages/ReconciliationCasesListPage'));
const ReconciliationCasesDetailPage = lazy(() => import('./pages/ReconciliationCasesDetailPage'));
const ReconciliationExternalBalancesPage = lazy(() => import('./pages/ReconciliationExternalBalancesPage'));
const ReconciliationDemoComparePage = lazy(() => import('./pages/ReconciliationDemoComparePage'));
const CustomerDetail = lazy(() => import('./pages/CustomerDetail'));
const LiquidityProviderList = lazy(() => import('./pages/LiquidityProviderList'));
const LiquidityProviderCreate = lazy(() => import('./pages/LiquidityProviderCreate'));
const LiquidityConfigList = lazy(() => import('./pages/LiquidityConfigList'));
const LiquidityConfigCreate = lazy(() => import('./pages/LiquidityConfigCreate'));
const LiquidityConfigEdit = lazy(() => import('./pages/LiquidityConfigEdit'));
const CustodianWalletList = lazy(() => import('./pages/CustodianWalletList'));
const CustodianWalletDetail = lazy(() => import('./pages/CustodianWalletDetail'));
const PayinList = lazy(() => import('./pages/PayinList'));
const PayinDetail = lazy(() => import('./pages/PayinDetail'));
const PayoutList = lazy(() => import('./pages/PayoutList'));
const PayoutDetail = lazy(() => import('./pages/PayoutDetail'));
const InternalFundListPage = lazy(() => import('./pages/funds-layer/InternalFundListPage'));
const InternalFundDetailPage = lazy(() => import('./pages/funds-layer/InternalFundDetailPage'));
const InternalTransferListPage = lazy(() => import('./pages/funds-layer/InternalTransferListPage'));
const InternalTransferDetailPage = lazy(() => import('./pages/funds-layer/InternalTransferDetailPage'));
const SettlementListPage = lazy(() => import('./pages/funds-layer/SettlementListPage'));
const SettlementDetailPage = lazy(() => import('./pages/funds-layer/SettlementDetailPage'));
const AssetList = lazy(() => import('./pages/AssetList'));
const AssetCreate = lazy(() => import('./pages/AssetCreate'));
const AssetEdit = lazy(() => import('./pages/AssetEdit'));
const AssetDetail = lazy(() => import('./pages/AssetDetail'));
const DepositTransactionList = lazy(() => import('./pages/DepositTransactionList'));
const DepositTransactionDetail = lazy(() => import('./pages/DepositTransactionDetail'));
const WithdrawTransactionList = lazy(() => import('./pages/WithdrawTransactionList'));
const WithdrawTransactionDetail = lazy(() => import('./pages/WithdrawTransactionDetail'));
const SwapTransactionList = lazy(() => import('./pages/SwapTransactionList'));
const SwapTransactionDetail = lazy(() => import('./pages/SwapTransactionDetail'));
const AuditLogsPage = lazy(() => import('./pages/AuditLogsPage'));
const AuditLogDetailPage = lazy(() => import('./pages/AuditLogDetailPage'));
const SumsubEventsPage = lazy(() => import('./pages/SumsubEventsPage'));
const EvidenceExportsPage = lazy(() => import('./pages/EvidenceExportsPage'));
const EvidenceExportDetailPage = lazy(() => import('./pages/EvidenceExportDetailPage'));
const ApprovalsPage = lazy(() => import('./pages/ApprovalsPage'));
const ApprovalDetailPage = lazy(() => import('./pages/ApprovalDetailPage'));
const GovernanceRegistryListPage = lazy(() => import('./pages/GovernanceRegistryListPage'));
const GovernanceRegistryDetailPage = lazy(() => import('./pages/GovernanceRegistryDetailPage'));
const GovernanceRegistryCreatePage = lazy(() => import('./pages/GovernanceRegistryCreatePage'));
const GovernanceRegistryEditPage = lazy(() => import('./pages/GovernanceRegistryEditPage'));
const RegulatoryGateListPage = lazy(() => import('./pages/RegulatoryGateListPage'));
const RegulatoryGateDetailPage = lazy(() => import('./pages/RegulatoryGateDetailPage'));
const RegulatoryGateCreatePage = lazy(() => import('./pages/RegulatoryGateCreatePage'));
const Wave8OpsDashboardPage = lazy(() => import('./pages/Wave8OpsDashboardPage'));
const RoleChangeRequestsPage = lazy(() => import('./pages/RoleChangeRequestsPage'));
const RoleChangeRequestDetailPage = lazy(() => import('./pages/RoleChangeRequestDetailPage'));
const RolesPage = lazy(() => import('./pages/RolesPage'));
const RoleDetailPage = lazy(() => import('./pages/RoleDetailPage'));
const MaterialManagementPage = lazy(() => import('./pages/MaterialManagementPage'));
const MaterialHoldingDetailPage = lazy(() => import('./pages/MaterialHoldingDetailPage'));
const RefreshCyclesPage = lazy(() => import('./pages/RefreshCyclesPage'));
const RefreshCycleDetailPage = lazy(() => import('./pages/RefreshCycleDetailPage'));
const RiskAssessmentListPage = lazy(() => import('./pages/RiskAssessmentListPage'));
const RiskAssessmentDetailPage = lazy(() => import('./pages/RiskAssessmentDetailPage'));
const ApprovalPoliciesPage = lazy(() => import('./pages/ApprovalPoliciesPage'));
const PolicyChangeRequestsPage = lazy(() => import('./pages/PolicyChangeRequestsPage'));
const PolicyChangeRequestDetailPage = lazy(() => import('./pages/PolicyChangeRequestDetailPage'));
const LedgerAccountList = lazy(() => import('./pages/LedgerAccountList'));
const LedgerAccountDetail = lazy(() => import('./pages/LedgerAccountDetail'));
const TransferEvidenceList = lazy(() => import('./pages/TransferEvidenceList'));
const TransferEvidenceDetail = lazy(() => import('./pages/TransferEvidenceDetail'));
const AccountStatementPage = lazy(() => import('./pages/AccountStatementPage'));
const WithdrawalAddressList = lazy(() => import('./pages/WithdrawalAddressList'));
const WithdrawalAddressDetail = lazy(() => import('./pages/WithdrawalAddressDetail'));
const TransactionLimitList = lazy(() => import('./pages/TransactionLimitList'));
const TransactionLimitDetail = lazy(() => import('./pages/TransactionLimitDetail'));
const WithdrawalFeeLevelList = lazy(() => import('./pages/WithdrawalFeeLevelList'));
const WithdrawalFeeLevelDetail = lazy(() => import('./pages/WithdrawalFeeLevelDetail'));
const SwapFeeLevelList = lazy(() => import('./pages/SwapFeeLevelList'));
const SwapFeeLevelDetail = lazy(() => import('./pages/SwapFeeLevelDetail'));
const WithdrawQuoteList = lazy(() => import('./pages/WithdrawQuoteList'));
const WithdrawQuoteDetail = lazy(() => import('./pages/WithdrawQuoteDetail'));

const FullPageMessage = ({
  title,
  description,
}: {
  title: string;
  description: string;
}) => (
  <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
    <div className="max-w-md w-full bg-white border border-gray-200 shadow-sm rounded-xl p-8 text-center">
      <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
      <p className="text-sm text-gray-600 mt-3">{description}</p>
    </div>
  </div>
);

const ForbiddenPage = () => (
  <FullPageMessage
    title="403 Permission Denied"
    description="You are signed in, but your role does not have permission to access this page."
  />
);

const SessionLoading = () => (
  <FullPageMessage
    title="Loading Session"
    description="Verifying your admin role and permissions..."
  />
);

const RouteLoading = () => (
  <FullPageMessage
    title="Loading Page"
    description="Preparing the requested admin page..."
  />
);

const RequireAuthenticated = ({ children }: { children: ReactElement }) => {
  const { isLoading, isAuthenticated } = useAdminSession();
  if (isLoading) {
    return <SessionLoading />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/admin/login" replace />;
  }

  return children;
};

const RequirePermission = ({
  permissions,
  children,
}: {
  permissions: string[];
  children: ReactElement;
}) => {
  const { isLoading, isAuthenticated, hasAnyPermission } = useAdminSession();

  if (isLoading) {
    return <SessionLoading />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/admin/login" replace />;
  }

  if (permissions.length === 0 || hasAnyPermission(permissions)) {
    return children;
  }

  return <ForbiddenPage />;
};

const LoginEntry = () => {
  const { isLoading, isAuthenticated } = useAdminSession();

  if (isLoading) {
    return <SessionLoading />;
  }

  if (isAuthenticated) {
    return <Navigate to="/admin" replace />;
  }

  return <AdminLogin />;
};

const withPermission = (element: ReactElement, permissions: string[]) => (
  <RequirePermission permissions={permissions}>
    <Suspense fallback={<RouteLoading />}>{element}</Suspense>
  </RequirePermission>
);

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/admin/login" element={<LoginEntry />} />
        <Route path="/admin/activate" element={<AdminInviteActivate />} />
        <Route path="/admin/mfa-binding" element={<AdminMfaBindingPage />} />
        <Route path="/admin/reset-password" element={<ResetPasswordPage />} />

        <Route
          element={
            <RequireAuthenticated>
              <DashboardLayout />
            </RequireAuthenticated>
          }
        >
          <Route path="/dashboard">
            <Route
              index
              element={withPermission(<Wave8OpsDashboardPage />, [PERMISSIONS.BASE_ACCESS])}
            />
            <Route
              path="members"
              element={withPermission(<PlatformMembers />, [PERMISSIONS.USERS_READ])}
            />
            <Route
              path="members/:id"
              element={withPermission(<PlatformMemberDetailPage />, [PERMISSIONS.USERS_READ])}
            />
            <Route
              path="members/roles"
              element={withPermission(<RolesPage />, [PERMISSIONS.IAM_ROLES_READ])}
            />
            <Route
              path="members/roles/:code"
              element={withPermission(<RoleDetailPage />, [PERMISSIONS.IAM_ROLES_READ])}
            />
            <Route
              path="members/role-change-requests"
              element={withPermission(<RoleChangeRequestsPage />, [PERMISSIONS.IAM_ROLE_CHANGE_REQUESTS_READ])}
            />
            <Route
              path="members/role-change-requests/:id"
              element={withPermission(<RoleChangeRequestDetailPage />, [PERMISSIONS.IAM_ROLE_CHANGE_REQUEST_DETAIL_READ])}
            />
            <Route
              path="customer/management"
              element={withPermission(<CustomerManagement />, [PERMISSIONS.CUSTOMERS_READ])}
            />
            <Route
              path="pricing/quotes"
              element={withPermission(<SwapQuoteList />, [PERMISSIONS.SWAP_QUOTES_READ])}
            />
            <Route
              path="pricing/quotes/:id"
              element={withPermission(<SwapQuoteDetail />, [PERMISSIONS.SWAP_QUOTES_DETAIL_READ])}
            />
            <Route
              path="pricing/quotes/:business/:id"
              element={withPermission(<SwapQuoteDetail />, [PERMISSIONS.SWAP_QUOTES_DETAIL_READ])}
            />
            <Route
              path="pricing/withdraw-quotes"
              element={withPermission(<WithdrawQuoteList />, [PERMISSIONS.WITHDRAW_QUOTES_READ])}
            />
            <Route
              path="pricing/withdraw-quotes/:id"
              element={withPermission(<WithdrawQuoteDetail />, [PERMISSIONS.WITHDRAW_QUOTES_DETAIL_READ])}
            />
            <Route
              path="reconciliation/runs"
              element={withPermission(<ReconciliationRunsListPage />, [
                PERMISSIONS.RECON_RUN_READ,
              ])}
            />
            <Route
              path="reconciliation/runs/:runNo"
              element={withPermission(<ReconciliationRunsDetailPage />, [
                PERMISSIONS.RECON_RUN_DETAIL_READ,
              ])}
            />
            <Route
              path="reconciliation/cases"
              element={withPermission(<ReconciliationCasesListPage />, [
                PERMISSIONS.RECON_CASE_READ,
              ])}
            />
            <Route
              path="reconciliation/cases/:caseNo"
              element={withPermission(<ReconciliationCasesDetailPage />, [
                PERMISSIONS.RECON_CASE_DETAIL_READ,
              ])}
            />
            <Route
              path="reconciliation/external-balances"
              element={withPermission(<ReconciliationExternalBalancesPage />, [
                PERMISSIONS.RECON_EXTERNAL_BALANCE_READ,
              ])}
            />
            <Route
              path="reconciliation/demo-compare/:runNo"
              element={withPermission(<ReconciliationDemoComparePage />, [
                PERMISSIONS.RECON_RUN_READ,
              ])}
            />
            <Route
              path="reconciliation/outstandings"
              element={withPermission(<SwapOutstandingList />, [PERMISSIONS.OUTSTANDINGS_READ])}
            />
            <Route
              path="reconciliation/outstandings/:id"
              element={withPermission(<SwapOutstandingDetail />, [PERMISSIONS.OUTSTANDING_DETAIL_READ])}
            />
            <Route
              path="reconciliation/fee-accruals"
              element={withPermission(<FeeAccrualList />, [PERMISSIONS.FEE_ACCRUALS_READ])}
            />
            <Route
              path="reconciliation/fee-accruals/:id"
              element={withPermission(<FeeAccrualDetail />, [PERMISSIONS.FEE_ACCRUAL_DETAIL_READ])}
            />
            <Route
              path="compliance/sumsub-events"
              element={withPermission(<SumsubEventsPage />, [PERMISSIONS.SUMSUB_EVENTS_READ])}
            />
            <Route
              path="compliance/material-management"
              element={withPermission(<MaterialManagementPage />, [PERMISSIONS.CUSTOMERS_READ])}
            />
            <Route
              path="compliance/material-management/:holdingId"
              element={withPermission(<MaterialHoldingDetailPage />, [PERMISSIONS.CUSTOMERS_READ])}
            />
            <Route
              path="compliance/refresh-cycles"
              element={withPermission(<RefreshCyclesPage />, [PERMISSIONS.CUSTOMERS_READ])}
            />
            <Route
              path="compliance/refresh-cycles/:cycleId"
              element={withPermission(<RefreshCycleDetailPage />, [])}
            />
            <Route
              path="compliance/risk-assessments"
              element={withPermission(<RiskAssessmentListPage />, [PERMISSIONS.RISK_ASSESSMENTS_READ])}
            />
            <Route
              path="compliance/risk-assessments/:assessmentId"
              element={withPermission(<RiskAssessmentDetailPage />, [PERMISSIONS.RISK_ASSESSMENTS_READ])}
            />
            <Route
              path="audit/audit-logs"
              element={withPermission(<AuditLogsPage />, [PERMISSIONS.AUDIT_LOGS_READ])}
            />
            <Route
              path="audit/audit-logs/:id"
              element={withPermission(<AuditLogDetailPage />, [PERMISSIONS.AUDIT_LOGS_READ])}
            />
            <Route
              path="audit/evidence-exports"
              element={withPermission(<EvidenceExportsPage />, [
                PERMISSIONS.AUDIT_EVIDENCE_EXPORTS_READ,
              ])}
            />
            <Route
              path="audit/evidence-exports/:id"
              element={withPermission(<EvidenceExportDetailPage />, [
                PERMISSIONS.AUDIT_EVIDENCE_EXPORTS_READ,
              ])}
            />
            <Route
              path="control-gates/approvals"
              element={withPermission(<ApprovalsPage />, [PERMISSIONS.GOV_APPROVALS_READ])}
            />
            <Route
              path="control-gates"
              element={withPermission(
                <Navigate to="/admin/governance/approvals" replace />,
                [PERMISSIONS.GOV_APPROVALS_READ],
              )}
            />
            <Route
              path="control-gates/approvals/:id"
              element={withPermission(<ApprovalDetailPage />, [
                PERMISSIONS.GOV_APPROVAL_DETAIL_READ,
              ])}
            />

            <Route
              path="governance/registries/shareholding-versions"
              element={withPermission(
                <GovernanceRegistryListPage registryType="shareholding-versions" />,
                [PERMISSIONS.GOV_SHAREHOLDING_REGISTRY_READ],
              )}
            />
            <Route
              path="governance/registries/shareholding-versions/create"
              element={withPermission(
                <GovernanceRegistryCreatePage registryType="shareholding-versions" />,
                [PERMISSIONS.GOV_SHAREHOLDING_REGISTRY_CREATE],
              )}
            />
            <Route
              path="governance/registries/shareholding-versions/edit/:id"
              element={withPermission(
                <GovernanceRegistryEditPage registryType="shareholding-versions" />,
                [PERMISSIONS.GOV_SHAREHOLDING_REGISTRY_UPDATE],
              )}
            />
            <Route
              path="governance/registries/shareholding-versions/:id"
              element={withPermission(
                <GovernanceRegistryDetailPage registryType="shareholding-versions" />,
                [PERMISSIONS.GOV_SHAREHOLDING_REGISTRY_DETAIL_READ],
              )}
            />
            <Route
              path="governance/registries/appointments"
              element={withPermission(
                <GovernanceRegistryListPage registryType="appointments" />,
                [PERMISSIONS.GOV_APPOINTMENTS_READ],
              )}
            />
            <Route
              path="governance/registries/appointments/create"
              element={withPermission(
                <GovernanceRegistryCreatePage registryType="appointments" />,
                [PERMISSIONS.GOV_APPOINTMENT_CREATE],
              )}
            />
            <Route
              path="governance/registries/appointments/edit/:id"
              element={withPermission(
                <GovernanceRegistryEditPage registryType="appointments" />,
                [PERMISSIONS.GOV_APPOINTMENT_UPDATE],
              )}
            />
            <Route
              path="governance/registries/appointments/:id"
              element={withPermission(
                <GovernanceRegistryDetailPage registryType="appointments" />,
                [PERMISSIONS.GOV_APPOINTMENT_DETAIL_READ],
              )}
            />
            <Route
              path="governance/registries/trainings"
              element={withPermission(
                <GovernanceRegistryListPage registryType="trainings" />,
                [PERMISSIONS.GOV_TRAININGS_READ],
              )}
            />
            <Route
              path="governance/registries/trainings/create"
              element={withPermission(
                <GovernanceRegistryCreatePage registryType="trainings" />,
                [PERMISSIONS.GOV_TRAINING_CREATE],
              )}
            />
            <Route
              path="governance/registries/trainings/edit/:id"
              element={withPermission(
                <GovernanceRegistryEditPage registryType="trainings" />,
                [PERMISSIONS.GOV_TRAINING_UPDATE],
              )}
            />
            <Route
              path="governance/registries/trainings/:id"
              element={withPermission(
                <GovernanceRegistryDetailPage registryType="trainings" />,
                [PERMISSIONS.GOV_TRAINING_DETAIL_READ],
              )}
            />
            <Route
              path="governance/registries/conflicts"
              element={withPermission(
                <GovernanceRegistryListPage registryType="conflicts" />,
                [PERMISSIONS.GOV_CONFLICTS_READ],
              )}
            />
            <Route
              path="governance/registries/conflicts/create"
              element={withPermission(
                <GovernanceRegistryCreatePage registryType="conflicts" />,
                [PERMISSIONS.GOV_CONFLICT_CREATE],
              )}
            />
            <Route
              path="governance/registries/conflicts/edit/:id"
              element={withPermission(
                <GovernanceRegistryEditPage registryType="conflicts" />,
                [PERMISSIONS.GOV_CONFLICT_UPDATE],
              )}
            />
            <Route
              path="governance/registries/conflicts/:id"
              element={withPermission(
                <GovernanceRegistryDetailPage registryType="conflicts" />,
                [PERMISSIONS.GOV_CONFLICT_DETAIL_READ],
              )}
            />
            <Route
              path="governance/registries/wind-down-materials"
              element={withPermission(
                <GovernanceRegistryListPage registryType="wind-down-materials" />,
                [PERMISSIONS.GOV_WIND_DOWN_MATERIALS_READ],
              )}
            />
            <Route
              path="governance/registries/wind-down-materials/create"
              element={withPermission(
                <GovernanceRegistryCreatePage registryType="wind-down-materials" />,
                [PERMISSIONS.GOV_WIND_DOWN_MATERIAL_CREATE],
              )}
            />
            <Route
              path="governance/registries/wind-down-materials/edit/:id"
              element={withPermission(
                <GovernanceRegistryEditPage registryType="wind-down-materials" />,
                [PERMISSIONS.GOV_WIND_DOWN_MATERIAL_UPDATE],
              )}
            />
            <Route
              path="governance/registries/wind-down-materials/:id"
              element={withPermission(
                <GovernanceRegistryDetailPage registryType="wind-down-materials" />,
                [PERMISSIONS.GOV_WIND_DOWN_MATERIAL_DETAIL_READ],
              )}
            />
            <Route
              path="governance/regulatory-gates"
              element={withPermission(<RegulatoryGateListPage />, [
                PERMISSIONS.GOV_REGULATORY_GATES_READ,
              ])}
            />
            <Route
              path="governance/regulatory-gates/create"
              element={withPermission(<RegulatoryGateCreatePage />, [
                PERMISSIONS.GOV_REGULATORY_GATE_CREATE,
              ])}
            />
            <Route
              path="governance/regulatory-gates/:id"
              element={withPermission(<RegulatoryGateDetailPage />, [
                PERMISSIONS.GOV_REGULATORY_GATE_DETAIL_READ,
              ])}
            />
            <Route
              path="governance/approval-policies"
              element={withPermission(<ApprovalPoliciesPage />, [
                PERMISSIONS.GOV_APPROVAL_POLICIES_READ,
              ])}
            />
            <Route
              path="governance/policy-change-requests"
              element={withPermission(<PolicyChangeRequestsPage />, [
                PERMISSIONS.GOV_APPROVAL_POLICY_CHANGE_REQUESTS_READ,
              ])}
            />
            <Route
              path="governance/policy-change-requests/:id"
              element={withPermission(<PolicyChangeRequestDetailPage />, [
                PERMISSIONS.GOV_APPROVAL_POLICY_CHANGE_REQUEST_DETAIL_READ,
              ])}
            />
            <Route
              path="customer/:id"
              element={withPermission(<CustomerDetail />, [PERMISSIONS.CUSTOMERS_DETAIL_READ])}
            />
            <Route
              path="treasury/custodian-wallets"
              element={withPermission(<CustodianWalletList />, [PERMISSIONS.WALLETS_READ])}
            />
            <Route
              path="treasury/custodian-wallets/:id"
              element={withPermission(<CustodianWalletDetail />, [PERMISSIONS.WALLET_DETAIL_READ])}
            />
            <Route
              path="treasury/payins"
              element={withPermission(<PayinList />, [PERMISSIONS.PAYINS_READ])}
            />
            <Route
              path="treasury/payins/:id"
              element={withPermission(<PayinDetail />, [PERMISSIONS.PAYIN_DETAIL_READ])}
            />
            <Route
              path="treasury/payouts"
              element={withPermission(<PayoutList />, [PERMISSIONS.PAYOUTS_READ])}
            />
            <Route
              path="treasury/payouts/:id"
              element={withPermission(<PayoutDetail />, [PERMISSIONS.PAYOUT_DETAIL_READ])}
            />
            <Route
              path="system/liquidity-providers"
              element={withPermission(<LiquidityProviderList />, [PERMISSIONS.LIQUIDITY_PROVIDERS_READ])}
            />
            <Route
              path="system/liquidity-providers/create"
              element={withPermission(<LiquidityProviderCreate />, [PERMISSIONS.LIQUIDITY_PROVIDERS_CREATE])}
            />
            <Route
              path="system/liquidity-config"
              element={withPermission(<LiquidityConfigList />, [PERMISSIONS.LIQUIDITY_CONFIG_READ])}
            />
            <Route
              path="system/liquidity-config/create"
              element={withPermission(<LiquidityConfigCreate />, [PERMISSIONS.LIQUIDITY_CONFIG_CREATE])}
            />
            <Route
              path="system/liquidity-config/edit/:id"
              element={withPermission(<LiquidityConfigEdit />, [PERMISSIONS.LIQUIDITY_CONFIG_UPDATE])}
            />
            <Route
              path="system/assets"
              element={withPermission(<AssetList />, [PERMISSIONS.ASSETS_READ])}
            />
            <Route
              path="system/assets/create"
              element={withPermission(<AssetCreate />, [PERMISSIONS.ASSETS_CREATE])}
            />
            <Route
              path="system/assets/:assetNo/edit"
              element={withPermission(<AssetEdit />, [PERMISSIONS.ASSETS_CREATE])}
            />
            <Route
              path="system/assets/:assetNo"
              element={withPermission(<AssetDetail />, [PERMISSIONS.ASSETS_READ])}
            />
            <Route
              path="system/transaction-limits"
              element={withPermission(<TransactionLimitList />, [PERMISSIONS.TRANSACTION_LIMIT_POLICIES_READ])}
            />
            <Route
              path="system/transaction-limits/:policyNo"
              element={withPermission(<TransactionLimitDetail />, [PERMISSIONS.TRANSACTION_LIMIT_POLICIES_READ])}
            />
            <Route
              path="pricing/withdrawal-fee-levels"
              element={withPermission(<WithdrawalFeeLevelList />, [PERMISSIONS.WITHDRAWAL_FEE_LEVELS_READ])}
            />
            <Route
              path="pricing/withdrawal-fee-levels/:levelCode"
              element={withPermission(<WithdrawalFeeLevelDetail />, [PERMISSIONS.WITHDRAWAL_FEE_LEVELS_READ])}
            />
            <Route
              path="pricing/swap-fee-levels"
              element={withPermission(<SwapFeeLevelList />, [PERMISSIONS.SWAP_FEE_LEVELS_READ])}
            />
            <Route
              path="pricing/swap-fee-levels/:levelCode"
              element={withPermission(<SwapFeeLevelDetail />, [PERMISSIONS.SWAP_FEE_LEVELS_READ])}
            />
            <Route
              path="treasury/withdrawal-addresses"
              element={withPermission(<WithdrawalAddressList />, [PERMISSIONS.WITHDRAWAL_ADDRESSES_READ])}
            />
            <Route
              path="treasury/withdrawal-addresses/:addressNo"
              element={withPermission(<WithdrawalAddressDetail />, [PERMISSIONS.WITHDRAWAL_ADDRESS_DETAIL_READ])}
            />
          </Route>

          {/* /funds-layer + /ledger roots removed → migrated to /admin/funds/* and /admin/ledger/* (IA redesign 2026-06-17) */}

          {/* ─── NEW unified /admin domain tree (IA redesign 2026-06-17) ─── */}
          <Route path="/admin">
            <Route index element={withPermission(<Wave8OpsDashboardPage />, [PERMISSIONS.BASE_ACCESS])} />

            {/* iam */}
            <Route path="iam/members" element={withPermission(<PlatformMembers />, [PERMISSIONS.USERS_READ])} />
            <Route path="iam/members/:id" element={withPermission(<PlatformMemberDetailPage />, [PERMISSIONS.USERS_READ])} />
            <Route path="iam/roles" element={withPermission(<RolesPage />, [PERMISSIONS.IAM_ROLES_READ])} />
            <Route path="iam/roles/:code" element={withPermission(<RoleDetailPage />, [PERMISSIONS.IAM_ROLES_READ])} />

            {/* customers */}
            <Route path="customers" element={withPermission(<CustomerManagement />, [PERMISSIONS.CUSTOMERS_READ])} />
            <Route path="customers/:id" element={withPermission(<CustomerDetail />, [PERMISSIONS.CUSTOMERS_DETAIL_READ])} />
            <Route path="customers/material-holdings" element={withPermission(<MaterialManagementPage />, [PERMISSIONS.CUSTOMERS_READ])} />
            <Route path="customers/material-holdings/:holdingId" element={withPermission(<MaterialHoldingDetailPage />, [PERMISSIONS.CUSTOMERS_READ])} />
            <Route path="customers/refresh-cycles" element={withPermission(<RefreshCyclesPage />, [PERMISSIONS.CUSTOMERS_READ])} />
            <Route path="customers/refresh-cycles/:cycleId" element={withPermission(<RefreshCycleDetailPage />, [])} />

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
            <Route path="trading/withdraw-quotes/:id" element={withPermission(<WithdrawQuoteDetail />, [PERMISSIONS.WITHDRAW_QUOTES_DETAIL_READ])} />
            <Route path="trading/swap-quotes" element={withPermission(<SwapQuoteList />, [PERMISSIONS.SWAP_QUOTES_READ])} />
            <Route path="trading/swap-quotes/:id" element={withPermission(<SwapQuoteDetail />, [PERMISSIONS.SWAP_QUOTES_DETAIL_READ])} />
            <Route path="trading/swap-quotes/:business/:id" element={withPermission(<SwapQuoteDetail />, [PERMISSIONS.SWAP_QUOTES_DETAIL_READ])} />

            {/* funds */}
            <Route path="funds/transfers" element={withPermission(<InternalTransferListPage />, [PERMISSIONS.FUNDS_LAYER_TRANSFERS_READ])} />
            <Route path="funds/transfers/:internalTxNo" element={withPermission(<InternalTransferDetailPage />, [PERMISSIONS.FUNDS_LAYER_TRANSFER_DETAIL_READ])} />
            <Route path="funds/internal-funds" element={withPermission(<InternalFundListPage />, [PERMISSIONS.FUNDS_LAYER_FUNDS_READ])} />
            <Route path="funds/internal-funds/:internalFundNo" element={withPermission(<InternalFundDetailPage />, [PERMISSIONS.FUNDS_LAYER_FUND_DETAIL_READ])} />
            <Route path="funds/settlements" element={withPermission(<SettlementListPage />, [PERMISSIONS.FUNDS_LAYER_SETTLEMENTS_READ])} />
            <Route path="funds/settlements/:batchNo" element={withPermission(<SettlementDetailPage />, [PERMISSIONS.FUNDS_LAYER_SETTLEMENT_DETAIL_READ])} />
            <Route path="funds/outstandings" element={withPermission(<SwapOutstandingList />, [PERMISSIONS.OUTSTANDINGS_READ])} />
            <Route path="funds/outstandings/:id" element={withPermission(<SwapOutstandingDetail />, [PERMISSIONS.OUTSTANDING_DETAIL_READ])} />
            <Route path="funds/fee-accruals" element={withPermission(<FeeAccrualList />, [PERMISSIONS.FEE_ACCRUALS_READ])} />
            <Route path="funds/fee-accruals/:id" element={withPermission(<FeeAccrualDetail />, [PERMISSIONS.FEE_ACCRUAL_DETAIL_READ])} />

            {/* custody */}
            <Route path="custody/wallets" element={withPermission(<CustodianWalletList />, [PERMISSIONS.WALLETS_READ])} />
            <Route path="custody/wallets/:id" element={withPermission(<CustodianWalletDetail />, [PERMISSIONS.WALLET_DETAIL_READ])} />
            <Route path="custody/withdrawal-addresses" element={withPermission(<WithdrawalAddressList />, [PERMISSIONS.WITHDRAWAL_ADDRESSES_READ])} />
            <Route path="custody/withdrawal-addresses/:addressNo" element={withPermission(<WithdrawalAddressDetail />, [PERMISSIONS.WITHDRAWAL_ADDRESS_DETAIL_READ])} />

            {/* assets */}
            <Route path="assets" element={withPermission(<AssetList />, [PERMISSIONS.ASSETS_READ])} />
            <Route path="assets/create" element={withPermission(<AssetCreate />, [PERMISSIONS.ASSETS_CREATE])} />
            <Route path="assets/:assetNo/edit" element={withPermission(<AssetEdit />, [PERMISSIONS.ASSETS_CREATE])} />
            <Route path="assets/:assetNo" element={withPermission(<AssetDetail />, [PERMISSIONS.ASSETS_READ])} />
            <Route path="assets/transaction-limits" element={withPermission(<TransactionLimitList />, [PERMISSIONS.TRANSACTION_LIMIT_POLICIES_READ])} />
            <Route path="assets/transaction-limits/:policyNo" element={withPermission(<TransactionLimitDetail />, [PERMISSIONS.TRANSACTION_LIMIT_POLICIES_READ])} />

            {/* pricing */}
            <Route path="pricing/withdrawal-fee-levels" element={withPermission(<WithdrawalFeeLevelList />, [PERMISSIONS.WITHDRAWAL_FEE_LEVELS_READ])} />
            <Route path="pricing/withdrawal-fee-levels/:levelCode" element={withPermission(<WithdrawalFeeLevelDetail />, [PERMISSIONS.WITHDRAWAL_FEE_LEVELS_READ])} />
            <Route path="pricing/swap-fee-levels" element={withPermission(<SwapFeeLevelList />, [PERMISSIONS.SWAP_FEE_LEVELS_READ])} />
            <Route path="pricing/swap-fee-levels/:levelCode" element={withPermission(<SwapFeeLevelDetail />, [PERMISSIONS.SWAP_FEE_LEVELS_READ])} />

            {/* reconciliation (V8) */}
            <Route path="reconciliation/runs" element={withPermission(<ReconciliationRunsListPage />, [PERMISSIONS.RECON_RUN_READ])} />
            <Route path="reconciliation/runs/:runNo" element={withPermission(<ReconciliationRunsDetailPage />, [PERMISSIONS.RECON_RUN_DETAIL_READ])} />
            <Route path="reconciliation/cases" element={withPermission(<ReconciliationCasesListPage />, [PERMISSIONS.RECON_CASE_READ])} />
            <Route path="reconciliation/cases/:caseNo" element={withPermission(<ReconciliationCasesDetailPage />, [PERMISSIONS.RECON_CASE_DETAIL_READ])} />
            <Route path="reconciliation/external-balances" element={withPermission(<ReconciliationExternalBalancesPage />, [PERMISSIONS.RECON_EXTERNAL_BALANCE_READ])} />
            <Route path="reconciliation/demo-compare/:runNo" element={withPermission(<ReconciliationDemoComparePage />, [PERMISSIONS.RECON_RUN_READ])} />

            {/* ledger */}
            <Route path="ledger/accounts" element={withPermission(<LedgerAccountList />, [PERMISSIONS.TB_ACCOUNTS_READ])} />
            <Route path="ledger/accounts/:id" element={withPermission(<LedgerAccountDetail />, [PERMISSIONS.TB_ACCOUNTS_READ])} />
            <Route path="ledger/transfer-evidence" element={withPermission(<TransferEvidenceList />, [PERMISSIONS.TB_TRANSFERS_READ])} />
            <Route path="ledger/transfer-evidence/:tbTransferId" element={withPermission(<TransferEvidenceDetail />, [PERMISSIONS.TB_TRANSFER_DETAIL_READ])} />
            <Route path="ledger/account-statement" element={withPermission(<AccountStatementPage />, [PERMISSIONS.TB_ACCOUNTS_READ])} />

            {/* governance */}
            <Route path="governance/approvals" element={withPermission(<ApprovalsPage />, [PERMISSIONS.GOV_APPROVALS_READ])} />
            <Route path="governance/approvals/:id" element={withPermission(<ApprovalDetailPage />, [PERMISSIONS.GOV_APPROVAL_DETAIL_READ])} />
            <Route path="governance/approval-policies" element={withPermission(<ApprovalPoliciesPage />, [PERMISSIONS.GOV_APPROVAL_POLICIES_READ])} />

            {/* audit */}
            <Route path="audit/logs" element={withPermission(<AuditLogsPage />, [PERMISSIONS.AUDIT_LOGS_READ])} />
            <Route path="audit/logs/:id" element={withPermission(<AuditLogDetailPage />, [PERMISSIONS.AUDIT_LOGS_READ])} />
            <Route path="audit/evidence-packages" element={withPermission(<EvidenceExportsPage />, [PERMISSIONS.AUDIT_EVIDENCE_EXPORTS_READ])} />
            <Route path="audit/evidence-packages/:id" element={withPermission(<EvidenceExportDetailPage />, [PERMISSIONS.AUDIT_EVIDENCE_EXPORTS_READ])} />

            {/* registries (route-align only, content unchanged) */}
            <Route path="registries/shareholding-versions" element={withPermission(<GovernanceRegistryListPage registryType="shareholding-versions" />, [PERMISSIONS.GOV_SHAREHOLDING_REGISTRY_READ])} />
            <Route path="registries/shareholding-versions/create" element={withPermission(<GovernanceRegistryCreatePage registryType="shareholding-versions" />, [PERMISSIONS.GOV_SHAREHOLDING_REGISTRY_CREATE])} />
            <Route path="registries/shareholding-versions/edit/:id" element={withPermission(<GovernanceRegistryEditPage registryType="shareholding-versions" />, [PERMISSIONS.GOV_SHAREHOLDING_REGISTRY_UPDATE])} />
            <Route path="registries/shareholding-versions/:id" element={withPermission(<GovernanceRegistryDetailPage registryType="shareholding-versions" />, [PERMISSIONS.GOV_SHAREHOLDING_REGISTRY_DETAIL_READ])} />
            <Route path="registries/appointments" element={withPermission(<GovernanceRegistryListPage registryType="appointments" />, [PERMISSIONS.GOV_APPOINTMENTS_READ])} />
            <Route path="registries/appointments/create" element={withPermission(<GovernanceRegistryCreatePage registryType="appointments" />, [PERMISSIONS.GOV_APPOINTMENT_CREATE])} />
            <Route path="registries/appointments/edit/:id" element={withPermission(<GovernanceRegistryEditPage registryType="appointments" />, [PERMISSIONS.GOV_APPOINTMENT_UPDATE])} />
            <Route path="registries/appointments/:id" element={withPermission(<GovernanceRegistryDetailPage registryType="appointments" />, [PERMISSIONS.GOV_APPOINTMENT_DETAIL_READ])} />
            <Route path="registries/trainings" element={withPermission(<GovernanceRegistryListPage registryType="trainings" />, [PERMISSIONS.GOV_TRAININGS_READ])} />
            <Route path="registries/trainings/create" element={withPermission(<GovernanceRegistryCreatePage registryType="trainings" />, [PERMISSIONS.GOV_TRAINING_CREATE])} />
            <Route path="registries/trainings/edit/:id" element={withPermission(<GovernanceRegistryEditPage registryType="trainings" />, [PERMISSIONS.GOV_TRAINING_UPDATE])} />
            <Route path="registries/trainings/:id" element={withPermission(<GovernanceRegistryDetailPage registryType="trainings" />, [PERMISSIONS.GOV_TRAINING_DETAIL_READ])} />
            <Route path="registries/conflicts" element={withPermission(<GovernanceRegistryListPage registryType="conflicts" />, [PERMISSIONS.GOV_CONFLICTS_READ])} />
            <Route path="registries/conflicts/create" element={withPermission(<GovernanceRegistryCreatePage registryType="conflicts" />, [PERMISSIONS.GOV_CONFLICT_CREATE])} />
            <Route path="registries/conflicts/edit/:id" element={withPermission(<GovernanceRegistryEditPage registryType="conflicts" />, [PERMISSIONS.GOV_CONFLICT_UPDATE])} />
            <Route path="registries/conflicts/:id" element={withPermission(<GovernanceRegistryDetailPage registryType="conflicts" />, [PERMISSIONS.GOV_CONFLICT_DETAIL_READ])} />
            <Route path="registries/wind-down-materials" element={withPermission(<GovernanceRegistryListPage registryType="wind-down-materials" />, [PERMISSIONS.GOV_WIND_DOWN_MATERIALS_READ])} />
            <Route path="registries/wind-down-materials/create" element={withPermission(<GovernanceRegistryCreatePage registryType="wind-down-materials" />, [PERMISSIONS.GOV_WIND_DOWN_MATERIAL_CREATE])} />
            <Route path="registries/wind-down-materials/edit/:id" element={withPermission(<GovernanceRegistryEditPage registryType="wind-down-materials" />, [PERMISSIONS.GOV_WIND_DOWN_MATERIAL_UPDATE])} />
            <Route path="registries/wind-down-materials/:id" element={withPermission(<GovernanceRegistryDetailPage registryType="wind-down-materials" />, [PERMISSIONS.GOV_WIND_DOWN_MATERIAL_DETAIL_READ])} />
            <Route path="registries/regulatory-gates" element={withPermission(<RegulatoryGateListPage />, [PERMISSIONS.GOV_REGULATORY_GATES_READ])} />
            <Route path="registries/regulatory-gates/create" element={withPermission(<RegulatoryGateCreatePage />, [PERMISSIONS.GOV_REGULATORY_GATE_CREATE])} />
            <Route path="registries/regulatory-gates/:id" element={withPermission(<RegulatoryGateDetailPage />, [PERMISSIONS.GOV_REGULATORY_GATE_DETAIL_READ])} />

            {/* counterparty (route-align only, content unchanged) */}
            <Route path="counterparty/liquidity-providers" element={withPermission(<LiquidityProviderList />, [PERMISSIONS.LIQUIDITY_PROVIDERS_READ])} />
            <Route path="counterparty/liquidity-providers/create" element={withPermission(<LiquidityProviderCreate />, [PERMISSIONS.LIQUIDITY_PROVIDERS_CREATE])} />
            <Route path="counterparty/liquidity-config" element={withPermission(<LiquidityConfigList />, [PERMISSIONS.LIQUIDITY_CONFIG_READ])} />
            <Route path="counterparty/liquidity-config/create" element={withPermission(<LiquidityConfigCreate />, [PERMISSIONS.LIQUIDITY_CONFIG_CREATE])} />
            <Route path="counterparty/liquidity-config/edit/:id" element={withPermission(<LiquidityConfigEdit />, [PERMISSIONS.LIQUIDITY_CONFIG_UPDATE])} />
          </Route>

        </Route>

        <Route path="/forbidden" element={<ForbiddenPage />} />
        <Route path="/" element={<Navigate to="/admin/login" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;

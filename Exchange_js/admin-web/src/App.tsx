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
const ReconciliationRunsListPage = lazy(() => import('./pages/ReconciliationRunsListPage'));
const ReconciliationRunsDetailPage = lazy(() => import('./pages/ReconciliationRunsDetailPage'));
const ReconciliationCasesListPage = lazy(() => import('./pages/ReconciliationCasesListPage'));
const ReconciliationCasesDetailPage = lazy(() => import('./pages/ReconciliationCasesDetailPage'));
const ReconciliationExternalBalancesPage = lazy(() => import('./pages/ReconciliationExternalBalancesPage'));
const ReconciliationDemoComparePage = lazy(() => import('./pages/ReconciliationDemoComparePage'));
const ReconciliationAdjustmentDetailPage = lazy(() => import('./pages/ReconciliationAdjustmentDetailPage'));
const CustomerDetail = lazy(() => import('./pages/CustomerDetail'));
const CustodianWalletList = lazy(() => import('./pages/CustodianWalletList'));
const CustodianWalletDetail = lazy(() => import('./pages/CustodianWalletDetail'));
const FundsOrderList = lazy(() => import('./pages/FundsOrderList'));
const FundsOrderDetail = lazy(() => import('./pages/FundsOrderDetail'));
const AssetList = lazy(() => import('./pages/AssetList'));
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
const AdminHomePlaceholder = lazy(() => import('./pages/AdminHomePlaceholder'));
const RoleChangeRequestsPage = lazy(() => import('./pages/RoleChangeRequestsPage'));
const RoleChangeRequestDetailPage = lazy(() => import('./pages/RoleChangeRequestDetailPage'));
const RoleDefinitionModifyRequestsPage = lazy(() => import('./pages/RoleDefinitionModifyRequestsPage'));
const RoleDefinitionModifyRequestDetailPage = lazy(() => import('./pages/RoleDefinitionModifyRequestDetailPage'));
const RolesPage = lazy(() => import('./pages/RolesPage'));
const RoleDetailPage = lazy(() => import('./pages/RoleDetailPage'));
const MaterialManagementPage = lazy(() => import('./pages/MaterialManagementPage'));
const MaterialHoldingDetailPage = lazy(() => import('./pages/MaterialHoldingDetailPage'));
const RefreshCyclesPage = lazy(() => import('./pages/RefreshCyclesPage'));
const RefreshCycleDetailPage = lazy(() => import('./pages/RefreshCycleDetailPage'));
const ApprovalPoliciesPage = lazy(() => import('./pages/ApprovalPoliciesPage'));
const LedgerAccountList = lazy(() => import('./pages/LedgerAccountList'));
const LedgerAccountDetail = lazy(() => import('./pages/LedgerAccountDetail'));
const TransferEvidenceList = lazy(() => import('./pages/TransferEvidenceList'));
const TransferEvidenceDetail = lazy(() => import('./pages/TransferEvidenceDetail'));
const AccountFlowList = lazy(() => import('./pages/AccountFlowList'));
const WithdrawalAddressList = lazy(() => import('./pages/WithdrawalAddressList'));
const WithdrawalAddressDetail = lazy(() => import('./pages/WithdrawalAddressDetail'));
const InternalTransferList = lazy(() => import('./pages/InternalTransferList'));
const InternalTransferDetail = lazy(() => import('./pages/InternalTransferDetail'));
const TransactionLimitList = lazy(() => import('./pages/TransactionLimitList'));
const TransactionLimitDetail = lazy(() => import('./pages/TransactionLimitDetail'));
const WithdrawalFeeLevelList = lazy(() => import('./pages/WithdrawalFeeLevelList'));
const WithdrawalFeeLevelDetail = lazy(() => import('./pages/WithdrawalFeeLevelDetail'));
const SwapFeeLevelList = lazy(() => import('./pages/SwapFeeLevelList'));
const SwapFeeLevelDetail = lazy(() => import('./pages/SwapFeeLevelDetail'));
const WithdrawQuoteList = lazy(() => import('./pages/WithdrawQuoteList'));
const WithdrawQuoteDetail = lazy(() => import('./pages/WithdrawQuoteDetail'));
const IncidentListPage = lazy(() => import('./pages/IncidentListPage'));
const IncidentDetailPage = lazy(() => import('./pages/IncidentDetailPage'));

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

          {/* /funds-layer + /ledger roots removed → migrated to /admin/funds/* and /admin/ledger/* (IA redesign 2026-06-17) */}

          {/* ─── NEW unified /admin domain tree (IA redesign 2026-06-17) ─── */}
          <Route path="/admin">
            <Route index element={withPermission(<AdminHomePlaceholder />, [PERMISSIONS.BASE_ACCESS])} />

            {/* iam */}
            <Route path="iam/members" element={withPermission(<PlatformMembers />, [PERMISSIONS.USERS_READ])} />
            <Route path="iam/members/:userNo" element={withPermission(<PlatformMemberDetailPage />, [PERMISSIONS.USERS_READ])} />
            <Route path="iam/roles" element={withPermission(<RolesPage />, [PERMISSIONS.IAM_ROLES_READ])} />
            <Route path="iam/roles/:code" element={withPermission(<RoleDetailPage />, [PERMISSIONS.IAM_ROLES_READ])} />
            <Route path="iam/role-change-requests" element={withPermission(<RoleChangeRequestsPage />, [PERMISSIONS.IAM_ROLES_READ])} />
            <Route path="iam/role-change-requests/:requestNo" element={withPermission(<RoleChangeRequestDetailPage />, [PERMISSIONS.IAM_ROLES_READ])} />
            <Route path="iam/role-definition-modify-requests" element={withPermission(<RoleDefinitionModifyRequestsPage />, [PERMISSIONS.IAM_ROLE_DEFINITION_MODIFY_REQUESTS_READ])} />
            <Route path="iam/role-definition-modify-requests/:requestNo" element={withPermission(<RoleDefinitionModifyRequestDetailPage />, [PERMISSIONS.IAM_ROLE_DEFINITION_MODIFY_REQUEST_DETAIL_READ])} />

            {/* customers */}
            <Route path="customers" element={withPermission(<CustomerManagement />, [PERMISSIONS.CUSTOMERS_READ])} />
            <Route path="customers/:customerNo" element={withPermission(<CustomerDetail />, [PERMISSIONS.CUSTOMERS_DETAIL_READ])} />
            <Route path="customers/material-holdings" element={withPermission(<MaterialManagementPage />, [PERMISSIONS.CUSTOMERS_READ])} />
            <Route path="customers/material-holdings/:holdingId" element={withPermission(<MaterialHoldingDetailPage />, [PERMISSIONS.CUSTOMERS_READ])} />
            <Route path="customers/refresh-cycles" element={withPermission(<RefreshCyclesPage />, [PERMISSIONS.CUSTOMERS_READ])} />
            <Route path="customers/refresh-cycles/:cycleId" element={withPermission(<RefreshCycleDetailPage />, [])} />

            {/* compliance */}
            <Route path="compliance/sumsub-events" element={withPermission(<SumsubEventsPage />, [PERMISSIONS.SUMSUB_EVENTS_READ])} />

            {/* trading */}
            <Route path="trading/deposits" element={withPermission(<DepositTransactionList />, [PERMISSIONS.DEPOSIT_TRANSACTIONS_READ])} />
            <Route path="trading/deposits/:id" element={withPermission(<DepositTransactionDetail />, [PERMISSIONS.DEPOSIT_TRANSACTION_DETAIL_READ])} />
            <Route path="trading/withdrawals" element={withPermission(<WithdrawTransactionList />, [PERMISSIONS.WITHDRAW_TRANSACTIONS_READ])} />
            <Route path="trading/withdrawals/:id" element={withPermission(<WithdrawTransactionDetail />, [PERMISSIONS.WITHDRAW_TRANSACTION_DETAIL_READ])} />
            <Route path="trading/swaps" element={withPermission(<SwapTransactionList />, [PERMISSIONS.SWAP_TRANSACTIONS_READ])} />
            <Route path="trading/swaps/:id" element={withPermission(<SwapTransactionDetail />, [PERMISSIONS.SWAP_TRANSACTION_DETAIL_READ])} />
            <Route path="trading/withdraw-quotes" element={withPermission(<WithdrawQuoteList />, [PERMISSIONS.WITHDRAW_QUOTES_READ])} />
            <Route path="trading/withdraw-quotes/:id" element={withPermission(<WithdrawQuoteDetail />, [PERMISSIONS.WITHDRAW_QUOTES_DETAIL_READ])} />
            <Route path="trading/swap-quotes" element={withPermission(<SwapQuoteList />, [PERMISSIONS.SWAP_QUOTES_READ])} />
            <Route path="trading/swap-quotes/:id" element={withPermission(<SwapQuoteDetail />, [PERMISSIONS.SWAP_QUOTES_DETAIL_READ])} />
            <Route path="trading/swap-quotes/:business/:id" element={withPermission(<SwapQuoteDetail />, [PERMISSIONS.SWAP_QUOTES_DETAIL_READ])} />

            {/* funds — unified funds-orders surface (Round 2 / C6) */}
            <Route path="funds-orders" element={withPermission(<FundsOrderList />, [PERMISSIONS.FUNDS_ORDERS_READ])} />
            <Route path="funds-orders/:fundsOrderNo" element={withPermission(<FundsOrderDetail />, [PERMISSIONS.FUNDS_ORDER_DETAIL_READ])} />

            {/* custody */}
            <Route path="custody/wallets" element={withPermission(<CustodianWalletList />, [PERMISSIONS.WALLETS_READ])} />
            <Route path="custody/wallets/:walletNo" element={withPermission(<CustodianWalletDetail />, [PERMISSIONS.WALLET_DETAIL_READ])} />
            <Route path="custody/withdrawal-addresses" element={withPermission(<WithdrawalAddressList />, [PERMISSIONS.WITHDRAWAL_ADDRESSES_READ])} />
            <Route path="custody/withdrawal-addresses/:addressNo" element={withPermission(<WithdrawalAddressDetail />, [PERMISSIONS.WITHDRAWAL_ADDRESS_DETAIL_READ])} />

            {/* 平账二期：内部划转单（公司 → 客户补款 / 垫款） */}
            <Route path="treasury/internal-transfers" element={withPermission(<InternalTransferList />, [PERMISSIONS.INTERNAL_TRANSFERS_READ])} />
            <Route path="treasury/internal-transfers/:transferNo" element={withPermission(<InternalTransferDetail />, [PERMISSIONS.INTERNAL_TRANSFER_DETAIL_READ])} />

            {/* assets */}
            <Route path="assets" element={withPermission(<AssetList />, [PERMISSIONS.ASSETS_READ])} />
            <Route path="assets/:assetNo" element={withPermission(<AssetDetail />, [PERMISSIONS.ASSETS_READ])} />
            <Route path="assets/transaction-limits" element={withPermission(<TransactionLimitList />, [PERMISSIONS.TRANSACTION_LIMIT_READ])} />
            <Route path="assets/transaction-limits/:ruleNo" element={withPermission(<TransactionLimitDetail />, [PERMISSIONS.TRANSACTION_LIMIT_READ])} />

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
            <Route path="reconciliation/adjustments/:adjustmentNo" element={withPermission(<ReconciliationAdjustmentDetailPage />, [PERMISSIONS.RECON_ADJUSTMENT_DETAIL_READ])} />

            {/* ledger */}
            <Route path="ledger/accounts" element={withPermission(<LedgerAccountList />, [PERMISSIONS.TB_ACCOUNTS_READ])} />
            <Route path="ledger/accounts/:id" element={withPermission(<LedgerAccountDetail />, [PERMISSIONS.TB_ACCOUNTS_READ])} />
            <Route path="ledger/transfer-evidence" element={withPermission(<TransferEvidenceList />, [PERMISSIONS.TB_TRANSFERS_READ])} />
            <Route path="ledger/transfer-evidence/:tbTransferId" element={withPermission(<TransferEvidenceDetail />, [PERMISSIONS.TB_TRANSFER_DETAIL_READ])} />
            <Route path="ledger/flows" element={withPermission(<AccountFlowList />, [PERMISSIONS.TB_FLOWS_READ])} />

            {/* governance */}
            <Route path="governance/approvals" element={withPermission(<ApprovalsPage />, [PERMISSIONS.GOV_APPROVALS_READ])} />
            <Route path="governance/approvals/:approvalNo" element={withPermission(<ApprovalDetailPage />, [PERMISSIONS.GOV_APPROVAL_DETAIL_READ])} />
            <Route path="governance/approval-policies" element={withPermission(<ApprovalPoliciesPage />, [PERMISSIONS.GOV_APPROVAL_POLICIES_READ])} />

            {/* 平账三期：事故登记（治理件，与审批中心平级） */}
            <Route path="governance/incidents" element={withPermission(<IncidentListPage />, [PERMISSIONS.INCIDENTS_READ])} />
            <Route path="governance/incidents/:incidentNo" element={withPermission(<IncidentDetailPage />, [PERMISSIONS.INCIDENT_DETAIL_READ])} />

            {/* audit */}
            <Route path="audit/logs" element={withPermission(<AuditLogsPage />, [PERMISSIONS.AUDIT_LOGS_READ])} />
            <Route path="audit/logs/:id" element={withPermission(<AuditLogDetailPage />, [PERMISSIONS.AUDIT_LOGS_READ])} />
            <Route path="audit/evidence-packages" element={withPermission(<EvidenceExportsPage />, [PERMISSIONS.AUDIT_EVIDENCE_EXPORTS_READ])} />
            <Route path="audit/evidence-packages/:id" element={withPermission(<EvidenceExportDetailPage />, [PERMISSIONS.AUDIT_EVIDENCE_EXPORTS_READ])} />
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

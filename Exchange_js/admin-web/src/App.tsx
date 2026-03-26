import { lazy, Suspense, type ReactElement } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import AdminLogin from './pages/AdminLogin';
import AdminInviteActivate from './pages/AdminInviteActivate';
import DashboardLayout from './components/DashboardLayout';
import { useAdminSession } from './contexts/AdminSessionContext';
import { PERMISSIONS } from './rbac/permissions';

const PlatformMembers = lazy(() => import('./pages/PlatformMembers'));
const CustomerManagement = lazy(() => import('./pages/CustomerManagement'));
const PricingSwapConfigPage = lazy(() => import('./pages/PricingSwapConfigPage'));
const PricingWithdrawalConfigPage = lazy(() => import('./pages/PricingWithdrawalConfigPage'));
const SwapQuoteList = lazy(() => import('./pages/SwapQuoteList'));
const SwapQuoteDetail = lazy(() => import('./pages/SwapQuoteDetail'));
const SwapOutstandingList = lazy(() => import('./pages/SwapOutstandingList'));
const SwapOutstandingDetail = lazy(() => import('./pages/SwapOutstandingDetail'));
const OutstandingSettlementList = lazy(() => import('./pages/OutstandingSettlementList'));
const OutstandingSettlementDetail = lazy(() => import('./pages/OutstandingSettlementDetail'));
const CustomerDetail = lazy(() => import('./pages/CustomerDetail'));
const LiquidityProviderList = lazy(() => import('./pages/LiquidityProviderList'));
const LiquidityProviderCreate = lazy(() => import('./pages/LiquidityProviderCreate'));
const LiquidityConfigList = lazy(() => import('./pages/LiquidityConfigList'));
const LiquidityConfigCreate = lazy(() => import('./pages/LiquidityConfigCreate'));
const LiquidityConfigEdit = lazy(() => import('./pages/LiquidityConfigEdit'));
const WalletList = lazy(() => import('./pages/WalletList'));
const WalletDetail = lazy(() => import('./pages/WalletDetail'));
const PayinList = lazy(() => import('./pages/PayinList'));
const PayinDetail = lazy(() => import('./pages/PayinDetail'));
const PayoutList = lazy(() => import('./pages/PayoutList'));
const PayoutDetail = lazy(() => import('./pages/PayoutDetail'));
const InternalTransactionList = lazy(() => import('./pages/InternalTransactionList'));
const InternalTransactionDetail = lazy(() => import('./pages/InternalTransactionDetail'));
const InternalFundList = lazy(() => import('./pages/InternalFundList'));
const InternalFundDetail = lazy(() => import('./pages/InternalFundDetail'));
const AssetList = lazy(() => import('./pages/AssetList'));
const AssetCreate = lazy(() => import('./pages/AssetCreate'));
const DepositTransactionList = lazy(() => import('./pages/DepositTransactionList'));
const DepositTransactionDetail = lazy(() => import('./pages/DepositTransactionDetail'));
const WithdrawTransactionList = lazy(() => import('./pages/WithdrawTransactionList'));
const WithdrawTransactionDetail = lazy(() => import('./pages/WithdrawTransactionDetail'));
const SwapTransactionList = lazy(() => import('./pages/SwapTransactionList'));
const SwapTransactionDetail = lazy(() => import('./pages/SwapTransactionDetail'));
const CoaList = lazy(() => import('./pages/CoaList'));
const JournalList = lazy(() => import('./pages/JournalList'));
const JournalDetail = lazy(() => import('./pages/JournalDetail'));
const JournalLinesList = lazy(() => import('./pages/JournalLinesList'));
const JournalLineDetail = lazy(() => import('./pages/JournalLineDetail'));
const CustomerBalanceHistory = lazy(() => import('./pages/CustomerBalanceHistory'));
const AcctEventList = lazy(() => import('./pages/AcctEventList'));
const JournalHeaderTemplateList = lazy(() => import('./pages/JournalHeaderTemplateList'));
const JournalLineTemplateList = lazy(() => import('./pages/JournalLineTemplateList'));
const ClearingHeaderTemplateList = lazy(() => import('./pages/ClearingHeaderTemplateList'));
const ClearingLineTemplateList = lazy(() => import('./pages/ClearingLineTemplateList'));
const ClearingManagementList = lazy(() => import('./pages/ClearingManagementList'));
const ClearingDetail = lazy(() => import('./pages/ClearingDetail'));
const ClearingDetailsList = lazy(() => import('./pages/ClearingDetailsList'));
const ClearingLineDetail = lazy(() => import('./pages/ClearingLineDetail'));
const CddResponsesPage = lazy(() => import('./pages/CddResponsesPage'));
const EddResponsesPage = lazy(() => import('./pages/EddResponsesPage'));
const AuditLogsPage = lazy(() => import('./pages/AuditLogsPage'));
const AuditLogDetailPage = lazy(() => import('./pages/AuditLogDetailPage'));
const EvidenceExportsPage = lazy(() => import('./pages/EvidenceExportsPage'));
const EvidenceExportDetailPage = lazy(() => import('./pages/EvidenceExportDetailPage'));
const ApprovalsPage = lazy(() => import('./pages/ApprovalsPage'));
const ApprovalDetailPage = lazy(() => import('./pages/ApprovalDetailPage'));
const ChangeTicketsPage = lazy(() => import('./pages/ChangeTicketsPage'));
const ChangeTicketCreatePage = lazy(() => import('./pages/ChangeTicketCreatePage'));
const ChangeTicketDetailPage = lazy(() => import('./pages/ChangeTicketDetailPage'));
const BusinessConfigReleasesPage = lazy(() => import('./pages/BusinessConfigReleasesPage'));
const DeleteRequestsPage = lazy(() => import('./pages/DeleteRequestsPage'));
const DeleteRequestCreatePage = lazy(() => import('./pages/DeleteRequestCreatePage'));
const DeleteRequestDetailPage = lazy(() => import('./pages/DeleteRequestDetailPage'));
const SlaTimersPage = lazy(() => import('./pages/SlaTimersPage'));
const SlaTimerDetailPage = lazy(() => import('./pages/SlaTimerDetailPage'));
const ComplianceAlertsPage = lazy(() => import('./pages/ComplianceAlertsPage'));
const ComplianceAlertDetailPage = lazy(() => import('./pages/ComplianceAlertDetailPage'));
const ComplianceCasesPage = lazy(() => import('./pages/ComplianceCasesPage'));
const ComplianceCaseDetailPage = lazy(() => import('./pages/ComplianceCaseDetailPage'));
const CaseEvidenceExportsPage = lazy(() => import('./pages/CaseEvidenceExportsPage'));
const CaseEvidenceExportDetailPage = lazy(() => import('./pages/CaseEvidenceExportDetailPage'));
const TransactionKytCasesPage = lazy(() => import('./pages/TransactionKytCasesPage'));
const TransactionKytResponseDetailPage = lazy(
  () => import('./pages/TransactionKytResponseDetailPage'),
);
const TransactionTravelRuleCasesPage = lazy(
  () => import('./pages/TransactionTravelRuleCasesPage'),
);
const TransactionTravelRuleResponseDetailPage = lazy(
  () => import('./pages/TransactionTravelRuleResponseDetailPage'),
);
const TransactionComplianceCasesPage = lazy(
  () => import('./pages/TransactionComplianceCasesPage'),
);
const TransactionComplianceCaseDetailPage = lazy(
  () => import('./pages/TransactionComplianceCaseDetailPage'),
);
const RiskPolicyExecutionsPage = lazy(() => import('./pages/RiskPolicyExecutionsPage'));
const RoleManagement = lazy(() => import('./pages/RoleManagement'));

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
    return <Navigate to="/dashboard" replace />;
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
              element={withPermission(
                <div className="p-8 text-gray-500">Welcome to Admin Dashboard</div>,
                [PERMISSIONS.BASE_ACCESS],
              )}
            />
            <Route
              path="members"
              element={withPermission(<PlatformMembers />, [PERMISSIONS.USERS_READ])}
            />
            <Route
              path="members/roles"
              element={withPermission(<RoleManagement />, [PERMISSIONS.IAM_ROLES_READ])}
            />
            <Route
              path="customer/management"
              element={withPermission(<CustomerManagement />, [PERMISSIONS.CUSTOMERS_READ])}
            />
            <Route
              path="pricing/rates"
              element={<Navigate to="/dashboard/pricing/swap-config" replace />}
            />
            <Route
              path="pricing/swap-config"
              element={withPermission(<PricingSwapConfigPage />, [PERMISSIONS.PRICING_POLICIES_READ])}
            />
            <Route
              path="pricing/withdraw-config"
              element={withPermission(<PricingWithdrawalConfigPage />, [PERMISSIONS.PRICING_WITHDRAW_CONFIG_READ])}
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
              path="reconciliation/outstanding-settlements"
              element={withPermission(<OutstandingSettlementList />, [PERMISSIONS.OUTSTANDING_SETTLEMENTS_READ])}
            />
            <Route
              path="reconciliation/outstanding-settlements/:id"
              element={withPermission(<OutstandingSettlementDetail />, [PERMISSIONS.OUTSTANDING_SETTLEMENT_DETAIL_READ])}
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
              path="compliance/cdd-responses"
              element={withPermission(<CddResponsesPage />, [PERMISSIONS.CDD_RESPONSES_READ])}
            />
            <Route
              path="compliance/edd-responses"
              element={withPermission(<EddResponsesPage />, [PERMISSIONS.EDD_RESPONSES_READ])}
            />
            <Route
              path="compliance/alerts"
              element={withPermission(<ComplianceAlertsPage />, [PERMISSIONS.ALERTS_READ])}
            />
            <Route
              path="compliance/alerts/:id"
              element={withPermission(<ComplianceAlertDetailPage />, [PERMISSIONS.ALERTS_READ])}
            />
            <Route
              path="compliance/cases"
              element={withPermission(<ComplianceCasesPage />, [PERMISSIONS.CASES_READ])}
            />
            <Route
              path="compliance/cases/:id"
              element={withPermission(<ComplianceCaseDetailPage />, [PERMISSIONS.CASES_READ])}
            />
            <Route
              path="compliance/tx-kyt-responses"
              element={withPermission(<TransactionKytCasesPage />, [
                PERMISSIONS.TX_KYT_RESPONSES_READ,
              ])}
            />
            <Route
              path="compliance/tx-kyt-responses/:id"
              element={withPermission(<TransactionKytResponseDetailPage />, [
                PERMISSIONS.TX_KYT_RESPONSE_DETAIL_READ,
              ])}
            />
            <Route
              path="compliance/tx-travel-rule-responses"
              element={withPermission(<TransactionTravelRuleCasesPage />, [
                PERMISSIONS.TX_TRAVEL_RULE_RESPONSES_READ,
              ])}
            />
            <Route
              path="compliance/tx-travel-rule-responses/:id"
              element={withPermission(<TransactionTravelRuleResponseDetailPage />, [
                PERMISSIONS.TX_TRAVEL_RULE_RESPONSE_DETAIL_READ,
              ])}
            />
            <Route
              path="compliance/tx-evidence"
              element={withPermission(<TransactionComplianceCasesPage />, [
                PERMISSIONS.TX_COMPLIANCE_BUNDLE_READ,
              ])}
            />
            <Route
              path="compliance/tx-evidence/:sourceType/:sourceId"
              element={withPermission(<TransactionComplianceCaseDetailPage />, [
                PERMISSIONS.TX_COMPLIANCE_BUNDLE_READ,
              ])}
            />
            <Route
              path="compliance/case-evidence-exports"
              element={withPermission(<CaseEvidenceExportsPage />, [
                PERMISSIONS.CASE_EVIDENCE_EXPORTS_READ,
              ])}
            />
            <Route
              path="compliance/case-evidence-exports/:id"
              element={withPermission(<CaseEvidenceExportDetailPage />, [
                PERMISSIONS.CASE_EVIDENCE_EXPORT_DETAIL_READ,
              ])}
            />
            <Route
              path="compliance/audit-logs"
              element={withPermission(
                <Navigate to="/dashboard/audit/audit-logs" replace />,
                [PERMISSIONS.AUDIT_LOGS_READ],
              )}
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
              path="control-gates/change-tickets"
              element={withPermission(<ChangeTicketsPage />, [
                PERMISSIONS.GOV_CHANGE_TICKETS_READ,
              ])}
            />
            <Route
              path="control-gates/business-config-releases"
              element={withPermission(<BusinessConfigReleasesPage />, [
                PERMISSIONS.GOV_CHANGE_TICKETS_READ,
              ])}
            />
            <Route
              path="control-gates/change-tickets/create"
              element={withPermission(<ChangeTicketCreatePage />, [
                PERMISSIONS.GOV_CHANGE_TICKET_CREATE,
              ])}
            />
            <Route
              path="control-gates/change-tickets/:id"
              element={withPermission(<ChangeTicketDetailPage />, [
                PERMISSIONS.GOV_CHANGE_TICKET_DETAIL_READ,
              ])}
            />
            <Route
              path="control-gates/delete-requests"
              element={withPermission(<DeleteRequestsPage />, [
                PERMISSIONS.GOV_DELETE_REQUESTS_READ,
              ])}
            />
            <Route
              path="control-gates/delete-requests/create"
              element={withPermission(<DeleteRequestCreatePage />, [
                PERMISSIONS.GOV_DELETE_REQUEST_CREATE,
              ])}
            />
            <Route
              path="control-gates/delete-requests/:id"
              element={withPermission(<DeleteRequestDetailPage />, [
                PERMISSIONS.GOV_DELETE_REQUEST_DETAIL_READ,
              ])}
            />
            <Route
              path="control-gates/approvals"
              element={withPermission(<ApprovalsPage />, [PERMISSIONS.GOV_APPROVALS_READ])}
            />
            <Route
              path="control-gates"
              element={withPermission(
                <Navigate to="/dashboard/control-gates/change-tickets" replace />,
                [PERMISSIONS.GOV_CHANGE_TICKETS_READ, PERMISSIONS.GOV_APPROVALS_READ],
              )}
            />
            <Route
              path="control-gates/approvals/:id"
              element={withPermission(<ApprovalDetailPage />, [
                PERMISSIONS.GOV_APPROVAL_DETAIL_READ,
              ])}
            />
            <Route
              path="control-gates/sla-timers"
              element={withPermission(<SlaTimersPage />, [PERMISSIONS.GOV_SLA_TIMERS_READ])}
            />
            <Route
              path="control-gates/sla-timers/:id"
              element={withPermission(<SlaTimerDetailPage />, [
                PERMISSIONS.GOV_SLA_TIMER_DETAIL_READ,
              ])}
            />
            <Route
              path="risk/policy-executions"
              element={withPermission(<RiskPolicyExecutionsPage />, [PERMISSIONS.RISK_DECISION_RECORDS_READ])}
            />
            <Route
              path="customer/:id"
              element={withPermission(<CustomerDetail />, [PERMISSIONS.CUSTOMERS_DETAIL_READ])}
            />
            <Route
              path="treasury/wallets"
              element={withPermission(<WalletList />, [PERMISSIONS.WALLETS_READ])}
            />
            <Route
              path="treasury/wallets/:id"
              element={withPermission(<WalletDetail />, [PERMISSIONS.WALLET_DETAIL_READ])}
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
              path="treasury/internal-funds"
              element={withPermission(<InternalFundList />, [PERMISSIONS.INTERNAL_FUNDS_READ])}
            />
            <Route
              path="treasury/internal-funds/:id"
              element={withPermission(<InternalFundDetail />, [PERMISSIONS.INTERNAL_FUND_DETAIL_READ])}
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
              path="system/acct-events"
              element={withPermission(<AcctEventList />, [PERMISSIONS.ACCT_EVENTS_READ])}
            />
            <Route
              path="system/journal-header-templates"
              element={withPermission(<JournalHeaderTemplateList />, [PERMISSIONS.JOURNAL_HEADER_TEMPLATES_READ])}
            />
            <Route
              path="system/journal-line-templates"
              element={withPermission(<JournalLineTemplateList />, [PERMISSIONS.JOURNAL_LINE_TEMPLATES_READ])}
            />
            <Route
              path="system/clearing-header-templates"
              element={withPermission(<ClearingHeaderTemplateList />, [PERMISSIONS.CLEARING_TEMPLATES_READ])}
            />
            <Route
              path="system/clearing-line-templates"
              element={withPermission(<ClearingLineTemplateList />, [PERMISSIONS.CLEARING_TEMPLATES_READ])}
            />
          </Route>

          <Route path="/exchange">
            <Route
              path="deposit-transactions"
              element={withPermission(<DepositTransactionList />, [PERMISSIONS.DEPOSIT_TRANSACTIONS_READ])}
            />
            <Route
              path="deposit-transactions/:id"
              element={withPermission(<DepositTransactionDetail />, [PERMISSIONS.DEPOSIT_TRANSACTION_DETAIL_READ])}
            />
            <Route
              path="withdraw-transactions"
              element={withPermission(<WithdrawTransactionList />, [PERMISSIONS.WITHDRAW_TRANSACTIONS_READ])}
            />
            <Route
              path="withdraw-transactions/:id"
              element={withPermission(<WithdrawTransactionDetail />, [PERMISSIONS.WITHDRAW_TRANSACTION_DETAIL_READ])}
            />
            <Route
              path="swap-transactions"
              element={withPermission(<SwapTransactionList />, [PERMISSIONS.SWAP_TRANSACTIONS_READ])}
            />
            <Route
              path="swap-transactions/:id"
              element={withPermission(<SwapTransactionDetail />, [PERMISSIONS.SWAP_TRANSACTION_DETAIL_READ])}
            />
            <Route
              path="internal-transactions"
              element={withPermission(<InternalTransactionList />, [PERMISSIONS.INTERNAL_TRANSACTIONS_READ])}
            />
            <Route
              path="internal-transactions/:id"
              element={withPermission(<InternalTransactionDetail />, [PERMISSIONS.INTERNAL_TRANSACTION_DETAIL_READ])}
            />
          </Route>

          <Route path="/ledger">
            <Route path="coa" element={withPermission(<CoaList />, [PERMISSIONS.COA_READ])} />
            <Route path="journals" element={withPermission(<JournalList />, [PERMISSIONS.JOURNALS_READ])} />
            <Route
              path="journals/:id"
              element={withPermission(<JournalDetail />, [PERMISSIONS.JOURNAL_DETAIL_READ])}
            />
            <Route
              path="journal-lines"
              element={withPermission(<JournalLinesList />, [PERMISSIONS.JOURNAL_LINES_READ])}
            />
            <Route
              path="journal-lines/:id"
              element={withPermission(<JournalLineDetail />, [PERMISSIONS.JOURNAL_LINE_DETAIL_READ])}
            />
            <Route
              path="balance-history"
              element={withPermission(<CustomerBalanceHistory />, [PERMISSIONS.CUSTOMER_BALANCE_HISTORY_READ])}
            />
          </Route>

          <Route path="/clearing">
            <Route
              path="management"
              element={withPermission(<ClearingManagementList />, [PERMISSIONS.CLEARINGS_READ])}
            />
            <Route
              path="management/:id"
              element={withPermission(<ClearingDetail />, [PERMISSIONS.CLEARING_DETAIL_READ])}
            />
            <Route
              path="details"
              element={withPermission(<ClearingDetailsList />, [PERMISSIONS.CLEARING_LINES_READ])}
            />
            <Route
              path="lines/:id"
              element={withPermission(<ClearingLineDetail />, [PERMISSIONS.CLEARING_LINE_DETAIL_READ])}
            />
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

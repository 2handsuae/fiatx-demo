import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import type { ReactElement } from 'react';
import AdminLogin from './pages/AdminLogin';
import AdminInviteActivate from './pages/AdminInviteActivate';
import DashboardLayout from './components/DashboardLayout';
import PlatformMembers from './pages/PlatformMembers';
import CustomerManagement from './pages/CustomerManagement';
import CustomerSwapRateList from './pages/CustomerSwapRateList';
import CustomerSwapRateCreate from './pages/CustomerSwapRateCreate';
import CustomerSwapRateEdit from './pages/CustomerSwapRateEdit';
import SwapQuoteList from './pages/SwapQuoteList';
import SwapQuoteDetail from './pages/SwapQuoteDetail';
import SwapOutstandingList from './pages/SwapOutstandingList';
import SwapOutstandingDetail from './pages/SwapOutstandingDetail';
import OutstandingSettlementList from './pages/OutstandingSettlementList';
import OutstandingSettlementDetail from './pages/OutstandingSettlementDetail';
import CustomerDetail from './pages/CustomerDetail';
import LiquidityProviderList from './pages/LiquidityProviderList';
import LiquidityProviderCreate from './pages/LiquidityProviderCreate';
import LiquidityConfigList from './pages/LiquidityConfigList';
import LiquidityConfigCreate from './pages/LiquidityConfigCreate';
import LiquidityConfigEdit from './pages/LiquidityConfigEdit';
import WalletList from './pages/WalletList';
import WalletDetail from './pages/WalletDetail';
import PayinList from './pages/PayinList';
import PayinDetail from './pages/PayinDetail';
import PayoutList from './pages/PayoutList';
import PayoutDetail from './pages/PayoutDetail';
import InternalTransactionList from './pages/InternalTransactionList';
import InternalTransactionDetail from './pages/InternalTransactionDetail';
import InternalFundList from './pages/InternalFundList';
import InternalFundDetail from './pages/InternalFundDetail';
import AssetList from './pages/AssetList';
import AssetCreate from './pages/AssetCreate';
import DepositTransactionList from './pages/DepositTransactionList';
import DepositTransactionDetail from './pages/DepositTransactionDetail';
import WithdrawTransactionList from './pages/WithdrawTransactionList';
import WithdrawTransactionDetail from './pages/WithdrawTransactionDetail';
import SwapTransactionList from './pages/SwapTransactionList';
import SwapTransactionDetail from './pages/SwapTransactionDetail';
import CoaList from './pages/CoaList';
import JournalList from './pages/JournalList';
import JournalDetail from './pages/JournalDetail';
import JournalLinesList from './pages/JournalLinesList';
import JournalLineDetail from './pages/JournalLineDetail';
import CustomerBalanceHistory from './pages/CustomerBalanceHistory';
import AcctEventList from './pages/AcctEventList';
import JournalHeaderTemplateList from './pages/JournalHeaderTemplateList';
import JournalLineTemplateList from './pages/JournalLineTemplateList';
import ClearingHeaderTemplateList from './pages/ClearingHeaderTemplateList';
import ClearingLineTemplateList from './pages/ClearingLineTemplateList';
import ClearingManagementList from './pages/ClearingManagementList';
import ClearingDetail from './pages/ClearingDetail';
import ClearingDetailsList from './pages/ClearingDetailsList';
import ClearingLineDetail from './pages/ClearingLineDetail';
import CddCasesPage from './pages/CddCasesPage';
import EddCasesPage from './pages/EddCasesPage';
import AuditLogsPage from './pages/AuditLogsPage';
import AuditLogDetailPage from './pages/AuditLogDetailPage';
import EvidenceExportsPage from './pages/EvidenceExportsPage';
import EvidenceExportDetailPage from './pages/EvidenceExportDetailPage';
import ApprovalsPage from './pages/ApprovalsPage';
import ApprovalDetailPage from './pages/ApprovalDetailPage';
import ChangeTicketsPage from './pages/ChangeTicketsPage';
import ChangeTicketCreatePage from './pages/ChangeTicketCreatePage';
import ChangeTicketDetailPage from './pages/ChangeTicketDetailPage';
import DeleteRequestsPage from './pages/DeleteRequestsPage';
import DeleteRequestCreatePage from './pages/DeleteRequestCreatePage';
import DeleteRequestDetailPage from './pages/DeleteRequestDetailPage';
import SlaTimersPage from './pages/SlaTimersPage';
import SlaTimerDetailPage from './pages/SlaTimerDetailPage';
import ComplianceAlertsPage from './pages/ComplianceAlertsPage';
import ComplianceIncidentsPage from './pages/ComplianceIncidentsPage';
import CaseEvidenceExportsPage from './pages/CaseEvidenceExportsPage';
import CaseEvidenceExportDetailPage from './pages/CaseEvidenceExportDetailPage';
import RiskPolicyExecutionsPage from './pages/RiskPolicyExecutionsPage';
import RoleManagement from './pages/RoleManagement';
import { useAdminSession } from './contexts/AdminSessionContext';
import { PERMISSIONS } from './rbac/permissions';

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
  <RequirePermission permissions={permissions}>{element}</RequirePermission>
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
              element={withPermission(<CustomerSwapRateList />, [PERMISSIONS.CUSTOMER_SWAP_RATES_READ])}
            />
            <Route
              path="pricing/rates/create"
              element={withPermission(<CustomerSwapRateCreate />, [PERMISSIONS.CUSTOMER_SWAP_RATES_WRITE])}
            />
            <Route
              path="pricing/rates/edit/:id"
              element={withPermission(<CustomerSwapRateEdit />, [PERMISSIONS.CUSTOMER_SWAP_RATES_EDIT])}
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
              path="compliance/cdd-cases"
              element={withPermission(<CddCasesPage />, [PERMISSIONS.CDD_CASES_READ])}
            />
            <Route
              path="compliance/edd-cases"
              element={withPermission(<EddCasesPage />, [PERMISSIONS.EDD_CASES_READ])}
            />
            <Route
              path="compliance/alerts"
              element={withPermission(<ComplianceAlertsPage />, [PERMISSIONS.ALERTS_READ])}
            />
            <Route
              path="compliance/cases"
              element={withPermission(<ComplianceIncidentsPage />, [PERMISSIONS.CASES_READ])}
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
              path="compliance/incidents"
              element={withPermission(
                <Navigate to="/dashboard/compliance/cases" replace />,
                [PERMISSIONS.CASES_READ],
              )}
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

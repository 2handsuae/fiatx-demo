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
const PricingWithdrawalConfigPage = lazy(() => import('./pages/PricingWithdrawalConfigPage'));
const SwapQuoteList = lazy(() => import('./pages/SwapQuoteList'));
const SwapQuoteDetail = lazy(() => import('./pages/SwapQuoteDetail'));
const SwapOutstandingList = lazy(() => import('./pages/SwapOutstandingList'));
const SwapOutstandingDetail = lazy(() => import('./pages/SwapOutstandingDetail'));
const SafeguardingBreakList = lazy(() => import('./pages/SafeguardingBreakList'));
const SafeguardingBreakDetail = lazy(() => import('./pages/SafeguardingBreakDetail'));
const OutstandingSettlementList = lazy(() => import('./pages/OutstandingSettlementList'));
const OutstandingSettlementDetail = lazy(() => import('./pages/OutstandingSettlementDetail'));
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
const InternalTransactionList = lazy(() => import('./pages/InternalTransactionList'));
const InternalTransactionDetail = lazy(() => import('./pages/InternalTransactionDetail'));
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
const CddResponsesPage = lazy(() => import('./pages/CddResponsesPage'));
const EddResponsesPage = lazy(() => import('./pages/EddResponsesPage'));
const AuditLogsPage = lazy(() => import('./pages/AuditLogsPage'));
const AuditLogDetailPage = lazy(() => import('./pages/AuditLogDetailPage'));
const SumsubEventsPage = lazy(() => import('./pages/SumsubEventsPage'));
const EvidenceExportsPage = lazy(() => import('./pages/EvidenceExportsPage'));
const EvidenceExportDetailPage = lazy(() => import('./pages/EvidenceExportDetailPage'));
const ApprovalsPage = lazy(() => import('./pages/ApprovalsPage'));
const ApprovalDetailPage = lazy(() => import('./pages/ApprovalDetailPage'));
const BusinessConfigReleasesPage = lazy(() => import('./pages/BusinessConfigReleasesPage'));
const GovernanceRegistryListPage = lazy(() => import('./pages/GovernanceRegistryListPage'));
const GovernanceRegistryDetailPage = lazy(() => import('./pages/GovernanceRegistryDetailPage'));
const GovernanceRegistryCreatePage = lazy(() => import('./pages/GovernanceRegistryCreatePage'));
const GovernanceRegistryEditPage = lazy(() => import('./pages/GovernanceRegistryEditPage'));
const RegulatoryGateListPage = lazy(() => import('./pages/RegulatoryGateListPage'));
const RegulatoryGateDetailPage = lazy(() => import('./pages/RegulatoryGateDetailPage'));
const RegulatoryGateCreatePage = lazy(() => import('./pages/RegulatoryGateCreatePage'));
const Wave8OpsDashboardPage = lazy(() => import('./pages/Wave8OpsDashboardPage'));
const TreasuryResourcePage = lazy(() => import('./pages/TreasuryResourcePage'));
const TreasuryResourceDetailPage = lazy(() => import('./pages/TreasuryResourceDetailPage'));
const PoolSettlementBatchListPage = lazy(
  () => import('./pages/PoolSettlementBatchListPage'),
);
const PoolSettlementBatchDetailPage = lazy(
  () => import('./pages/PoolSettlementBatchDetailPage'),
);
const InternalCollectionsPage = lazy(() => import('./pages/InternalCollectionsPage'));
const ReconciliationResourcePage = lazy(() => import('./pages/ReconciliationResourcePage'));
const ReconciliationResourceDetailPage = lazy(
  () => import('./pages/ReconciliationResourceDetailPage'),
);
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
const PricingPolicyList = lazy(() => import('./pages/PricingPolicyList'));
const PricingPolicyHistory = lazy(() => import('./pages/PricingPolicyHistory'));
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
              path="pricing/rates"
              element={<Navigate to="/dashboard/pricing/swap-config" replace />}
            />
            <Route
              path="pricing/policies"
              element={withPermission(<PricingPolicyList />, [PERMISSIONS.PRICING_POLICIES_READ])}
            />
            <Route
              path="pricing/policies/history"
              element={withPermission(<PricingPolicyHistory />, [PERMISSIONS.PRICING_POLICIES_READ])}
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
              path="pricing/withdraw-quotes"
              element={withPermission(<WithdrawQuoteList />, [PERMISSIONS.WITHDRAW_QUOTES_READ])}
            />
            <Route
              path="pricing/withdraw-quotes/:id"
              element={withPermission(<WithdrawQuoteDetail />, [PERMISSIONS.WITHDRAW_QUOTES_DETAIL_READ])}
            />
            <Route
              path="reconciliation/safeguarding-breaks"
              element={withPermission(<SafeguardingBreakList />, [
                PERMISSIONS.SAFEGUARDING_BREAKS_READ,
              ])}
            />
            <Route
              path="reconciliation/safeguarding-breaks/:id"
              element={withPermission(<SafeguardingBreakDetail />, [
                PERMISSIONS.SAFEGUARDING_BREAK_DETAIL_READ,
              ])}
            />
            <Route
              path="reconciliation/safeguarding-warnings"
              element={withPermission(
                <ReconciliationResourcePage resourceType="warnings" />,
                [PERMISSIONS.SAFEGUARDING_WARNINGS_READ],
              )}
            />
            <Route
              path="reconciliation/safeguarding-warnings/:id"
              element={withPermission(
                <ReconciliationResourceDetailPage resourceType="warnings" />,
                [PERMISSIONS.SAFEGUARDING_WARNING_DETAIL_READ],
              )}
            />
            <Route
              path="reconciliation/safeguarding-runs"
              element={withPermission(
                <ReconciliationResourcePage resourceType="runs" />,
                [PERMISSIONS.SAFEGUARDING_RUNS_READ],
              )}
            />
            <Route
              path="reconciliation/safeguarding-runs/:id"
              element={withPermission(
                <ReconciliationResourceDetailPage resourceType="runs" />,
                [PERMISSIONS.SAFEGUARDING_RUN_DETAIL_READ],
              )}
            />
            <Route
              path="reconciliation/safeguarding-fiat-statements"
              element={withPermission(
                <ReconciliationResourcePage resourceType="fiat-statements" />,
                [PERMISSIONS.SAFEGUARDING_FIAT_IMPORTS_READ],
              )}
            />
            <Route
              path="reconciliation/safeguarding-fiat-statements/:id"
              element={withPermission(
                <ReconciliationResourceDetailPage resourceType="fiat-statements" />,
                [PERMISSIONS.SAFEGUARDING_FIAT_IMPORT_DETAIL_READ],
              )}
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
              path="compliance/sumsub-events"
              element={withPermission(<SumsubEventsPage />, [PERMISSIONS.SUMSUB_EVENTS_READ])}
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
              path="control-gates/business-config-releases"
              element={withPermission(<BusinessConfigReleasesPage />, [
                PERMISSIONS.GOV_APPROVALS_READ,
              ])}
            />
            <Route
              path="control-gates/approvals"
              element={withPermission(<ApprovalsPage />, [PERMISSIONS.GOV_APPROVALS_READ])}
            />
            <Route
              path="control-gates"
              element={withPermission(
                <Navigate to="/dashboard/control-gates/approvals" replace />,
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
              path="risk/policy-executions"
              element={withPermission(<RiskPolicyExecutionsPage />, [PERMISSIONS.RISK_DECISION_RECORDS_READ])}
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
              path="treasury/pool-settlement-batches"
              element={withPermission(<PoolSettlementBatchListPage />, [
                PERMISSIONS.POOL_SETTLEMENT_BATCH_READ,
              ])}
            />
            <Route
              path="treasury/pool-settlement-batches/:id"
              element={withPermission(<PoolSettlementBatchDetailPage />, [
                PERMISSIONS.POOL_SETTLEMENT_BATCH_DETAIL,
              ])}
            />
            <Route
              path="treasury/fee-occurrences"
              element={withPermission(
                <TreasuryResourcePage resourceType="fee-occurrences" />,
                [PERMISSIONS.FEE_OCCURRENCES_READ],
              )}
            />
            <Route
              path="treasury/fee-occurrences/:id"
              element={withPermission(
                <TreasuryResourceDetailPage resourceType="fee-occurrences" />,
                [PERMISSIONS.FEE_OCCURRENCE_DETAIL_READ],
              )}
            />
            <Route
              path="treasury/reimbursement-obligations"
              element={withPermission(
                <TreasuryResourcePage resourceType="reimbursement-obligations" />,
                [PERMISSIONS.REIMBURSEMENT_OBLIGATIONS_READ],
              )}
            />
            <Route
              path="treasury/reimbursement-obligations/:id"
              element={withPermission(
                <TreasuryResourceDetailPage resourceType="reimbursement-obligations" />,
                [PERMISSIONS.REIMBURSEMENT_OBLIGATION_DETAIL_READ],
              )}
            />
            <Route
              path="treasury/deposit-wallet-monitor"
              element={withPermission(<InternalCollectionsPage />, [
                PERMISSIONS.INTERNAL_COLLECTIONS_RECONCILE,
              ])}
            />
            <Route
              path="treasury/internal-collections"
              element={<Navigate to="/dashboard/treasury/deposit-wallet-monitor" replace />}
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

          <Route path="/funds-layer">
            <Route
              path="transfers"
              element={withPermission(<InternalTransferListPage />, [PERMISSIONS.FUNDS_LAYER_TRANSFERS_READ])}
            />
            <Route
              path="transfers/:internalTxNo"
              element={withPermission(<InternalTransferDetailPage />, [PERMISSIONS.FUNDS_LAYER_TRANSFER_DETAIL_READ])}
            />
            <Route
              path="settlements"
              element={withPermission(<SettlementListPage />, [PERMISSIONS.FUNDS_LAYER_SETTLEMENTS_READ])}
            />
            <Route
              path="settlements/:batchNo"
              element={withPermission(<SettlementDetailPage />, [PERMISSIONS.FUNDS_LAYER_SETTLEMENT_DETAIL_READ])}
            />
            <Route
              path="funds"
              element={withPermission(<InternalFundListPage />, [PERMISSIONS.FUNDS_LAYER_FUNDS_READ])}
            />
            <Route
              path="funds/:internalFundNo"
              element={withPermission(<InternalFundDetailPage />, [PERMISSIONS.FUNDS_LAYER_FUND_DETAIL_READ])}
            />
          </Route>

          <Route path="/ledger">
            <Route
              path="accounts"
              element={withPermission(<LedgerAccountList />, [PERMISSIONS.TB_ACCOUNTS_READ])}
            />
            <Route
              path="accounts/:id"
              element={withPermission(<LedgerAccountDetail />, [PERMISSIONS.TB_ACCOUNTS_READ])}
            />
            <Route
              path="transfers"
              element={withPermission(<TransferEvidenceList />, [PERMISSIONS.TB_TRANSFERS_READ])}
            />
            <Route
              path="transfers/:tbTransferId"
              element={withPermission(<TransferEvidenceDetail />, [PERMISSIONS.TB_TRANSFER_DETAIL_READ])}
            />
            <Route
              path="account-statement"
              element={withPermission(<AccountStatementPage />, [PERMISSIONS.TB_ACCOUNTS_READ])}
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

import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Building2, Clock, ShieldCheck, User } from 'lucide-react';
import CaseBoundCustomerControlModal, {
  type CustomerControlAction,
} from '../components/CaseBoundCustomerControlModal';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

interface CorporateProfile {
  companyName: string;
  registrationNo: string;
  incorporationCountry: string;
  registeredAddress?: string | null;
  licenseType?: string | null;
  licenseNumber?: string | null;
}

interface UboProfile {
  id: string;
  fullName: string;
  ownershipPercent?: number | null;
  nationality?: string | null;
  pepFlag?: boolean;
  status: string;
}

interface ComplianceCase {
  id: string;
  responseNo: string;
  responseType?: string | null;
  status: string;
  subjectKind: string;
  subjectRefId: string;
  journeyId: string;
  workflow?: string | null;
  periodicReviewCycleId?: string | null;
  requiresEdd?: boolean;
  reviewedAt?: string | null;
  createdAt: string;
}

interface PeriodicReviewCycleSummary {
  id: string;
  cycleNo: string;
  status: string;
  dueAt?: string | null;
  triggeredAt?: string | null;
  clearedAt?: string | null;
  rejectedAt?: string | null;
  currentCddResponseId?: string | null;
  currentEddResponseId?: string | null;
  primaryAlertId?: string | null;
  primaryIncidentId?: string | null;
  resolutionReason?: string | null;
}

interface OnboardingLog {
  id: string;
  action: string;
  actorId: string;
  actorRole: string;
  fromStage?: string | null;
  toStage?: string | null;
  caseType?: string | null;
  caseId?: string | null;
  detail?: string | null;
  createdAt: string;
}

interface CustomerDetailData {
  id: string;
  customerNo: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  customerType: string;
  onboardingStatus?: string;
  operatingStatus?: string;
  restrictionStatus?: string;
  restrictionCaseId?: string | null;
  restrictionReason?: string | null;
  restrictionSetAt?: string | null;
  restrictionReleasedAt?: string | null;
  complianceHoldStatus?: string;
  complianceHoldCaseId?: string | null;
  complianceHoldReason?: string | null;
  complianceHoldSetAt?: string | null;
  complianceHoldReleasedAt?: string | null;
  amlRiskTier: string;
  eddRequired: boolean;
  cddDocumentExpiresAt?: string | null;
  latestFinalApprovalId?: string | null;
  latestFinalApprovalStatus?: string | null;
  latestFinalApproval?: {
    id: string;
    approvalNo: string;
    status: string;
    decidedAt?: string | null;
    decisionByRole?: string | null;
  } | null;
  nextReviewAt?: string | null;
  activePeriodicReviewCycleId?: string | null;
  periodicReviewOverdueAt?: string | null;
  periodicReviewOverdueReason?: string | null;
  activePeriodicReviewCycle?: PeriodicReviewCycleSummary | null;
  investorClassification: string;
  investorClassificationSource: string;
  investorClassificationUpdatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  corporateProfile?: CorporateProfile | null;
  uboProfiles?: UboProfile[];
  cddResponses?: ComplianceCase[];
  eddResponses?: ComplianceCase[];
  onboardingAuditLogs?: OnboardingLog[];
}

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const CustomerDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [customer, setCustomer] = useState<CustomerDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingClassification, setUpdatingClassification] = useState(false);
  const [submittingFinalApproval, setSubmittingFinalApproval] = useState(false);
  const [simulatingExpired, setSimulatingExpired] = useState(false);
  const [triggeringPeriodicReview, setTriggeringPeriodicReview] = useState(false);
  const [controlAction, setControlAction] = useState<CustomerControlAction | null>(null);

  const fetchCustomer = async () => {
    try {
      const response = await adminFetch(`${import.meta.env.VITE_API_URL}/customers/${id}`);

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load data.'));
      }

      setCustomer((await response.json()) as CustomerDetailData);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) {
        return;
      }
      setError(getErrorMessage(e, 'Failed to load data.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) {
      fetchCustomer();
    }
  }, [id, navigate]);

  const fullName = useMemo(() => {
    if (!customer) return '-';
    if (customer.customerType === 'CORPORATE') {
      return customer.companyName || customer.corporateProfile?.companyName || customer.customerNo;
    }
    const name = `${customer.firstName || ''} ${customer.lastName || ''}`.trim();
    return name || customer.customerNo;
  }, [customer]);

  const updateInvestorClassification = async () => {
    if (!customer) return;

    const classification = (window.prompt('Classification: RETAIL | QUALIFIED | INSTITUTIONAL', customer.investorClassification || 'RETAIL') || '').trim().toUpperCase();
    if (!['RETAIL', 'QUALIFIED', 'INSTITUTIONAL'].includes(classification)) {
      return;
    }

    const reason = window.prompt('Please provide reason for override', '') || '';
    if (!reason.trim()) {
      return;
    }

    try {
      setUpdatingClassification(true);
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/customers/${customer.id}/investor-classification`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            classification,
            reason,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to update classification'));
      }

      await fetchCustomer();
    } catch (e) {
      if (e instanceof AdminSessionError) {
        return;
      }
      alert(getErrorMessage(e, 'Failed to update classification'));
    } finally {
      setUpdatingClassification(false);
    }
  };

  const simulateExpired = async () => {
    if (!customer) return;
    if (!window.confirm('Simulate CDD document expiration for this customer?')) return;

    try {
      setSimulatingExpired(true);
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/customers/${customer.id}/simulate-expired`,
        {
          method: 'POST',
        },
      );

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to simulate expired'));
      }

      await fetchCustomer();
    } catch (e) {
      if (e instanceof AdminSessionError) {
        return;
      }
      alert(getErrorMessage(e, 'Failed to simulate expired'));
    } finally {
      setSimulatingExpired(false);
    }
  };

  const submitFinalApproval = async () => {
    if (!customer) return;

    try {
      setSubmittingFinalApproval(true);
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/customers/${customer.id}/final-approval/submit`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        },
      );

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to submit final approval'));
      }

      const data = (await response.json()) as { id?: string };
      if (data.id) {
        navigate(`/dashboard/control-gates/approvals/${data.id}`);
        return;
      }

      await fetchCustomer();
    } catch (e) {
      if (e instanceof AdminSessionError) {
        return;
      }
      alert(getErrorMessage(e, 'Failed to submit final approval'));
    } finally {
      setSubmittingFinalApproval(false);
    }
  };

  const triggerPeriodicReview = async () => {
    if (!customer) return;

    const reason =
      window.prompt('Periodic review trigger reason', 'Periodic review due')?.trim() ||
      'Periodic review due';

    try {
      setTriggeringPeriodicReview(true);
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/customers/${customer.id}/periodic-review/trigger`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ reason }),
        },
      );

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to trigger periodic review'));
      }

      await fetchCustomer();
    } catch (e) {
      if (e instanceof AdminSessionError) {
        return;
      }
      alert(getErrorMessage(e, 'Failed to trigger periodic review'));
    } finally {
      setTriggeringPeriodicReview(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary"></div>
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="p-8 text-center bg-white rounded-xl shadow-sm border border-admin-border">
        <div className="text-red-500 mb-4">{error || 'Customer not found'}</div>
        <button onClick={() => navigate(-1)} className="text-brand-primary hover:underline font-medium">
          Go Back
        </button>
      </div>
    );
  }

  const latestApprovalStatus =
    customer.latestFinalApprovalStatus || customer.latestFinalApproval?.status || '-';
  const canSubmitFinalApproval =
    customer.onboardingStatus === 'FINAL_APPROVAL' &&
    (!customer.latestFinalApprovalId ||
      ['CANCELLED', 'EXPIRED'].includes(latestApprovalStatus));
  const canTriggerPeriodicReview =
    customer.onboardingStatus === 'APPROVED' && customer.operatingStatus === 'ACTIVE';

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      <div className="bg-white p-6 rounded-xl border border-admin-border shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-gray-100 rounded-lg border border-admin-border transition-colors"
          >
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{fullName}</h1>
            <div className="text-sm text-gray-500 mt-1 flex flex-wrap gap-3">
              <span className="font-mono text-brand-primary">{customer.customerNo}</span>
              <span>{customer.customerType}</span>
              <span>{customer.email || '-'}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <StatusBadge label="Onboarding" value={customer.onboardingStatus || 'NONE'} />
          <StatusBadge label="Operating" value={customer.operatingStatus || 'INACTIVE'} />
          <StatusBadge label="Restriction" value={customer.restrictionStatus || 'CLEAR'} />
          <StatusBadge label="Hold" value={customer.complianceHoldStatus || 'ACTIVE'} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Subject" icon={<User size={16} />}>
          <KeyValue label="Customer Type" value={customer.customerType} />
          <KeyValue label="Company Name" value={customer.companyName || customer.corporateProfile?.companyName || '-'} />
          <KeyValue label="First Name" value={customer.firstName || '-'} />
          <KeyValue label="Last Name" value={customer.lastName || '-'} />
          <KeyValue label="Created At" value={new Date(customer.createdAt).toLocaleString()} />
        </Card>

        <Card title="Compliance Snapshot" icon={<ShieldCheck size={16} />}>
          <p className="mb-4 text-xs text-gray-500">
            Canonical statuses and workflow summaries below are the runtime source of truth.
          </p>
          <KeyValue label="Onboarding Status" value={customer.onboardingStatus || 'NONE'} />
          <KeyValue label="Operating Status" value={customer.operatingStatus || 'INACTIVE'} />
          <KeyValue label="Restriction Status" value={customer.restrictionStatus || 'CLEAR'} />
          <KeyValue label="Compliance Hold Status" value={customer.complianceHoldStatus || 'ACTIVE'} />
          <KeyValue label="Restriction Case" value={customer.restrictionCaseId || '-'} />
          <KeyValue label="Restriction Reason" value={customer.restrictionReason || '-'} />
          <KeyValue label="Restriction Set At" value={formatMaybeTime(customer.restrictionSetAt)} />
          <KeyValue
            label="Restriction Released At"
            value={formatMaybeTime(customer.restrictionReleasedAt)}
          />
          <KeyValue label="AML Risk Tier" value={customer.amlRiskTier} />
          <KeyValue label="EDD Required" value={customer.eddRequired ? 'YES' : 'NO'} />
          <KeyValue label="Hold Case" value={customer.complianceHoldCaseId || '-'} />
          <KeyValue label="Hold Reason" value={customer.complianceHoldReason || '-'} />
          <KeyValue label="Hold Set At" value={formatMaybeTime(customer.complianceHoldSetAt)} />
          <KeyValue
            label="Hold Released At"
            value={formatMaybeTime(customer.complianceHoldReleasedAt)}
          />
          <KeyValue label="CDD Doc Expires At" value={formatMaybeTime(customer.cddDocumentExpiresAt)} />
          <KeyValue label="Next Review" value={formatMaybeTime(customer.nextReviewAt)} />
          <KeyValue label="Last Updated" value={new Date(customer.updatedAt).toLocaleString()} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={simulateExpired}
              disabled={simulatingExpired}
              className="px-3 py-2 text-xs rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
            >
              {simulatingExpired ? 'Mocking...' : 'Mock Auto Expire'}
            </button>
            <button
              onClick={() => setControlAction('RESTRICT')}
              disabled={customer.restrictionStatus === 'RESTRICTED'}
              className="px-3 py-2 text-xs rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60"
            >
              Restrict
            </button>
            <button
              onClick={() => setControlAction('UNRESTRICT')}
              disabled={customer.restrictionStatus !== 'RESTRICTED'}
              className="px-3 py-2 text-xs rounded-lg bg-lime-600 text-white hover:bg-lime-700 disabled:opacity-60"
            >
              Unrestrict
            </button>
            <button
              onClick={() => setControlAction('FREEZE')}
              disabled={customer.complianceHoldStatus === 'FROZEN'}
              className="px-3 py-2 text-xs rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60"
            >
              Freeze
            </button>
            <button
              onClick={() => setControlAction('UNFREEZE')}
              disabled={customer.complianceHoldStatus !== 'FROZEN'}
              className="px-3 py-2 text-xs rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              Unfreeze
            </button>
          </div>
        </Card>
      </div>

      <Card title="Compatibility Snapshot" icon={<ShieldCheck size={16} />}>
        <p className="mb-4 text-xs text-gray-500">
          Legacy compatibility fields have been retired from the customer payload. Remaining workflow summaries are shown in the canonical cards above and below.
        </p>
        <div className="text-sm text-gray-600">
          Stage 5 removed legacy customer status, account, final-approval mirror, and pointer fields from the customer read-model.
        </div>
      </Card>

      <Card title="Final Approval" icon={<ShieldCheck size={16} />}>
        <p className="mb-4 text-xs text-gray-500">
          Approval workflow summary below is canonical.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <KeyValue label="Approval No" value={customer.latestFinalApproval?.approvalNo || '-'} />
          <KeyValue label="Approval Status" value={latestApprovalStatus} />
          <KeyValue label="Decision By Role" value={customer.latestFinalApproval?.decisionByRole || '-'} />
          <KeyValue
            label="Decision At"
            value={formatMaybeTime(customer.latestFinalApproval?.decidedAt)}
          />
        </div>
        {(canSubmitFinalApproval || customer.latestFinalApprovalId) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {canSubmitFinalApproval && (
              <button
                onClick={() => void submitFinalApproval()}
                disabled={submittingFinalApproval}
                className="px-3 py-2 text-xs rounded-lg bg-brand-primary text-white hover:bg-brand-primary/90 disabled:opacity-60"
              >
                {submittingFinalApproval
                  ? 'Submitting...'
                  : customer.latestFinalApprovalId
                    ? 'Resubmit Final Approval'
                    : 'Create Final Approval'}
              </button>
            )}
            {customer.latestFinalApprovalId && (
              <button
                onClick={() =>
                  navigate(
                    `/dashboard/control-gates/approvals/${customer.latestFinalApprovalId}`,
                  )
                }
                className="px-3 py-2 text-xs rounded-lg border border-admin-border text-gray-700 hover:bg-gray-50"
              >
                Open Final Approval
              </button>
            )}
          </div>
        )}
      </Card>

      <Card title="Periodic Review" icon={<Clock size={16} />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <KeyValue
            label="Active Cycle"
            value={
              customer.activePeriodicReviewCycle?.cycleNo ||
              customer.activePeriodicReviewCycleId ||
              '-'
            }
          />
          <KeyValue
            label="Cycle Status"
            value={customer.activePeriodicReviewCycle?.status || '-'}
          />
          <KeyValue label="Next Review At" value={formatMaybeTime(customer.nextReviewAt)} />
          <KeyValue
            label="Overdue At"
            value={formatMaybeTime(customer.periodicReviewOverdueAt)}
          />
          <KeyValue
            label="Overdue Reason"
            value={customer.periodicReviewOverdueReason || '-'}
          />
          <KeyValue
            label="Current PRR CDD Response"
            value={customer.activePeriodicReviewCycle?.currentCddResponseId || '-'}
          />
          <KeyValue
            label="Current PRR EDD Response"
            value={customer.activePeriodicReviewCycle?.currentEddResponseId || '-'}
          />
          <KeyValue
            label="Primary Alert"
            value={customer.activePeriodicReviewCycle?.primaryAlertId || '-'}
          />
          <KeyValue
            label="Primary Case"
            value={customer.activePeriodicReviewCycle?.primaryIncidentId || '-'}
          />
          <KeyValue
            label="Triggered At"
            value={formatMaybeTime(customer.activePeriodicReviewCycle?.triggeredAt)}
          />
          <KeyValue
            label="Cleared At"
            value={formatMaybeTime(customer.activePeriodicReviewCycle?.clearedAt)}
          />
          <KeyValue
            label="Rejected At"
            value={formatMaybeTime(customer.activePeriodicReviewCycle?.rejectedAt)}
          />
          <KeyValue
            label="Resolution Reason"
            value={customer.activePeriodicReviewCycle?.resolutionReason || '-'}
          />
          <KeyValue
            label="Cycle Due At"
            value={formatMaybeTime(customer.activePeriodicReviewCycle?.dueAt)}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => void triggerPeriodicReview()}
            disabled={!canTriggerPeriodicReview || triggeringPeriodicReview}
            className="px-3 py-2 text-xs rounded-lg bg-brand-primary text-white hover:bg-brand-primary/90 disabled:opacity-60"
          >
            {triggeringPeriodicReview ? 'Triggering...' : 'Trigger Periodic Review'}
          </button>
        </div>
      </Card>

      <Card title="Investor Classification" icon={<ShieldCheck size={16} />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <KeyValue label="Classification" value={customer.investorClassification || 'RETAIL'} />
          <KeyValue label="Source" value={customer.investorClassificationSource || 'CDD'} />
          <KeyValue
            label="Updated At"
            value={formatMaybeTime(customer.investorClassificationUpdatedAt)}
          />
        </div>
        <div className="mt-3">
          <button
            onClick={updateInvestorClassification}
            disabled={updatingClassification}
            className="px-3 py-2 text-xs rounded-lg bg-brand-primary text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {updatingClassification ? 'Updating...' : 'Override Classification'}
          </button>
        </div>
      </Card>

      {customer.customerType === 'CORPORATE' && (
        <Card title="Corporate Profile" icon={<Building2 size={16} />}>
          <pre className="text-xs bg-gray-950 text-gray-100 rounded-lg p-3 overflow-auto">
            {JSON.stringify(customer.corporateProfile || {}, null, 2)}
          </pre>
        </Card>
      )}

      {Array.isArray(customer.uboProfiles) && customer.uboProfiles.length > 0 && (
        <Card title="UBO List" icon={<User size={16} />}>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase border-b border-gray-200">
                <th className="py-2">Name</th>
                <th className="py-2">Ownership</th>
                <th className="py-2">Nationality</th>
                <th className="py-2">PEP</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {customer.uboProfiles.map((ubo) => (
                <tr key={ubo.id} className="border-b border-gray-100">
                  <td className="py-2">{ubo.fullName}</td>
                  <td className="py-2">{ubo.ownershipPercent ?? '-'}%</td>
                  <td className="py-2">{ubo.nationality || '-'}</td>
                  <td className="py-2">{ubo.pepFlag ? 'YES' : 'NO'}</td>
                  <td className="py-2">{ubo.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card title="CDD Responses" icon={<Clock size={16} />}>
        <CaseTable items={customer.cddResponses || []} showRequiresEdd />
      </Card>

      <Card title="EDD Responses" icon={<Clock size={16} />}>
        <CaseTable items={customer.eddResponses || []} />
      </Card>

      <Card title="Archived Onboarding Audit Logs" icon={<Clock size={16} />}>
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Historical mirror only. Canonical audit truth lives in Audit Center.
        </div>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-gray-500 uppercase border-b border-gray-200">
              <th className="py-2">Time</th>
              <th className="py-2">Action</th>
              <th className="py-2">Actor</th>
              <th className="py-2">Transition</th>
              <th className="py-2">Response</th>
            </tr>
          </thead>
          <tbody>
            {(customer.onboardingAuditLogs || []).map((log) => (
              <tr key={log.id} className="border-b border-gray-100">
                <td className="py-2">{new Date(log.createdAt).toLocaleString()}</td>
                <td className="py-2">{log.action}</td>
                <td className="py-2">{log.actorRole}:{log.actorId}</td>
                <td className="py-2">{`${log.fromStage || '-'} -> ${log.toStage || '-'}`}</td>
                <td className="py-2">{log.caseType && log.caseId ? `${log.caseType}:${log.caseId.slice(0, 8)}...` : '-'}</td>
              </tr>
            ))}
            {(customer.onboardingAuditLogs || []).length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-gray-500">
                  No audit logs
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <CaseBoundCustomerControlModal
        open={!!controlAction}
        action={controlAction}
        customerNo={customer.customerNo}
        customerLabel={fullName}
        currentCaseId={
          controlAction === 'UNRESTRICT'
            ? customer.restrictionCaseId || null
            : controlAction === 'UNFREEZE'
              ? customer.complianceHoldCaseId || null
              : null
        }
        onClose={() => setControlAction(null)}
        onSubmitted={async () => {
          await fetchCustomer();
        }}
      />
    </div>
  );
};

const CaseTable = ({
  items,
  showRequiresEdd = false,
}: {
  items: ComplianceCase[];
  showRequiresEdd?: boolean;
}) => {
  if (items.length === 0) {
    return <div className="text-sm text-gray-500">No responses</div>;
  }

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="text-xs text-gray-500 uppercase border-b border-gray-200">
          <th className="py-2">Response No</th>
          <th className="py-2">Workflow</th>
          <th className="py-2">Status</th>
          <th className="py-2">Subject</th>
          <th className="py-2">Journey / Cycle</th>
          {showRequiresEdd && <th className="py-2">Requires EDD</th>}
          <th className="py-2">Reviewed At</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className="border-b border-gray-100">
            <td className="py-2 font-medium">{item.responseNo}</td>
            <td className="py-2">{item.workflow || 'ONBOARDING'}</td>
            <td className="py-2">{item.status}</td>
            <td className="py-2">{item.subjectKind}</td>
            <td className="py-2">
              <div>{item.journeyId || '-'}</div>
              <div className="text-xs text-gray-500">{item.periodicReviewCycleId || '-'}</div>
            </td>
            {showRequiresEdd && <td className="py-2">{item.requiresEdd ? 'YES' : 'NO'}</td>}
            <td className="py-2">{formatMaybeTime(item.reviewedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const Card = ({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) => (
  <section className="bg-white rounded-xl border border-admin-border shadow-sm overflow-hidden">
    <div className="px-4 py-3 border-b border-admin-border bg-gray-50 flex items-center gap-2 text-sm font-semibold text-gray-700">
      {icon}
      {title}
    </div>
    <div className="p-4">{children}</div>
  </section>
);

const StatusBadge = ({
  label,
  value,
  tone = 'blue',
}: {
  label: string;
  value: string;
  tone?: 'blue' | 'green' | 'yellow';
}) => {
  const palette = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    yellow: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  };

  return (
    <div className={`border rounded-lg px-3 py-2 min-w-[130px] ${palette[tone]}`}>
      <div className="text-[10px] uppercase">{label}</div>
      <div className="text-xs font-bold mt-0.5">{value}</div>
    </div>
  );
};

const KeyValue = ({ label, value }: { label: string; value: string }) => (
  <div className="grid grid-cols-3 gap-3 text-sm py-1.5">
    <div className="text-gray-500">{label}</div>
    <div className="col-span-2 text-gray-900 font-medium">{value}</div>
  </div>
);

const formatMaybeTime = (value?: string | null) => (value ? new Date(value).toLocaleString() : '-');

export default CustomerDetail;

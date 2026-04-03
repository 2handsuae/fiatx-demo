import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Building2, Clock, ShieldCheck, User } from 'lucide-react';
import CaseBoundCustomerControlModal, {
  type CustomerControlAction,
} from '../components/CaseBoundCustomerControlModal';
import {
  ActionSection,
  DetailCard,
  DetailPageHeader,
} from '../components/compliance/DetailPageComponents';
import { adminButtonClass } from '../components/common/adminButtonStyles';
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

interface AuditCenterSummary {
  latestTraceId: string | null;
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
  auditCenterSummary?: AuditCenterSummary | null;
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
  const canTriggerPeriodicReview =
    customer.onboardingStatus === 'APPROVED' && customer.operatingStatus === 'ACTIVE';

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      <DetailPageHeader
        title={fullName}
        subtitle={`${customer.customerNo} · ${customer.customerType} · ${customer.email || 'No email'}`}
        onBack={() => navigate(-1)}
        onRefresh={() => void fetchCustomer()}
        backLabel="Back"
      >
        <div className="flex flex-wrap gap-3">
          <StatusBadge label="Onboarding" value={customer.onboardingStatus || 'NONE'} />
          <StatusBadge label="Operating" value={customer.operatingStatus || 'INACTIVE'} />
          <StatusBadge label="Restriction" value={customer.restrictionStatus || 'CLEAR'} />
          <StatusBadge label="Hold" value={customer.complianceHoldStatus || 'ACTIVE'} />
        </div>
      </DetailPageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DetailCard title="Subject" icon={<User size={16} />} columns={1}>
          <KeyValue label="Customer Type" value={customer.customerType} />
          <KeyValue label="Company Name" value={customer.companyName || customer.corporateProfile?.companyName || '-'} />
          <KeyValue label="First Name" value={customer.firstName || '-'} />
          <KeyValue label="Last Name" value={customer.lastName || '-'} />
          <KeyValue label="Created At" value={new Date(customer.createdAt).toLocaleString()} />
        </DetailCard>

        <DetailCard title="Compliance Snapshot" icon={<ShieldCheck size={16} />} columns={1}>
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
        </DetailCard>
      </div>

      <DetailCard title="Compatibility Snapshot" icon={<ShieldCheck size={16} />} columns={1}>
        <p className="mb-4 text-xs text-gray-500">
          Legacy compatibility fields have been retired from the customer payload. Remaining workflow summaries are shown in the canonical cards above and below.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <KeyValue
            label="Audit Center Latest Trace"
            value={customer.auditCenterSummary?.latestTraceId || '-'}
          />
        </div>
        <div className="text-sm text-gray-600">
          Stage 5 removed legacy customer status, account, final-approval mirror, and pointer fields from the customer read-model.
        </div>
      </DetailCard>

      <DetailCard title="Final Approval" icon={<ShieldCheck size={16} />} columns={1}>
        <p className="mb-4 text-xs text-gray-500">
          Approval workflow summary below is canonical. When EDD clears a customer into
          <span className="font-medium text-gray-700"> FINAL_APPROVAL</span>, the approval is created automatically.
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
      </DetailCard>

      <DetailCard title="Periodic Review" icon={<Clock size={16} />} columns={1}>
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
      </DetailCard>

      <DetailCard title="Investor Classification" icon={<ShieldCheck size={16} />} columns={1}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <KeyValue label="Classification" value={customer.investorClassification || 'RETAIL'} />
          <KeyValue label="Source" value={customer.investorClassificationSource || 'CDD'} />
          <KeyValue
            label="Updated At"
            value={formatMaybeTime(customer.investorClassificationUpdatedAt)}
          />
        </div>
      </DetailCard>

      <ActionSection
        title="Workflow Actions"
        description="Runtime workflow actions live here. Status cards above remain read-only summaries."
        emptyText="No workflow actions available for the current customer state."
      >
        <div className="flex flex-wrap gap-3">
          {customer.latestFinalApprovalId ? (
            <button
              onClick={() =>
                navigate(`/dashboard/control-gates/approvals/${customer.latestFinalApprovalId}`)
              }
              className={adminButtonClass('workflowSecondary')}
            >
              Open Final Approval
            </button>
          ) : null}
          <button
            onClick={() => void triggerPeriodicReview()}
            disabled={!canTriggerPeriodicReview || triggeringPeriodicReview}
            className={adminButtonClass('workflowSecondary')}
          >
            {triggeringPeriodicReview ? 'Triggering...' : 'Trigger Periodic Review'}
          </button>
          <button
            onClick={updateInvestorClassification}
            disabled={updatingClassification}
            className={adminButtonClass('workflowSecondary')}
          >
            {updatingClassification ? 'Updating...' : 'Override Classification'}
          </button>
        </div>
      </ActionSection>

      <ActionSection
        title="Control Actions"
        description="Restriction and compliance hold controls are operator actions, not simulation shortcuts."
      >
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setControlAction('RESTRICT')}
            disabled={customer.restrictionStatus === 'RESTRICTED'}
            className={adminButtonClass('workflowNegative')}
          >
            Restrict
          </button>
          <button
            onClick={() => setControlAction('UNRESTRICT')}
            disabled={customer.restrictionStatus !== 'RESTRICTED'}
            className={adminButtonClass('workflowSecondary')}
          >
            Unrestrict
          </button>
          <button
            onClick={() => setControlAction('FREEZE')}
            disabled={customer.complianceHoldStatus === 'FROZEN'}
            className={adminButtonClass('workflowNegative')}
          >
            Freeze
          </button>
          <button
            onClick={() => setControlAction('UNFREEZE')}
            disabled={customer.complianceHoldStatus !== 'FROZEN'}
            className={adminButtonClass('workflowSecondary')}
          >
            Unfreeze
          </button>
        </div>
      </ActionSection>

      <ActionSection
        title="Manual Simulation"
        description="Simulation stays isolated from runtime workflow and control actions."
      >
        <div className="flex flex-wrap gap-3">
          <button
            onClick={simulateExpired}
            disabled={simulatingExpired}
            className={adminButtonClass('simulationAction')}
          >
            {simulatingExpired ? 'Mocking...' : 'Mock Auto Expire'}
          </button>
        </div>
      </ActionSection>

      {customer.customerType === 'CORPORATE' && (
        <DetailCard title="Corporate Profile" icon={<Building2 size={16} />} columns={1}>
          <pre className="text-xs bg-gray-950 text-gray-100 rounded-lg p-3 overflow-auto">
            {JSON.stringify(customer.corporateProfile || {}, null, 2)}
          </pre>
        </DetailCard>
      )}

      {Array.isArray(customer.uboProfiles) && customer.uboProfiles.length > 0 && (
        <DetailCard title="UBO List" icon={<User size={16} />} columns={1}>
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
        </DetailCard>
      )}

      <DetailCard title="CDD Responses" icon={<Clock size={16} />} columns={1}>
        <CaseTable items={customer.cddResponses || []} showRequiresEdd />
      </DetailCard>

      <DetailCard title="EDD Responses" icon={<Clock size={16} />} columns={1}>
        <CaseTable items={customer.eddResponses || []} />
      </DetailCard>

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

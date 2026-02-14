import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Building2, Clock, ShieldCheck, User } from 'lucide-react';
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
  caseNo: string;
  status: string;
  subjectKind: string;
  subjectRefId: string;
  journeyId: string;
  requiresEdd?: boolean;
  reviewedAt?: string | null;
  createdAt: string;
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
  cddStatus: string;
  amlRiskTier: string;
  eddRequired: boolean;
  eddStatus: string;
  complianceStatus: string;
  cddDocumentExpiresAt?: string | null;
  finalApprovalStatus?: string;
  finalApprovalReason?: string | null;
  finalApprovalReviewerId?: string | null;
  finalApprovalReviewedAt?: string | null;
  nextReviewAt?: string | null;
  currentCddCaseId?: string | null;
  currentEddCaseId?: string | null;
  investorClassification: string;
  investorClassificationSource: string;
  investorClassificationUpdatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  corporateProfile?: CorporateProfile | null;
  uboProfiles?: UboProfile[];
  cddCases?: ComplianceCase[];
  eddCases?: ComplianceCase[];
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
  const [updatingFinalReview, setUpdatingFinalReview] = useState(false);
  const [simulatingExpired, setSimulatingExpired] = useState(false);

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

  const reviewFinalDecision = async (decision: 'APPROVE' | 'REJECT') => {
    if (!customer) return;
    const reason = decision === 'REJECT' ? window.prompt('Reason for rejection', '') || '' : '';
    if (decision === 'REJECT' && !reason.trim()) return;

    try {
      setUpdatingFinalReview(true);
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/customers/${customer.id}/final-review`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            decision,
            reason: reason || undefined,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to submit final review'));
      }

      await fetchCustomer();
    } catch (e) {
      if (e instanceof AdminSessionError) {
        return;
      }
      alert(getErrorMessage(e, 'Failed to submit final review'));
    } finally {
      setUpdatingFinalReview(false);
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
          <StatusBadge label="Compliance" value={customer.complianceStatus} />
          <StatusBadge label="CDD" value={customer.cddStatus} tone="yellow" />
          <StatusBadge label="EDD" value={customer.eddStatus} tone="blue" />
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
          <KeyValue label="CDD Status" value={customer.cddStatus} />
          <KeyValue label="AML Risk Tier" value={customer.amlRiskTier} />
          <KeyValue label="EDD Required" value={customer.eddRequired ? 'YES' : 'NO'} />
          <KeyValue label="EDD Status" value={customer.eddStatus} />
          <KeyValue label="Compliance Status" value={customer.complianceStatus} />
          <KeyValue label="CDD Doc Expires At" value={formatMaybeTime(customer.cddDocumentExpiresAt)} />
          <KeyValue label="Next Review" value={formatMaybeTime(customer.nextReviewAt)} />
          <KeyValue label="Current CDD Case" value={customer.currentCddCaseId || '-'} />
          <KeyValue label="Current EDD Case" value={customer.currentEddCaseId || '-'} />
          <KeyValue label="Last Updated" value={new Date(customer.updatedAt).toLocaleString()} />
          <div className="mt-3">
            <button
              onClick={simulateExpired}
              disabled={simulatingExpired}
              className="px-3 py-2 text-xs rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
            >
              {simulatingExpired ? 'Simulating...' : 'Simulate Expired'}
            </button>
          </div>
        </Card>
      </div>

      <Card title="Final Approval" icon={<ShieldCheck size={16} />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <KeyValue label="Status" value={customer.finalApprovalStatus || 'NOT_REQUIRED'} />
          <KeyValue label="Reviewer" value={customer.finalApprovalReviewerId || '-'} />
          <KeyValue label="Reviewed At" value={formatMaybeTime(customer.finalApprovalReviewedAt)} />
          <KeyValue label="Reason" value={customer.finalApprovalReason || '-'} />
        </div>
        {customer.finalApprovalStatus === 'PENDING' && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => reviewFinalDecision('APPROVE')}
              disabled={updatingFinalReview}
              className="px-3 py-2 text-xs rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-60"
            >
              Final Approve
            </button>
            <button
              onClick={() => reviewFinalDecision('REJECT')}
              disabled={updatingFinalReview}
              className="px-3 py-2 text-xs rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
            >
              Final Reject
            </button>
          </div>
        )}
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

      <Card title="CDD Cases" icon={<Clock size={16} />}>
        <CaseTable items={customer.cddCases || []} showRequiresEdd />
      </Card>

      <Card title="EDD Cases" icon={<Clock size={16} />}>
        <CaseTable items={customer.eddCases || []} />
      </Card>

      <Card title="Onboarding Audit Logs" icon={<Clock size={16} />}>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-gray-500 uppercase border-b border-gray-200">
              <th className="py-2">Time</th>
              <th className="py-2">Action</th>
              <th className="py-2">Actor</th>
              <th className="py-2">Transition</th>
              <th className="py-2">Case</th>
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
    return <div className="text-sm text-gray-500">No cases</div>;
  }

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="text-xs text-gray-500 uppercase border-b border-gray-200">
          <th className="py-2">Case No</th>
          <th className="py-2">Status</th>
          <th className="py-2">Subject</th>
          <th className="py-2">Journey</th>
          {showRequiresEdd && <th className="py-2">Requires EDD</th>}
          <th className="py-2">Reviewed At</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className="border-b border-gray-100">
            <td className="py-2 font-medium">{item.caseNo}</td>
            <td className="py-2">{item.status}</td>
            <td className="py-2">{item.subjectKind}</td>
            <td className="py-2">{item.journeyId}</td>
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

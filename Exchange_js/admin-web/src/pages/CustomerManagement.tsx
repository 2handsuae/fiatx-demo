import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import CaseBoundCustomerControlModal, {
  type CustomerControlAction,
} from '../components/CaseBoundCustomerControlModal';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

interface Customer {
  id: string;
  customerNo: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  customerType: string;
  onboardingStatus?: string;
  operatingStatus?: string;
  restrictionStatus?: string;
  restrictionCaseId?: string | null;
  complianceHoldStatus?: string;
  complianceHoldCaseId?: string | null;
  amlRiskTier: string;
  eddRequired: boolean;
  latestFinalApprovalId?: string | null;
  latestFinalApprovalStatus?: string | null;
  latestFinalApproval?: {
    id: string;
    approvalNo: string;
    status: string;
    decidedAt?: string | null;
    decisionByRole?: string | null;
  } | null;
  activePeriodicReviewCycleId?: string | null;
  periodicReviewOverdueAt?: string | null;
  periodicReviewOverdueReason?: string | null;
  activePeriodicReviewCycle?: {
    id: string;
    cycleNo: string;
    status: string;
    dueAt: string;
    primaryIncidentId?: string | null;
  } | null;
  investorClassification?: string;
  createdAt: string;
}

interface CaseMapItem {
  id: string;
  responseNo: string;
  status: string;
}

const getCaseBadgeClass = (status: string) => {
  if (status === 'APPROVED') return 'bg-green-100 text-green-800';
  if (status === 'SUBMITTED') return 'bg-blue-100 text-blue-800';
  if (status === 'PENDING') return 'bg-slate-100 text-slate-800';
  if (status === 'REJECTED') return 'bg-red-100 text-red-800';
  return 'bg-gray-100 text-gray-800';
};

const getCanonicalBadgeClass = (status: string) => {
  if (status === 'APPROVED' || status === 'ACTIVE' || status === 'CLEAR') {
    return 'bg-green-100 text-green-800';
  }
  if (status === 'FINAL_APPROVAL' || status === 'RESTRICTED' || status === 'FROZEN') {
    return 'bg-amber-100 text-amber-800';
  }
  if (status.includes('REVIEW')) {
    return 'bg-purple-100 text-purple-800';
  }
  if (status.includes('PENDING') || status === 'INACTIVE') {
    return 'bg-blue-100 text-blue-800';
  }
  if (status === 'REJECTED' || status === 'WITHDRAWN') {
    return 'bg-red-100 text-red-800';
  }
  return 'bg-slate-100 text-slate-800';
};

const getCustomerLifecycleBucket = (customer: Pick<Customer, 'onboardingStatus' | 'operatingStatus'>) => {
  const onboardingStatus = String(customer.onboardingStatus || 'NONE').toUpperCase();
  const operatingStatus = String(customer.operatingStatus || 'INACTIVE').toUpperCase();

  if (onboardingStatus === 'APPROVED' && operatingStatus === 'ACTIVE') {
    return 'ACTIVE';
  }
  if (onboardingStatus === 'FINAL_APPROVAL') {
    return 'FINAL_APPROVAL';
  }
  if (onboardingStatus === 'REJECTED') {
    return 'REJECTED';
  }
  if (onboardingStatus === 'WITHDRAWN') {
    return 'WITHDRAWN';
  }
  if (['CDD_UNDER_REVIEW', 'EDD_UNDER_REVIEW'].includes(onboardingStatus)) {
    return 'REVIEW';
  }
  if (['PENDING_CDD_INPUT', 'PENDING_EDD_INPUT'].includes(onboardingStatus)) {
    return 'PENDING';
  }
  if (onboardingStatus === 'NONE') {
    return 'NONE';
  }
  return onboardingStatus || 'NONE';
};

const getPrimaryCustomerStatus = (
  customer: Pick<Customer, 'onboardingStatus' | 'operatingStatus'>,
) => {
  const bucket = getCustomerLifecycleBucket(customer);
  if (bucket === 'ACTIVE') {
    return 'ACTIVE';
  }
  return String(customer.onboardingStatus || 'NONE').toUpperCase();
};

const getCustomerDisplayName = (customer: Customer) => {
  const fullName = `${customer.firstName || ''} ${customer.lastName || ''}`.trim();
  if (customer.customerType === 'CORPORATE') {
    return customer.companyName || fullName || 'Unnamed';
  }
  return fullName || customer.companyName || 'Unnamed';
};

const pad = (value: number) => String(value).padStart(2, '0');

const formatCreatedAt = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
};

const formatMaybeTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const CustomerManagement = () => {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [cddResponseByCustomer, setCddResponseByCustomer] = useState<Record<string, CaseMapItem>>({});
  const [eddResponseByCustomer, setEddResponseByCustomer] = useState<Record<string, CaseMapItem>>({});
  const [controlTarget, setControlTarget] = useState<{
    customer: Customer;
    action: CustomerControlAction;
  } | null>(null);

  const fetchCustomers = useCallback(async (searchOverride?: string) => {
    setLoading(true);
    setMessage('');

    try {
      const nextSearch = searchOverride ?? search;
      const params = new URLSearchParams();
      if (nextSearch) params.append('search', nextSearch);

      const customerRes = await adminFetch(
        `${import.meta.env.VITE_API_URL}/customers?${params.toString()}`,
      );

      if (!customerRes.ok) {
        throw new Error(await getApiErrorMessage(customerRes, 'Failed to load data.'));
      }

      const customerResult = await customerRes.json();
      const customerList: Customer[] = customerResult.data || [];
      setCustomers(customerList);

      const customerIds = customerList.map((item) => item.id).filter(Boolean);
      if (customerIds.length === 0) {
        setCddResponseByCustomer({});
        setEddResponseByCustomer({});
        return;
      }

      const query = new URLSearchParams();
      query.append('customerIds', customerIds.join(','));
      query.append('workflow', 'ONBOARDING');
      const [cddRes, eddRes] = await Promise.all([
        adminFetch(`${import.meta.env.VITE_API_URL}/admin/compliance/cdd-responses?${query.toString()}`),
        adminFetch(`${import.meta.env.VITE_API_URL}/admin/compliance/edd-responses?${query.toString()}`),
      ]);

      if (cddRes.ok) {
        const cdd = await cddRes.json();
        const map: Record<string, CaseMapItem> = {};
        (cdd.items || []).forEach((item: any) => {
          if (!map[item.customerId]) {
            map[item.customerId] = {
              id: item.id,
              responseNo: item.responseNo,
              status: item.status,
            };
          }
        });
        setCddResponseByCustomer(map);
      } else {
        setCddResponseByCustomer({});
      }

      if (eddRes.ok) {
        const edd = await eddRes.json();
        const map: Record<string, CaseMapItem> = {};
        (edd.items || []).forEach((item: any) => {
          if (!map[item.customerId]) {
            map[item.customerId] = {
              id: item.id,
              responseNo: item.responseNo,
              status: item.status,
            };
          }
        });
        setEddResponseByCustomer(map);
      } else {
        setEddResponseByCustomer({});
      }
    } catch (error) {
      if (error instanceof AdminSessionError) {
        return;
      }
      console.error('Failed to fetch onboarding data', error);
      setMessage('Failed to load data.');
      setCddResponseByCustomer({});
      setEddResponseByCustomer({});
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void fetchCustomers();
  }, [fetchCustomers]);

  const stats = useMemo(() => {
    const none = customers.filter((c) => getCustomerLifecycleBucket(c) === 'NONE').length;
    const pending = customers.filter((c) => getCustomerLifecycleBucket(c) === 'PENDING').length;
    const review = customers.filter((c) => getCustomerLifecycleBucket(c) === 'REVIEW').length;
    const finalApproval = customers.filter(
      (c) => getCustomerLifecycleBucket(c) === 'FINAL_APPROVAL',
    ).length;
    const active = customers.filter((c) => getCustomerLifecycleBucket(c) === 'ACTIVE').length;
    const rejected = customers.filter((c) =>
      ['REJECTED', 'WITHDRAWN'].includes(getCustomerLifecycleBucket(c)),
    ).length;
    return { none, pending, review, finalApproval, active, rejected };
  }, [customers]);
  const hasFilters = useMemo(() => !!search.trim(), [search]);

  const openControlModal = (customer: Customer, action: CustomerControlAction) => {
    setControlTarget({ customer, action });
  };

  const closeControlModal = () => {
    setControlTarget(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
            <h1 className="text-2xl font-bold text-gray-900">Customer Compliance Overview</h1>
            <p className="text-sm text-gray-500 mt-1">
            NONE: {stats.none} | PENDING: {stats.pending} | REVIEW: {stats.review} | FINAL_APPROVAL: {stats.finalApproval} | ACTIVE: {stats.active} | REJECTED: {stats.rejected}
            </p>
          </div>
        <button
          onClick={() => void fetchCustomers()}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {message && (
        <div className="px-4 py-3 border border-blue-200 bg-blue-50 rounded-lg text-blue-700 text-sm">
          {message}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden">
        <div className="p-4 border-b border-admin-border">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-2.5 text-gray-400 w-5 h-5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void fetchCustomers();
                  }
                }}
                placeholder="Search by name, email, or phone..."
                className="w-full pl-10 pr-4 py-2 bg-admin-content-bg border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all duration-200"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void fetchCustomers()}
                className={adminButtonClass('listPrimary')}
              >
                <Search size={16} />
                Search
              </button>
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  void fetchCustomers('');
                }}
                disabled={!hasFilters}
                className={adminButtonClass('listSecondary')}
              >
                Reset
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-xs">No</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-xs">NAME</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-xs">EMAIL</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-xs">TYPE</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-xs">Created At</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-xs">PRIMARY STATUS</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-xs">CANONICAL</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-xs">CDD RESPONSE</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-xs">EDD RESPONSE</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-xs">FINAL APPROVAL</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-xs">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-6 py-8 text-center text-gray-500">
                    Loading customers...
                  </td>
                </tr>
              ) : customers.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-6 py-8 text-center text-gray-500">
                    No customers found
                  </td>
                </tr>
              ) : (
                customers.map((customer) => {
                  const cddResponse = cddResponseByCustomer[customer.id];
                  const eddResponse = eddResponseByCustomer[customer.id];
                  const customerStatus = getPrimaryCustomerStatus(customer);
                  const latestApprovalStatus =
                    customer.latestFinalApprovalStatus || customer.latestFinalApproval?.status || '-';
                  const canOpenFinalApproval = !!customer.latestFinalApprovalId;

                  return (
                    <tr key={customer.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 text-xs font-bold text-brand-primary font-mono">
                        <Link
                          to={`/dashboard/customer/${customer.id}`}
                          className={adminButtonClass('rowKeyLink')}
                        >
                          {customer.customerNo || '-'}
                        </Link>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-gray-900">
                          <span>{getCustomerDisplayName(customer)}</span>
                        </div>
                        <div className="text-xs text-gray-400 font-mono">{customer.id.slice(0, 8)}...</div>
                      </td>
                      <td className="px-6 py-4 text-gray-700">{customer.email || '-'}</td>
                      <td className="px-6 py-4 text-gray-700">{customer.customerType || 'UNKNOWN'}</td>
                      <td className="px-6 py-4 text-gray-700 whitespace-nowrap">
                        {formatCreatedAt(customer.createdAt)}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getCanonicalBadgeClass(
                            customerStatus,
                          )}`}
                        >
                          {customerStatus}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-700">
                        <div className="space-y-1">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${getCanonicalBadgeClass(
                              customer.onboardingStatus || 'NONE',
                            )}`}
                          >
                            ONB {customer.onboardingStatus || 'NONE'}
                          </span>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${getCanonicalBadgeClass(
                              customer.operatingStatus || 'INACTIVE',
                            )}`}
                          >
                            OPS {customer.operatingStatus || 'INACTIVE'}
                          </span>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${getCanonicalBadgeClass(
                              customer.restrictionStatus || 'CLEAR',
                            )}`}
                          >
                            RES {customer.restrictionStatus || 'CLEAR'}
                          </span>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${getCanonicalBadgeClass(
                              customer.complianceHoldStatus || 'ACTIVE',
                            )}`}
                          >
                            HOLD {customer.complianceHoldStatus || 'ACTIVE'}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-700">
                        {cddResponse ? (
                          <div className="space-y-1">
                            <div className="font-mono text-[11px] text-gray-900">{cddResponse.responseNo}</div>
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${getCaseBadgeClass(
                                cddResponse.status,
                              )}`}
                            >
                              {cddResponse.status}
                            </span>
                          </div>
                        ) : (
                          'N/A'
                        )}
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-700">
                        {eddResponse ? (
                          <div className="space-y-1">
                            <div className="font-mono text-[11px] text-gray-900">{eddResponse.responseNo}</div>
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${getCaseBadgeClass(
                                eddResponse.status,
                              )}`}
                            >
                              {eddResponse.status}
                            </span>
                          </div>
                        ) : (
                          'N/A'
                        )}
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-700">
                        <div className="space-y-1">
                          <div className="font-mono text-[11px] text-gray-900">
                            {customer.latestFinalApproval?.approvalNo || '-'}
                          </div>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${getCaseBadgeClass(
                              latestApprovalStatus,
                            )}`}
                          >
                            {latestApprovalStatus}
                          </span>
                          <div className="text-[11px] text-gray-500">
                            Role: {customer.latestFinalApproval?.decisionByRole || '-'}
                          </div>
                          <div className="text-[11px] text-gray-500">
                            Decided: {formatMaybeTime(customer.latestFinalApproval?.decidedAt)}
                          </div>
                          {(customer.activePeriodicReviewCycleId ||
                            customer.periodicReviewOverdueAt) && (
                            <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                              PRR:{' '}
                              {customer.activePeriodicReviewCycle?.cycleNo ||
                                customer.activePeriodicReviewCycleId ||
                                'OVERDUE'}
                              {' / '}
                              {customer.activePeriodicReviewCycle?.status ||
                                customer.periodicReviewOverdueReason ||
                                'DUE'}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs">
                        <div className="flex flex-col items-start gap-2">
                          <Link
                            to={`/dashboard/customer/${customer.id}`}
                            className={adminButtonClass('rowLink')}
                          >
                            View
                          </Link>
                          {canOpenFinalApproval && (
                            <button
                              type="button"
                              onClick={() =>
                                navigate(
                                  `/dashboard/control-gates/approvals/${customer.latestFinalApprovalId}`,
                                )
                              }
                              className={adminButtonClass('rowSecondaryUtility')}
                            >
                              Approval
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openControlModal(customer, 'RESTRICT')}
                            disabled={customer.restrictionStatus === 'RESTRICTED'}
                            className={adminButtonClass('rowSecondaryUtility')}
                          >
                            Restrict
                          </button>
                          <button
                            type="button"
                            onClick={() => openControlModal(customer, 'UNRESTRICT')}
                            disabled={customer.restrictionStatus !== 'RESTRICTED'}
                            className={adminButtonClass('rowSecondaryUtility')}
                          >
                            Unrestrict
                          </button>
                          <button
                            type="button"
                            onClick={() => openControlModal(customer, 'FREEZE')}
                            disabled={customer.complianceHoldStatus === 'FROZEN'}
                            className={adminButtonClass('rowSecondaryUtility')}
                          >
                            Freeze
                          </button>
                          <button
                            type="button"
                            onClick={() => openControlModal(customer, 'UNFREEZE')}
                            disabled={customer.complianceHoldStatus !== 'FROZEN'}
                            className={adminButtonClass('rowSecondaryUtility')}
                          >
                            Unfreeze
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <CaseBoundCustomerControlModal
        open={!!controlTarget}
        action={controlTarget?.action || null}
        customerNo={controlTarget?.customer.customerNo}
        customerLabel={controlTarget ? getCustomerDisplayName(controlTarget.customer) : null}
        currentCaseId={
          controlTarget?.action === 'UNRESTRICT'
            ? controlTarget?.customer.restrictionCaseId || null
            : controlTarget?.action === 'UNFREEZE'
              ? controlTarget?.customer.complianceHoldCaseId || null
              : null
        }
        onClose={closeControlModal}
        onSubmitted={async () => {
          const action = controlTarget?.action;
          await fetchCustomers();
          if (action) {
            setMessage(`${action.toLowerCase()} completed.`);
          }
        }}
      />
    </div>
  );
};

export default CustomerManagement;

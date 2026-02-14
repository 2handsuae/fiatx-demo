import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
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
  cddStatus: string;
  amlRiskTier: string;
  eddRequired: boolean;
  eddStatus: string;
  complianceStatus: string;
  finalApprovalStatus: string;
  investorClassification?: string;
  createdAt: string;
}

interface CaseMapItem {
  id: string;
  caseNo: string;
  status: string;
}

const REQUIRED_CONFIRM_TEXT = "I confirm and approve this customer's onboarding.";

const getComplianceBadgeClass = (status: string) => {
  if (status === 'ACTIVE') return 'bg-green-100 text-green-800';
  if (status === 'RESTRICTED') return 'bg-yellow-100 text-yellow-800';
  if (status === 'IN_PROGRESS') return 'bg-blue-100 text-blue-800';
  if (status === 'NONE') return 'bg-slate-100 text-slate-800';
  if (status === 'EXPIRED') return 'bg-gray-100 text-gray-800';
  return 'bg-red-100 text-red-800';
};

const getCaseBadgeClass = (status: string) => {
  if (status === 'APPROVED') return 'bg-green-100 text-green-800';
  if (status === 'SUBMITTED') return 'bg-blue-100 text-blue-800';
  if (status === 'PENDING') return 'bg-slate-100 text-slate-800';
  if (status === 'REJECTED') return 'bg-red-100 text-red-800';
  return 'bg-gray-100 text-gray-800';
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

const CustomerManagement = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [approving, setApproving] = useState(false);
  const [approveTarget, setApproveTarget] = useState<Customer | null>(null);
  const [approveInput, setApproveInput] = useState('');
  const [cddCaseByCustomer, setCddCaseByCustomer] = useState<Record<string, CaseMapItem>>({});
  const [eddCaseByCustomer, setEddCaseByCustomer] = useState<Record<string, CaseMapItem>>({});

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    setMessage('');

    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);

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
        setCddCaseByCustomer({});
        setEddCaseByCustomer({});
        return;
      }

      const query = new URLSearchParams();
      query.append('customerIds', customerIds.join(','));
      const [cddRes, eddRes] = await Promise.all([
        adminFetch(`${import.meta.env.VITE_API_URL}/admin/compliance/cdd-cases?${query.toString()}`),
        adminFetch(`${import.meta.env.VITE_API_URL}/admin/compliance/edd-cases?${query.toString()}`),
      ]);

      if (cddRes.ok) {
        const cdd = await cddRes.json();
        const map: Record<string, CaseMapItem> = {};
        (cdd.items || []).forEach((item: any) => {
          if (!map[item.customerId]) {
            map[item.customerId] = {
              id: item.id,
              caseNo: item.caseNo,
              status: item.status,
            };
          }
        });
        setCddCaseByCustomer(map);
      } else {
        setCddCaseByCustomer({});
      }

      if (eddRes.ok) {
        const edd = await eddRes.json();
        const map: Record<string, CaseMapItem> = {};
        (edd.items || []).forEach((item: any) => {
          if (!map[item.customerId]) {
            map[item.customerId] = {
              id: item.id,
              caseNo: item.caseNo,
              status: item.status,
            };
          }
        });
        setEddCaseByCustomer(map);
      } else {
        setEddCaseByCustomer({});
      }
    } catch (error) {
      if (error instanceof AdminSessionError) {
        return;
      }
      console.error('Failed to fetch onboarding data', error);
      setMessage('Failed to load data.');
      setCddCaseByCustomer({});
      setEddCaseByCustomer({});
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void fetchCustomers();
  }, [fetchCustomers]);

  const stats = useMemo(() => {
    const none = customers.filter((c) => c.complianceStatus === 'NONE').length;
    const inProgress = customers.filter((c) => c.complianceStatus === 'IN_PROGRESS').length;
    const active = customers.filter((c) => c.complianceStatus === 'ACTIVE').length;
    const restricted = customers.filter((c) => c.complianceStatus === 'RESTRICTED').length;
    const blocked = customers.filter((c) => c.complianceStatus === 'BLOCKED').length;
    const expired = customers.filter((c) => c.complianceStatus === 'EXPIRED').length;
    return { none, inProgress, active, restricted, blocked, expired };
  }, [customers]);

  const openApproveModal = (customer: Customer) => {
    setApproveTarget(customer);
    setApproveInput('');
  };

  const closeApproveModal = () => {
    setApproveTarget(null);
    setApproveInput('');
  };

  const copyConfirmText = async () => {
    try {
      await navigator.clipboard.writeText(REQUIRED_CONFIRM_TEXT);
      setMessage('Confirmation text copied.');
    } catch {
      setMessage('Copy failed. Please enter the exact sentence manually.');
    }
  };

  const submitFinalApprove = async () => {
    if (!approveTarget || approveInput !== REQUIRED_CONFIRM_TEXT) return;

    try {
      setApproving(true);
      setMessage('');
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/customers/${approveTarget.id}/final-review`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            decision: 'APPROVE',
            reason: REQUIRED_CONFIRM_TEXT,
          }),
        },
      );

      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, 'Final approval failed.'));
      }

      closeApproveModal();
      setMessage('Final approval completed.');
      await fetchCustomers();
    } catch (error) {
      if (error instanceof AdminSessionError) {
        return;
      }
      console.error('Failed to final approve customer', error);
      setMessage('Final approval failed.');
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customer Compliance Overview</h1>
          <p className="text-sm text-gray-500 mt-1">
            NONE: {stats.none} | IN_PROGRESS: {stats.inProgress} | ACTIVE: {stats.active} | RESTRICTED: {stats.restricted} | BLOCKED: {stats.blocked} | EXPIRED: {stats.expired}
          </p>
        </div>
        <button
          onClick={() => void fetchCustomers()}
          className="p-2 text-gray-500 hover:text-brand-primary transition-colors"
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
        <div className="p-4 border-b border-admin-border flex gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 text-gray-400 w-5 h-5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, or phone..."
              className="w-full pl-10 pr-4 py-2 bg-admin-content-bg border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all duration-200"
            />
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
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-xs">COMPLAINCE STATUS</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-xs">CDD</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-xs">EDD</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-xs">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-6 py-8 text-center text-gray-500">
                    Loading customers...
                  </td>
                </tr>
              ) : customers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-8 text-center text-gray-500">
                    No customers found
                  </td>
                </tr>
              ) : (
                customers.map((customer) => {
                  const cddCase = cddCaseByCustomer[customer.id];
                  const eddCase = eddCaseByCustomer[customer.id];
                  const canFinalApprove = customer.finalApprovalStatus === 'PENDING';

                  return (
                    <tr key={customer.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 text-xs font-bold text-brand-primary font-mono">
                        {customer.customerNo || '-'}
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-gray-900">
                          <Link
                            to={`/dashboard/customer/${customer.id}`}
                            className="hover:text-brand-primary hover:underline"
                          >
                            {getCustomerDisplayName(customer)}
                          </Link>
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
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getComplianceBadgeClass(
                            customer.complianceStatus,
                          )}`}
                        >
                          {customer.complianceStatus}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-700">
                        {cddCase ? (
                          <div className="space-y-1">
                            <div className="font-mono text-[11px] text-gray-900">{cddCase.caseNo}</div>
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${getCaseBadgeClass(
                                cddCase.status,
                              )}`}
                            >
                              {cddCase.status}
                            </span>
                          </div>
                        ) : (
                          'N/A'
                        )}
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-700">
                        {eddCase ? (
                          <div className="space-y-1">
                            <div className="font-mono text-[11px] text-gray-900">{eddCase.caseNo}</div>
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${getCaseBadgeClass(
                                eddCase.status,
                              )}`}
                            >
                              {eddCase.status}
                            </span>
                          </div>
                        ) : (
                          'N/A'
                        )}
                      </td>
                      <td className="px-6 py-4 text-xs">
                        <div className="flex flex-col items-start gap-2">
                          <Link
                            to={`/dashboard/customer/${customer.id}`}
                            className="text-brand-primary hover:underline"
                          >
                            view
                          </Link>
                          {canFinalApprove && (
                            <button
                              type="button"
                              onClick={() => openApproveModal(customer)}
                              disabled={approving}
                              className="text-brand-primary hover:underline disabled:text-gray-400 disabled:no-underline"
                            >
                              final approve
                            </button>
                          )}
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

      {approveTarget && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-admin-border">
            <div className="px-6 py-4 border-b border-admin-border">
              <h2 className="text-lg font-semibold text-gray-900">Final Approval Confirmation</h2>
              <p className="mt-1 text-sm text-gray-500">
                Customer: {getCustomerDisplayName(approveTarget)} ({approveTarget.customerNo || '-'})
              </p>
            </div>
            <div className="px-6 py-4 space-y-4">
              <p className="text-sm text-gray-700">
                Copy and paste the sentence below before submitting.
              </p>
              <div className="flex items-center gap-2">
                <input
                  value={REQUIRED_CONFIRM_TEXT}
                  readOnly
                  className="flex-1 rounded-lg border border-admin-border bg-gray-50 px-3 py-2 text-sm font-mono text-gray-700"
                />
                <button
                  type="button"
                  onClick={() => void copyConfirmText()}
                  className="rounded-lg border border-admin-border px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  Copy text
                </button>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Confirmation input</label>
                <input
                  value={approveInput}
                  onChange={(e) => setApproveInput(e.target.value)}
                  placeholder={`Paste here: ${REQUIRED_CONFIRM_TEXT}`}
                  className="w-full rounded-lg border border-admin-border px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-admin-border flex justify-end gap-3">
              <button
                type="button"
                onClick={closeApproveModal}
                disabled={approving}
                className="rounded-lg border border-admin-border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitFinalApprove()}
                disabled={approving || approveInput !== REQUIRED_CONFIRM_TEXT}
                className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary/90 disabled:opacity-60"
              >
                {approving ? 'Submitting...' : 'Submit final approve'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerManagement;

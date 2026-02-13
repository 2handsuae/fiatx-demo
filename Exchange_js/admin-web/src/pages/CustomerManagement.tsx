import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';

interface Customer {
  id: string;
  customerNo: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  onboardingStage: string;
  customerType: string;
  canTradeSwap: boolean;
  canTradeWithdraw: boolean;
  createdAt: string;
}

interface CaseMapItem {
  id: string;
  caseNo: string;
  status: string;
}

const CustomerManagement = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [cddCaseByCustomer, setCddCaseByCustomer] = useState<Record<string, CaseMapItem>>({});
  const [eddCaseByCustomer, setEddCaseByCustomer] = useState<Record<string, CaseMapItem>>({});

  const fetchCustomers = async () => {
    setLoading(true);
    setMessage('');
    try {
      const token = localStorage.getItem('admin_token');
      const params = new URLSearchParams();
      if (search) params.append('search', search);

      const [customerRes, cddRes, eddRes] = await Promise.all([
        fetch(`${import.meta.env.VITE_API_URL}/customers?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(
          `${import.meta.env.VITE_API_URL}/admin/onboarding/cdd-cases?take=200`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        ),
        fetch(
          `${import.meta.env.VITE_API_URL}/admin/onboarding/edd-cases?take=200`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        ),
      ]);

      if (customerRes.ok) {
        const result = await customerRes.json();
        setCustomers(result.data || []);
      }

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
      }
    } catch (error) {
      console.error('Failed to fetch onboarding data', error);
      setMessage('Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  const callApi = async (
    url: string,
    method: 'POST' | 'PATCH',
    body?: Record<string, any>,
  ) => {
    const token = localStorage.getItem('admin_token');
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || 'Operation failed');
    }
    return response.json().catch(() => ({}));
  };

  const handleCddReview = async (
    customerId: string,
    decision: 'APPROVE' | 'REJECT' | 'NEED_INFO',
  ) => {
    const cddCase = cddCaseByCustomer[customerId];
    if (!cddCase) return;
    const reason =
      decision === 'REJECT' || decision === 'NEED_INFO'
        ? window.prompt('Please input review reason', '') || ''
        : '';
    if ((decision === 'REJECT' || decision === 'NEED_INFO') && !reason) return;

    try {
      await callApi(
        `${import.meta.env.VITE_API_URL}/admin/onboarding/cdd-cases/${cddCase.id}/review`,
        'POST',
        {
          decision,
          reason: reason || undefined,
        },
      );
      setMessage(`CDD ${decision} completed.`);
      fetchCustomers();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleMlroReview = async (
    customerId: string,
    decision: 'APPROVE' | 'REJECT' | 'NEED_INFO',
  ) => {
    const eddCase = eddCaseByCustomer[customerId];
    if (!eddCase) return;
    const reason =
      decision === 'REJECT' || decision === 'NEED_INFO'
        ? window.prompt('Please input MLRO reason', '') || ''
        : '';
    if ((decision === 'REJECT' || decision === 'NEED_INFO') && !reason) return;

    try {
      await callApi(
        `${import.meta.env.VITE_API_URL}/admin/onboarding/edd-cases/${eddCase.id}/mlro-review`,
        'POST',
        {
          decision,
          reason: reason || undefined,
        },
      );
      setMessage(`EDD MLRO ${decision} completed.`);
      fetchCustomers();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleSeniorReview = async (
    customerId: string,
    decision: 'APPROVE' | 'REJECT' | 'NEED_INFO',
  ) => {
    const eddCase = eddCaseByCustomer[customerId];
    if (!eddCase) return;
    const reason =
      decision === 'REJECT' || decision === 'NEED_INFO'
        ? window.prompt('Please input senior review reason', '') || ''
        : '';
    if ((decision === 'REJECT' || decision === 'NEED_INFO') && !reason) return;

    try {
      await callApi(
        `${import.meta.env.VITE_API_URL}/admin/onboarding/edd-cases/${eddCase.id}/senior-review`,
        'POST',
        {
          decision,
          reason: reason || undefined,
        },
      );
      setMessage(`EDD Senior ${decision} completed.`);
      fetchCustomers();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleApproveOnboarding = async (customerId: string) => {
    try {
      await callApi(
        `${import.meta.env.VITE_API_URL}/admin/onboarding/customers/${customerId}/approve`,
        'POST',
      );
      setMessage('Customer onboarding approved.');
      fetchCustomers();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleRejectOnboarding = async (customerId: string) => {
    const reason = window.prompt('Please input reject reason', '') || '';
    if (!reason) return;
    try {
      await callApi(
        `${import.meta.env.VITE_API_URL}/admin/onboarding/customers/${customerId}/reject`,
        'POST',
        { reason },
      );
      setMessage('Customer onboarding rejected.');
      fetchCustomers();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const renderActionButtons = (customer: Customer) => {
    const stage = customer.onboardingStage;
    const cddCase = cddCaseByCustomer[customer.id];
    const eddCase = eddCaseByCustomer[customer.id];

    if (stage === 'CDD_UNDER_REVIEW' && cddCase) {
      return (
        <div className="flex gap-1">
          <button
            onClick={() => handleCddReview(customer.id, 'APPROVE')}
            className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded hover:bg-green-100"
          >
            CDD Approve
          </button>
          <button
            onClick={() => handleCddReview(customer.id, 'NEED_INFO')}
            className="text-xs bg-yellow-50 text-yellow-700 px-2 py-1 rounded hover:bg-yellow-100"
          >
            Need Info
          </button>
          <button
            onClick={() => handleCddReview(customer.id, 'REJECT')}
            className="text-xs bg-red-50 text-red-700 px-2 py-1 rounded hover:bg-red-100"
          >
            Reject
          </button>
        </div>
      );
    }

    if (stage === 'EDD_UNDER_REVIEW' && eddCase) {
      return (
        <div className="flex gap-1">
          <button
            onClick={() => handleMlroReview(customer.id, 'APPROVE')}
            className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-100"
          >
            MLRO Approve
          </button>
          <button
            onClick={() => handleMlroReview(customer.id, 'NEED_INFO')}
            className="text-xs bg-yellow-50 text-yellow-700 px-2 py-1 rounded hover:bg-yellow-100"
          >
            Need Info
          </button>
          <button
            onClick={() => handleMlroReview(customer.id, 'REJECT')}
            className="text-xs bg-red-50 text-red-700 px-2 py-1 rounded hover:bg-red-100"
          >
            Reject
          </button>
        </div>
      );
    }

    if (stage === 'EDD_MLRO_APPROVED' && eddCase) {
      return (
        <div className="flex gap-1">
          <button
            onClick={() => handleSeniorReview(customer.id, 'APPROVE')}
            className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded hover:bg-green-100"
          >
            Senior Approve
          </button>
          <button
            onClick={() => handleSeniorReview(customer.id, 'NEED_INFO')}
            className="text-xs bg-yellow-50 text-yellow-700 px-2 py-1 rounded hover:bg-yellow-100"
          >
            Need Info
          </button>
          <button
            onClick={() => handleSeniorReview(customer.id, 'REJECT')}
            className="text-xs bg-red-50 text-red-700 px-2 py-1 rounded hover:bg-red-100"
          >
            Reject
          </button>
        </div>
      );
    }

    if (stage === 'CDD_APPROVED' || stage === 'EDD_APPROVED') {
      return (
        <div className="flex gap-1">
          <button
            onClick={() => handleApproveOnboarding(customer.id)}
            className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded hover:bg-green-100"
          >
            Final Approve
          </button>
          <button
            onClick={() => handleRejectOnboarding(customer.id)}
            className="text-xs bg-red-50 text-red-700 px-2 py-1 rounded hover:bg-red-100"
          >
            Final Reject
          </button>
        </div>
      );
    }

    if (stage === 'ONBOARDING_APPROVED') {
      return <span className="text-xs text-green-700 font-medium">Trading Enabled</span>;
    }

    if (stage === 'ONBOARDING_REJECTED') {
      return <span className="text-xs text-red-700 font-medium">Rejected</span>;
    }

    return <span className="text-xs text-gray-500">Awaiting customer submission</span>;
  };

  useEffect(() => {
    fetchCustomers();
  }, [search]);

  const stats = useMemo(() => {
    const approved = customers.filter((c) => c.onboardingStage === 'ONBOARDING_APPROVED').length;
    const inReview = customers.filter((c) =>
      ['CDD_UNDER_REVIEW', 'EDD_UNDER_REVIEW', 'EDD_MLRO_APPROVED'].includes(
        c.onboardingStage,
      ),
    ).length;
    return { approved, inReview };
  }, [customers]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Onboarding Management</h1>
          <p className="text-sm text-gray-500 mt-1">
            In review: {stats.inReview} | Approved: {stats.approved}
          </p>
        </div>
        <button
          onClick={fetchCustomers}
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
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-xs">Customer</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-xs">Contact</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-xs">Type</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-xs">Stage</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-xs">Cases</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-xs">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                    Loading customers...
                  </td>
                </tr>
              ) : customers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                    No customers found
                  </td>
                </tr>
              ) : (
                customers.map((customer) => (
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
                          {customer.firstName || customer.lastName
                            ? `${customer.firstName || ''} ${customer.lastName || ''}`
                            : 'Unnamed'}
                        </Link>
                      </div>
                      <div className="text-xs text-gray-400 font-mono">{customer.id.slice(0, 8)}...</div>
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      <div>{customer.email || '-'}</div>
                      <div className="text-xs text-gray-400">{customer.phone || '-'}</div>
                    </td>
                    <td className="px-6 py-4 text-gray-700">{customer.customerType || 'UNKNOWN'}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          customer.onboardingStage === 'ONBOARDING_APPROVED'
                            ? 'bg-green-100 text-green-800'
                            : customer.onboardingStage === 'ONBOARDING_REJECTED'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-yellow-100 text-yellow-800'
                        }`}
                      >
                        {customer.onboardingStage.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs text-gray-500">
                      <div>{cddCaseByCustomer[customer.id]?.caseNo || 'CDD N/A'}</div>
                      <div>{eddCaseByCustomer[customer.id]?.caseNo || 'EDD N/A'}</div>
                    </td>
                    <td className="px-6 py-4">{renderActionButtons(customer)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default CustomerManagement;

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';

interface DecisionItem {
  id: string;
  customerNo: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  customerType: string;
  onboardingStage: string;
  onboardingRejectReason?: string | null;
  updatedAt: string;
}

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const OnboardingDecisionsPage = () => {
  const [items, setItems] = useState<DecisionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const token = localStorage.getItem('admin_token');

  const fetchQueue = async () => {
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/decisions?take=200`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!response.ok) {
        throw new Error('Failed to load onboarding decision queue');
      }

      const data = await response.json();
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e: unknown) {
      setMessage(getErrorMessage(e, 'Load failed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueue();
  }, []);

  const stageCounts = useMemo(() => {
    return items.reduce<Record<string, number>>((acc, item) => {
      acc[item.onboardingStage] = (acc[item.onboardingStage] || 0) + 1;
      return acc;
    }, {});
  }, [items]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Compliance Center - Onboarding Decisions</h1>
          <p className="text-sm text-gray-500 mt-1">Status board only. Customer status is now driven directly by case decisions.</p>
        </div>
        <button onClick={fetchQueue} className="p-2 text-gray-500 hover:text-brand-primary" title="Refresh">
          <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {message && (
        <div className="px-4 py-3 border border-blue-200 bg-blue-50 rounded-lg text-blue-700 text-sm">
          {message}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(stageCounts).map(([stage, count]) => (
          <div key={stage} className="bg-white rounded-lg border border-admin-border p-3">
            <div className="text-xs text-gray-500 uppercase">{stage}</div>
            <div className="text-xl font-bold text-gray-900 mt-1">{count}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-admin-content-bg border-b border-admin-border">
            <tr>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Customer</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Email</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Type</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Stage</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Reject Reason</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-admin-border">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  No records
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const fullName = item.firstName || item.lastName ? `${item.firstName || ''} ${item.lastName || ''}`.trim() : item.customerNo;

                return (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900">{fullName}</div>
                      <div className="text-xs text-gray-500">{item.customerNo}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{item.email || '-'}</td>
                    <td className="px-4 py-3 text-gray-700">{item.customerType}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-700">
                        {item.onboardingStage}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 max-w-[280px]">
                      {item.onboardingRejectReason || '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {new Date(item.updatedAt).toLocaleString()}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default OnboardingDecisionsPage;

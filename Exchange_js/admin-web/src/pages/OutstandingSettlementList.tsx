import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Plus, RefreshCw, Search, X } from 'lucide-react';

type OutstandingSettlementListItem = {
  id: string;
  settlementNo: string;
  sourceType: string;
  status: string;
  requestId?: string | null;
  totalOutstandingCount: number;
  closedOutstandingCount: number;
  totalAssetCount: number;
  closedAssetCount: number;
  cutoffAt: string;
  createdAt: string;
};

const STATUS_COLORS: Record<string, string> = {
  CREATED: 'bg-slate-100 text-slate-800',
  PROCESSING: 'bg-blue-100 text-blue-800',
  SUCCESS: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-rose-100 text-rose-800',
};

const OutstandingSettlementList = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<OutstandingSettlementListItem[]>([]);
  const [status, setStatus] = useState('');
  const [settlementNo, setSettlementNo] = useState('');
  const [requestId, setRequestId] = useState('');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [rangeStartAt, setRangeStartAt] = useState('');
  const [createRequestId, setCreateRequestId] = useState('');
  const [note, setNote] = useState('');

  const fetchItems = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('admin_token');
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (settlementNo) params.set('settlementNo', settlementNo);
      if (requestId) params.set('requestId', requestId);

      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/outstanding-settlements?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (response.ok) {
        const result = await response.json();
        setItems(result.items || []);
      } else if (response.status === 401) {
        localStorage.removeItem('admin_token');
        navigate('/admin/login');
      } else {
        const err = await response.json();
        alert(err.message || 'Failed to load outstanding settlements');
      }
    } catch (error) {
      console.error('Failed to fetch outstanding settlements', error);
      alert('Failed to load outstanding settlements');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [status]);

  const handleCreate = async () => {
    setCreateSubmitting(true);
    try {
      const token = localStorage.getItem('admin_token');
      const body: Record<string, string> = {
        sourceType: 'SWAP',
      };
      if (rangeStartAt) {
        body.rangeStartAt = new Date(rangeStartAt).toISOString();
      }
      if (createRequestId.trim()) {
        body.requestId = createRequestId.trim();
      }
      if (note.trim()) {
        body.note = note.trim();
      }

      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/outstanding-settlements`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        const err = await response.json();
        alert(err.message || 'Create failed');
        return;
      }

      const result = await response.json();
      setShowCreateModal(false);
      setRangeStartAt('');
      setCreateRequestId('');
      setNote('');
      await fetchItems();

      if (result?.id) {
        navigate(`/dashboard/reconciliation/outstanding-settlements/${result.id}`);
      }
    } catch (error) {
      console.error('Failed to create outstanding settlement', error);
      alert('Create failed');
    } finally {
      setCreateSubmitting(false);
    }
  };

  return (
    <>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Outstanding Settlements</h1>
            <p className="text-sm text-gray-500 mt-1">
              Batch close swap outstandings and drive internal execution
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 text-sm flex items-center gap-2"
            >
              <Plus size={16} />
              Create Settlement
            </button>
            <button
              onClick={fetchItems}
              className="p-2 text-gray-500 hover:text-brand-primary transition-colors border border-gray-200 rounded-lg bg-white"
            >
              <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden">
          <div className="p-4 border-b border-admin-border flex flex-col gap-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="px-3 py-2 border border-admin-border rounded-lg bg-white text-sm text-gray-600 focus:outline-none focus:border-brand-primary"
              >
                <option value="">All Status</option>
                <option value="CREATED">CREATED</option>
                <option value="PROCESSING">PROCESSING</option>
                <option value="SUCCESS">SUCCESS</option>
                <option value="FAILED">FAILED</option>
              </select>
              <input
                value={settlementNo}
                onChange={(e) => setSettlementNo(e.target.value)}
                placeholder="Settlement No"
                className="px-3 py-2 border border-admin-border rounded-lg text-sm focus:outline-none focus:border-brand-primary"
              />
              <input
                value={requestId}
                onChange={(e) => setRequestId(e.target.value)}
                placeholder="Request Id"
                className="px-3 py-2 border border-admin-border rounded-lg text-sm focus:outline-none focus:border-brand-primary"
              />
              <button
                onClick={fetchItems}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium transition-colors"
              >
                <Search size={16} />
                Search
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-admin-content-bg border-b border-admin-border">
                <tr>
                  <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Settlement No</th>
                  <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Progress</th>
                  <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Source / Cutoff</th>
                  <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Created At</th>
                  <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-admin-border">
                {loading && items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                      <RefreshCw className="animate-spin mx-auto mb-2 text-brand-primary" size={22} />
                      Loading outstanding settlements...
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                      No outstanding settlements found
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-mono text-xs text-gray-800">{item.settlementNo}</div>
                        <div className="text-xs text-gray-500 mt-1">{item.requestId || '-'}</div>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            STATUS_COLORS[item.status] || 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-xs text-gray-800">
                          Assets: {item.closedAssetCount} / {item.totalAssetCount}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          Outstanding: {item.closedOutstandingCount} / {item.totalOutstandingCount}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-xs text-gray-700">{item.sourceType}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          cutoff: {new Date(item.cutoffAt).toLocaleString('en-US')}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-500">
                        {new Date(item.createdAt).toLocaleString('en-US')}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => navigate(`/dashboard/reconciliation/outstanding-settlements/${item.id}`)}
                          className="p-1.5 text-blue-600 rounded hover:bg-blue-50 transition-colors"
                          title="View Details"
                        >
                          <Eye size={18} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showCreateModal ? (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-xl bg-white shadow-lg border border-admin-border">
            <div className="flex items-center justify-between px-5 py-4 border-b border-admin-border">
              <h3 className="text-lg font-semibold text-gray-900">Create Outstanding Settlement</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1 text-gray-500 hover:text-gray-800"
                disabled={createSubmitting}
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Source Type</label>
                <input
                  value="SWAP"
                  disabled
                  className="w-full px-3 py-2 border border-admin-border rounded-lg text-sm bg-gray-50 text-gray-600"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Range Start At (Optional)</label>
                <input
                  type="datetime-local"
                  value={rangeStartAt}
                  onChange={(e) => setRangeStartAt(e.target.value)}
                  className="w-full px-3 py-2 border border-admin-border rounded-lg text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Cutoff is always server current time at creation.
                </p>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Request Id (Optional)</label>
                <input
                  value={createRequestId}
                  onChange={(e) => setCreateRequestId(e.target.value)}
                  placeholder="Idempotency key"
                  className="w-full px-3 py-2 border border-admin-border rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Note (Optional)</label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-admin-border rounded-lg text-sm"
                />
              </div>
            </div>

            <div className="px-5 py-4 border-t border-admin-border flex justify-end gap-2">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-sm rounded-lg border border-admin-border text-gray-600 hover:bg-gray-50"
                disabled={createSubmitting}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={createSubmitting}
                className="px-4 py-2 text-sm rounded-lg bg-brand-primary text-white hover:bg-brand-primary/90 disabled:opacity-60"
              >
                {createSubmitting ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default OutstandingSettlementList;

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import { formatAssetAmount, formatRate8 } from '../utils/number-format';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

type QuoteBusiness = 'SWAP' | 'WITHDRAWAL';

interface PricingQuoteListItem {
  quoteId: string;
  quoteNo: string | null;
  business: QuoteBusiness;
  status: 'ACTIVE' | 'USED' | 'EXPIRED' | 'CANCELLED';
  ownerType: string;
  ownerNo: string | null;
  primaryAssetCode: string;
  secondaryAssetCode: string | null;
  amountIn: string | null;
  amountOut: string | null;
  amount: string | null;
  rateAllIn: string | null;
  feeTotal: string;
  feeCurrency: string;
  linkedBusinessNo: string | null;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  cancelledAt: string | null;
}

const renderStatusBadge = (value: string) => {
  const classNameMap: Record<string, string> = {
    ACTIVE: 'bg-green-100 text-green-800',
    USED: 'bg-blue-100 text-blue-800',
    EXPIRED: 'bg-gray-100 text-gray-700',
    CANCELLED: 'bg-red-100 text-red-800',
  };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
        classNameMap[value] || 'bg-gray-100 text-gray-700'
      }`}
    >
      {value}
    </span>
  );
};

const renderBusinessBadge = (business: QuoteBusiness) => (
  <span
    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
      business === 'SWAP'
        ? 'bg-indigo-100 text-indigo-800'
        : 'bg-amber-100 text-amber-800'
    }`}
  >
    {business}
  </span>
);

const SwapQuoteList = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<PricingQuoteListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [business, setBusiness] = useState('');
  const [status, setStatus] = useState('');
  const [quoteNo, setQuoteNo] = useState('');
  const [ownerNo, setOwnerNo] = useState('');

  type QuoteFilters = {
    business: string;
    status: string;
    quoteNo: string;
    ownerNo: string;
  };

  const hasFilters = useMemo(
    () => !!business || !!status || !!quoteNo.trim() || !!ownerNo.trim(),
    [business, ownerNo, quoteNo, status],
  );

  const fetchQuotes = async (
    overrides?: Partial<QuoteFilters>,
  ) => {
    setLoading(true);
    try {
      const nextFilters: QuoteFilters = {
        business,
        status,
        quoteNo,
        ownerNo,
        ...overrides,
      };
      const params = new URLSearchParams();
      if (nextFilters.business) params.set('business', nextFilters.business);
      if (nextFilters.status) params.set('status', nextFilters.status);
      if (nextFilters.quoteNo) params.set('quoteNo', nextFilters.quoteNo);
      if (nextFilters.ownerNo) params.set('ownerNo', nextFilters.ownerNo);

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/pricing/quotes?${params.toString()}`,
      );

      if (response.ok) {
        const result = await response.json();
        setItems(result.items || []);
      } else {
        throw new Error(await getApiErrorMessage(response, 'Failed to fetch pricing quotes.'));
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch pricing quotes', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchQuotes();
  }, []);

  const resetFilters = async () => {
    setBusiness('');
    setStatus('');
    setQuoteNo('');
    setOwnerNo('');
    await fetchQuotes({
      business: '',
      status: '',
      quoteNo: '',
      ownerNo: '',
    });
  };

  const renderInstrument = (item: PricingQuoteListItem) => {
    if (item.business === 'SWAP') {
      return (
        <div className="font-mono text-gray-700">
          {item.primaryAssetCode} → {item.secondaryAssetCode || 'N/A'}
        </div>
      );
    }

    return (
      <div className="font-mono text-gray-700">
        {item.primaryAssetCode}
      </div>
    );
  };

  const renderTerms = (item: PricingQuoteListItem) => {
    if (item.business === 'SWAP') {
      return (
        <>
          <div className="text-red-600">
            {formatAssetAmount(item.amountIn || '0')} {item.primaryAssetCode}
          </div>
          <div className="text-green-600 text-xs">
            {formatAssetAmount(item.amountOut || '0')} {item.secondaryAssetCode || 'N/A'}
          </div>
          <div className="font-mono text-xs text-gray-500 mt-1">
            Rate {item.rateAllIn ? formatRate8(item.rateAllIn) : 'N/A'}
          </div>
        </>
      );
    }

    return (
      <>
        <div className="text-gray-700">
          {formatAssetAmount(item.amount || '0')} {item.primaryAssetCode}
        </div>
        <div className="font-mono text-xs text-gray-500 mt-1">
          Fee {formatAssetAmount(item.feeTotal)} {item.feeCurrency}
        </div>
      </>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Quote Center</h1>
          <p className="text-sm text-gray-500 mt-1">
            Read-only quote snapshots for swap and withdrawal pricing auditability
          </p>
        </div>
        <button
          onClick={() => void fetchQuotes()}
          className={adminIconButtonClass()}
        >
          <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden">
        <div className="p-4 border-b border-admin-border flex flex-col gap-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <select
              value={business}
              onChange={(e) => setBusiness(e.target.value)}
              className="px-3 py-2 border border-admin-border rounded-lg bg-white text-sm text-gray-600 focus:outline-none focus:border-brand-primary"
            >
              <option value="">All Business</option>
              <option value="SWAP">SWAP</option>
              <option value="WITHDRAWAL">WITHDRAWAL</option>
            </select>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="px-3 py-2 border border-admin-border rounded-lg bg-white text-sm text-gray-600 focus:outline-none focus:border-brand-primary"
            >
              <option value="">All Status</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="USED">USED</option>
              <option value="EXPIRED">EXPIRED</option>
              <option value="CANCELLED">CANCELLED</option>
            </select>
            <input
              value={quoteNo}
              onChange={(e) => setQuoteNo(e.target.value)}
              placeholder="Quote No"
              className="px-3 py-2 border border-admin-border rounded-lg text-sm focus:outline-none focus:border-brand-primary"
            />
            <input
              value={ownerNo}
              onChange={(e) => setOwnerNo(e.target.value)}
              placeholder="Owner No"
              className="px-3 py-2 border border-admin-border rounded-lg text-sm focus:outline-none focus:border-brand-primary"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void fetchQuotes()}
              className={adminButtonClass('listPrimary')}
            >
              Search
            </button>
            <button
              onClick={() => void resetFilters()}
              className={adminButtonClass('listSecondary')}
              disabled={!hasFilters || loading}
            >
              Reset
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Business</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Quote No</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Owner No</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Linked No</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Instrument</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Terms</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Fees</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Lifecycle</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center text-gray-500">
                    <RefreshCw className="animate-spin mx-auto mb-2 text-brand-primary" size={22} />
                    Loading quotes...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center text-gray-500">
                    No quotes found
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={`${item.business}-${item.quoteId}`} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">{renderBusinessBadge(item.business)}</td>
                    <td className="px-6 py-4">
                      <button
                        type="button"
                        className={adminButtonClass('rowKeyLink')}
                        onClick={() => navigate(`/dashboard/pricing/quotes/${item.business}/${item.quoteId}`)}
                        title={item.quoteNo || 'N/A'}
                      >
                        {item.quoteNo || 'N/A'}
                      </button>
                    </td>
                    <td className="px-6 py-4">{renderStatusBadge(item.status)}</td>
                    <td className="px-6 py-4 font-mono text-xs text-gray-700">{item.ownerNo || 'N/A'}</td>
                    <td className="px-6 py-4 font-mono text-xs text-gray-700">{item.linkedBusinessNo || 'N/A'}</td>
                    <td className="px-6 py-4">{renderInstrument(item)}</td>
                    <td className="px-6 py-4">{renderTerms(item)}</td>
                    <td className="px-6 py-4 font-mono text-xs text-gray-700">
                      {formatAssetAmount(item.feeTotal)} {item.feeCurrency}
                    </td>
                    <td className="px-6 py-4 text-xs text-gray-500">
                      <div>C: {new Date(item.createdAt).toLocaleString('en-US')}</div>
                      <div>E: {new Date(item.expiresAt).toLocaleString('en-US')}</div>
                      {item.usedAt && <div>U: {new Date(item.usedAt).toLocaleString('en-US')}</div>}
                      {item.cancelledAt && <div>X: {new Date(item.cancelledAt).toLocaleString('en-US')}</div>}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => navigate(`/dashboard/pricing/quotes/${item.business}/${item.quoteId}`)}
                        className={adminButtonClass('rowLink')}
                        title="View"
                      >
                        View
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
  );
};

export default SwapQuoteList;

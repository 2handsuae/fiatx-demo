import { useEffect, useState } from 'react';
import { RefreshCw, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  BUSINESS_CONFIG_RELEASES_PATH,
  showBusinessConfigReadOnlyAlert,
} from '../utils/businessConfigReadOnly';
import { adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';

interface AssetConfigItem {
  businessKey: string;
  code: string;
  type: string;
  network: string;
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  depositMinAmount: string;
  depositMaxAmount: string | null;
  withdrawMinAmount: string;
  withdrawMaxAmount: string | null;
  networkFeeBuffer: string | null;
}

const renderBool = (v: boolean) => (
  <span
    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
      v ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
    }`}
  >
    {v ? 'Yes' : 'No'}
  </span>
);

const AssetConfigList = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<AssetConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeReleaseNo, setActiveReleaseNo] = useState<string | null>(null);

  const fetchItems = async () => {
    setLoading(true);
    setError('');
    try {
      const listRes = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/business-config/releases?subjectType=ASSET_CONFIG&status=ACTIVE&take=1`,
      );
      if (!listRes.ok) {
        setError(await getApiErrorMessage(listRes, 'Failed to fetch asset config releases.'));
        return;
      }
      const listData = await listRes.json();
      const firstRelease = listData?.items?.[0];
      if (!firstRelease?.releaseNo) {
        setItems([]);
        setActiveReleaseNo(null);
        return;
      }
      setActiveReleaseNo(firstRelease.releaseNo);

      const detailRes = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/business-config/releases/${firstRelease.releaseNo}`,
      );
      if (!detailRes.ok) {
        setError(await getApiErrorMessage(detailRes, 'Failed to fetch asset config details.'));
        return;
      }
      const detail = await detailRes.json();
      const parsed: AssetConfigItem[] = (detail?.items ?? []).map(
        (item: { businessKey: string; payload: Record<string, unknown> }) => ({
          businessKey: item.businessKey,
          code: String(item.payload.code ?? ''),
          type: String(item.payload.type ?? ''),
          network: String(item.payload.network ?? ''),
          depositEnabled: item.payload.depositEnabled === true,
          withdrawEnabled: item.payload.withdrawEnabled === true,
          depositMinAmount: String(item.payload.depositMinAmount ?? ''),
          depositMaxAmount:
            item.payload.depositMaxAmount != null
              ? String(item.payload.depositMaxAmount)
              : null,
          withdrawMinAmount: String(item.payload.withdrawMinAmount ?? ''),
          withdrawMaxAmount:
            item.payload.withdrawMaxAmount != null
              ? String(item.payload.withdrawMaxAmount)
              : null,
          networkFeeBuffer:
            item.payload.networkFeeBuffer != null
              ? String(item.payload.networkFeeBuffer)
              : null,
        }),
      );
      setItems(parsed);
    } catch (err) {
      console.error('Failed to fetch AssetConfig', err);
      setError('Failed to fetch asset config.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Asset Operational Config</h1>
          <p className="text-sm text-gray-500 mt-1">
            Per-asset deposit / withdrawal parameters managed by config-as-code
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => navigate(BUSINESS_CONFIG_RELEASES_PATH)}
            className={adminButtonClass('listSecondary')}
          >
            <Settings size={20} />
            <span>Open Release Center</span>
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        Asset operational config is managed by config-as-code and Business Config Releases. This
        page shows the current ACTIVE release snapshot and is read-only.
        {activeReleaseNo && (
          <span className="ml-2 font-mono font-semibold">(Release: {activeReleaseNo})</span>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden">
        <div className="p-4 border-b border-admin-border flex justify-end">
          <button onClick={() => void fetchItems()} className={adminIconButtonClass()}>
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Asset No</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Code</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Type</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Network</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Deposit</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Withdraw</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Dep. Min</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Dep. Max</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Wtd. Min</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Wtd. Max</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Fee Buffer</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {error ? (
                <tr>
                  <td colSpan={12} className="px-6 py-12 text-center text-rose-600">
                    {error}
                  </td>
                </tr>
              ) : null}
              {!error && loading ? (
                <tr>
                  <td colSpan={12} className="px-6 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <RefreshCw className="animate-spin mb-2 text-brand-primary" size={24} />
                      Loading asset config...
                    </div>
                  </td>
                </tr>
              ) : !error && items.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-6 py-12 text-center text-gray-500">
                    No active ASSET_CONFIG release found. Run{' '}
                    <span className="font-mono text-xs bg-gray-100 px-1 rounded">
                      npm run config:stage -- --subject ASSET_CONFIG
                    </span>{' '}
                    to stage the first release.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.businessKey} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 font-mono font-medium text-gray-900">{item.businessKey}</td>
                    <td className="px-6 py-4 font-mono font-medium text-gray-900">{item.code}</td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                        {item.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600">{item.network || '—'}</td>
                    <td className="px-6 py-4">{renderBool(item.depositEnabled)}</td>
                    <td className="px-6 py-4">{renderBool(item.withdrawEnabled)}</td>
                    <td className="px-6 py-4 font-mono">{item.depositMinAmount}</td>
                    <td className="px-6 py-4 font-mono">{item.depositMaxAmount ?? '—'}</td>
                    <td className="px-6 py-4 font-mono">{item.withdrawMinAmount}</td>
                    <td className="px-6 py-4 font-mono">{item.withdrawMaxAmount ?? '—'}</td>
                    <td className="px-6 py-4 font-mono">{item.networkFeeBuffer ?? '—'}</td>
                    <td className="px-6 py-4 text-right">
                      <button
                        className={adminButtonClass('rowSecondaryUtility')}
                        onClick={() => showBusinessConfigReadOnlyAlert('ASSET_CONFIG')}
                      >
                        Read-only
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

export default AssetConfigList;

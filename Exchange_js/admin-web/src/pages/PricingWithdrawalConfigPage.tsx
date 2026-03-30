import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { buildBusinessConfigReadOnlyMessage } from '../utils/businessConfigReadOnly';

type Asset = {
  id: string;
  code: string;
  network: string | null;
  status: string;
  decimals?: number | null;
};

type FeeCalcType = 'FLAT' | 'PERCENT';
type FeeMode = 'PERCENT_WITH_MIN' | 'FLAT';
type RoundingMode = 'ROUND' | 'FLOOR' | 'CEIL';

type FeeItem = {
  id: string;
  itemCode: 'WITHDRAW_SERVICE_FEE' | 'NETWORK_FEE_EST';
  calcType: FeeCalcType;
  value: string;
  currency: string;
  min: string | null;
  cap: string | null;
  roundingDp: number;
  roundingMode: RoundingMode;
  adjustable: boolean;
};

type WithdrawalTier = {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  conditions: {
    amountMin: string | null;
    amountMax: string | null;
  };
  feeItems: FeeItem[];
};

type WithdrawalAssetEntry = {
  id: string;
  assetId: string;
  assetCode: string;
  network: string | null;
  enabled: boolean;
  tiers: WithdrawalTier[];
};

type WithdrawalPolicy = {
  policyId: string;
  policyName: string;
  business: 'WITHDRAWAL';
  channel: {
    online: boolean;
    storeComingSoon: boolean;
  };
  assets: WithdrawalAssetEntry[];
};

type PolicySummary = {
  policyCode: string;
  lastUpdatedAt: string;
  lastUpdatedBy: string | null;
};

function toNumberString(value: unknown, fallback = '0'): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return String(parsed);
}

function getFeeMode(item: FeeItem): FeeMode {
  return item.calcType === 'PERCENT' ? 'PERCENT_WITH_MIN' : 'FLAT';
}

function summarizeFee(item: FeeItem): string {
  if (item.calcType === 'PERCENT') {
    return `${item.value}% (min ${item.min || '0'})`;
  }
  return `Fixed ${item.value}`;
}

const FieldBlock = ({ label, value }: { label: string; value: string }) => (
  <div className="space-y-1">
    <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
    <div className="px-3 py-2 rounded-lg border border-admin-border bg-gray-50 text-sm text-gray-800">
      {value}
    </div>
  </div>
);

const PricingWithdrawalConfigPage = () => {
  const readOnlyMessage = buildBusinessConfigReadOnlyMessage('Withdrawal pricing policy');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [policy, setPolicy] = useState<WithdrawalPolicy | null>(null);
  const [summary, setSummary] = useState<PolicySummary | null>(null);

  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);

  const selectedEntry = useMemo(() => {
    if (!policy || !selectedAssetId) return null;
    return policy.assets.find((entry) => entry.assetId === selectedAssetId) || null;
  }, [policy, selectedAssetId]);

  const ensureFeeItem = (
    raw: FeeItem | undefined,
    feeId: string,
    code: FeeItem['itemCode'],
    assetCode: string,
    decimals: number,
  ): FeeItem => {
    const calcType: FeeCalcType = raw?.calcType === 'PERCENT' ? 'PERCENT' : 'FLAT';
    return {
      id: raw?.id || feeId,
      itemCode: code,
      calcType,
      value: toNumberString(raw?.value, '0'),
      currency: assetCode,
      min:
        calcType === 'PERCENT'
          ? toNumberString(raw?.min, '0')
          : null,
      cap: null,
      roundingDp: decimals,
      roundingMode: 'ROUND',
      adjustable: false,
    };
  };

  const normalizeEntry = (
    entry: WithdrawalAssetEntry | undefined,
    asset: Asset,
    index: number,
  ): WithdrawalAssetEntry => {
    const entryId = entry?.id || `ASSET-${String(index + 1).padStart(4, '0')}`;
    const tier = entry?.tiers?.[0];
    const tierId = tier?.id || `${entryId}-TIER-001`;
    const decimals = Math.max(0, Number(asset.decimals ?? 8));
    const feeItems = tier?.feeItems || [];

    return {
      id: entryId,
      assetId: asset.id,
      assetCode: asset.code,
      network: asset.network,
      enabled: entry?.enabled ?? true,
      tiers: [
        {
          id: tierId,
          name: tier?.name || 'Default Tier',
          priority: 1,
          enabled: true,
          conditions: {
            amountMin: '0',
            amountMax: null,
          },
          feeItems: [
            ensureFeeItem(
              feeItems.find((item) => item.itemCode === 'WITHDRAW_SERVICE_FEE'),
              `${tierId}-FEE-001`,
              'WITHDRAW_SERVICE_FEE',
              asset.code,
              decimals,
            ),
            ensureFeeItem(
              feeItems.find((item) => item.itemCode === 'NETWORK_FEE_EST'),
              `${tierId}-FEE-002`,
              'NETWORK_FEE_EST',
              asset.code,
              decimals,
            ),
          ],
        },
      ],
    };
  };

  const normalizePolicy = (
    raw: WithdrawalPolicy,
    sourceAssets: Asset[],
  ): WithdrawalPolicy => {
    const byAssetId = new Map<string, WithdrawalAssetEntry>();
    (raw.assets || []).forEach((entry) => byAssetId.set(entry.assetId, entry));
    return {
      ...raw,
      policyName: raw.policyName || 'Withdrawal Pricing',
      business: 'WITHDRAWAL',
      channel: {
        online: true,
        storeComingSoon: true,
      },
      assets: sourceAssets.map((asset, index) =>
        normalizeEntry(byAssetId.get(asset.id), asset, index),
      ),
    };
  };

  const loadAssets = async () => {
    const response = await adminFetch(
      `${import.meta.env.VITE_API_URL}/assets?status=ACTIVE&take=200`,
    );
    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, 'Failed to load assets'));
    }
    const payload = await response.json();
    const nextAssets = (payload.items || []) as Asset[];
    setAssets(nextAssets);
    return nextAssets;
  };

  const loadPolicy = async (assetSource?: Asset[]) => {
    const response = await adminFetch(
      `${import.meta.env.VITE_API_URL}/admin/pricing/policies/withdrawal`,
    );
    if (!response.ok) {
      throw new Error(
        await getApiErrorMessage(response, 'Failed to load withdrawal policy'),
      );
    }
    const payload = (await response.json()) as WithdrawalPolicy;
    const sourceAssets = assetSource || assets;
    const normalized = normalizePolicy(payload, sourceAssets);
    setPolicy(normalized);
    setSelectedAssetId(normalized.assets[0]?.assetId || null);
  };

  const loadSummary = async () => {
    const response = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/pricing/policies`);
    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, 'Failed to load pricing policy summary'));
    }
    const payload = await response.json();
    const nextSummary = (payload.items || []).find(
      (item: PolicySummary) => item.policyCode === 'WITHDRAWAL_PRICING',
    );
    setSummary(nextSummary || null);
  };

  const refresh = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const loadedAssets = await loadAssets();
      await Promise.all([loadPolicy(loadedAssets), loadSummary()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openDetail = (assetId: string) => {
    setSelectedAssetId(assetId);
    setViewMode('detail');
    setError(null);
    setMessage(null);
  };

  const renderTopBar = () => (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Withdrawal Config</h1>
        <p className="text-sm text-gray-500 mt-1">
          Asset-based fee rules (service fee + gas fee)
        </p>
      </div>
      <div className="flex items-center gap-2">
        {viewMode === 'detail' && (
          <button
            onClick={() => {
              setViewMode('list');
            }}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-admin-border bg-white text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeft size={16} /> Back to Asset List
          </button>
        )}
        <button
          onClick={refresh}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-admin-border bg-white text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>
    </div>
  );

  if (!policy) {
    return (
      <div className="space-y-4">
        {renderTopBar()}
        {error && <div className="rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>}
        {!error && (
          <div className="rounded-lg bg-white border border-admin-border px-4 py-3 text-sm text-gray-600">
            Loading withdrawal policy...
          </div>
        )}
      </div>
    );
  }

  if (viewMode === 'list') {
    return (
      <div className="space-y-6">
        {renderTopBar()}

        {error && <div className="rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>}
        {message && <div className="rounded-lg bg-green-50 text-green-700 px-4 py-3 text-sm">{message}</div>}

        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          Withdrawal pricing is now managed by config-as-code and Business Config Releases. This page is read-only for current policy inspection.
        </div>

        <div className="bg-white rounded-xl border border-admin-border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Asset</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Network</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Enabled</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Service Fee</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Gas Fee</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Last Updated</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {policy.assets.map((entry) => {
                const tier = entry.tiers[0];
                const service = tier.feeItems.find((item) => item.itemCode === 'WITHDRAW_SERVICE_FEE')!;
                const gas = tier.feeItems.find((item) => item.itemCode === 'NETWORK_FEE_EST')!;
                return (
                  <tr key={entry.assetId} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{entry.assetCode}</td>
                    <td className="px-4 py-3 text-gray-700">{entry.network || '-'}</td>
                    <td className="px-4 py-3 text-gray-700">{entry.enabled ? 'Enabled' : 'Disabled'}</td>
                    <td className="px-4 py-3 text-gray-700">{summarizeFee(service)}</td>
                    <td className="px-4 py-3 text-gray-700">{summarizeFee(gas)}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {summary ? (
                        <>
                          <div>{new Date(summary.lastUpdatedAt).toLocaleString('en-US')}</div>
                          <div className="text-gray-500">by {summary.lastUpdatedBy || 'SYSTEM'}</div>
                        </>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openDetail(entry.assetId)}
                        className="px-3 py-1.5 rounded-lg bg-brand-primary text-white hover:bg-brand-primary/90"
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const tier = selectedEntry?.tiers[0];
  const serviceFee =
    tier?.feeItems.find((item) => item.itemCode === 'WITHDRAW_SERVICE_FEE') || null;
  const gasFee =
    tier?.feeItems.find((item) => item.itemCode === 'NETWORK_FEE_EST') || null;

  return (
    <div className="space-y-4">
      {renderTopBar()}

      {error && <div className="rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>}
      {message && <div className="rounded-lg bg-green-50 text-green-700 px-4 py-3 text-sm">{message}</div>}

      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        Asset fee details remain explorable here, but edits and publish actions now move through Business Config Releases.
      </div>

      <div className="bg-white rounded-xl border border-admin-border p-6 space-y-6">
        {!selectedEntry && <div className="text-sm text-gray-500">No asset selected.</div>}
        {selectedEntry && tier && serviceFee && gasFee && (
          <>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Asset Fee Details</h2>
                <p className="text-sm text-gray-500 mt-1">Current service and gas fee for this asset.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setViewMode('list');
                  }}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-admin-border bg-white text-gray-700 hover:bg-gray-50"
                >
                  <ArrowLeft size={14} /> Back
                </button>
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-800">
                  {readOnlyMessage}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <FieldBlock label="Asset" value={selectedEntry.assetCode} />
              <FieldBlock label="Network" value={selectedEntry.network || '-'} />
              <FieldBlock label="Asset ID" value={selectedEntry.assetId} />
              <FieldBlock label="Enabled" value={selectedEntry.enabled ? 'Enabled' : 'Disabled'} />
            </div>

            {[serviceFee, gasFee].map((fee) => {
              const mode = getFeeMode(fee);
              const title =
                fee.itemCode === 'WITHDRAW_SERVICE_FEE'
                  ? 'Service Fee'
                  : 'Gas Fee';
              return (
                <div key={fee.itemCode} className="rounded-xl border border-admin-border p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <FieldBlock
                      label="Mode"
                      value={mode === 'PERCENT_WITH_MIN' ? 'Percent + Minimum' : 'Fixed'}
                    />

                    {mode === 'PERCENT_WITH_MIN' ? (
                      <>
                        <FieldBlock label="Percent (%)" value={fee.value} />
                        <FieldBlock
                          label={`Minimum (${selectedEntry.assetCode})`}
                          value={fee.min || '0'}
                        />
                      </>
                    ) : (
                      <div className="md:col-span-2">
                        <FieldBlock
                          label={`Fixed (${selectedEntry.assetCode})`}
                          value={fee.value}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
};

export default PricingWithdrawalConfigPage;

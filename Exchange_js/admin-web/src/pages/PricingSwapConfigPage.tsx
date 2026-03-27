import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Edit3, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { buildBusinessConfigReadOnlyMessage } from '../utils/businessConfigReadOnly';

type RoundingMode = 'ROUND' | 'FLOOR' | 'CEIL';

type Asset = {
  id: string;
  code: string;
  network: string | null;
  status: string;
};

type SwapTier = {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  rateMarkupBps: number;
  conditions: {
    amountMin: string | null;
    amountMax: string | null;
  };
  feeItems: unknown[];
};

type SwapPair = {
  id: string;
  name: string;
  assetAId: string;
  assetALabel: string;
  assetBId: string;
  assetBLabel: string;
  enabled: boolean;
  routing: {
    provider: 'LP_A';
    maxStalenessSec: number;
    quoteLockSeconds: number;
    rounding: {
      dp: number;
      mode: RoundingMode;
    };
  };
  tiers: SwapTier[];
};

type SwapPolicy = {
  policyId: string;
  policyName: string;
  business: 'SWAP';
  channel: {
    online: boolean;
    storeComingSoon: boolean;
  };
  pairs: SwapPair[];
};

type PolicySummary = {
  policyCode: string;
  lastUpdatedAt: string;
  lastUpdatedBy: string | null;
};

type SwapMarketSource = {
  pairId: string;
  provider: 'BINANCE';
  endpoint: string;
  symbol: string;
  bid: string;
  ask: string;
  sideUsed: 'BID' | 'INVERSE_ASK';
  aedPegApplied: boolean;
  aedPegRate: string;
  formula: string;
  effectiveBaseRate: string;
  fetchedAt: string;
};

const roundingModes: RoundingMode[] = ['ROUND', 'FLOOR', 'CEIL'];

function toInt(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function formatPairDirection(pair: SwapPair): string {
  return `${pair.assetALabel} → ${pair.assetBLabel}`;
}

const FieldBlock = ({ label, value }: { label: string; value: string }) => (
  <div className="space-y-1">
    <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
    <div className="px-3 py-2 rounded-lg border border-admin-border bg-gray-50 text-sm text-gray-800">
      {value}
    </div>
  </div>
);

const PricingSwapConfigPage = () => {
  const readOnlyMessage = buildBusinessConfigReadOnlyMessage('Swap pricing policy');
  const [loading, setLoading] = useState(false);
  const saving = false;
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [swapPolicy, setSwapPolicy] = useState<SwapPolicy | null>(null);
  const [swapSummary, setSwapSummary] = useState<PolicySummary | null>(null);

  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');
  const [detailMode, setDetailMode] = useState<'preview' | 'edit'>('preview');
  const [selectedPairId, setSelectedPairId] = useState<string | null>(null);
  const [editSnapshot, setEditSnapshot] = useState<SwapPair | null>(null);
  const [marketSource, setMarketSource] = useState<SwapMarketSource | null>(null);
  const [marketSourceLoading, setMarketSourceLoading] = useState(false);
  const [marketSourceError, setMarketSourceError] = useState<string | null>(null);

  const assetLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    assets.forEach((asset) => {
      map.set(asset.id, asset.network ? `${asset.code}-${asset.network}` : asset.code);
    });
    return map;
  }, [assets]);

  const selectedPair = useMemo(() => {
    if (!swapPolicy || !selectedPairId) return null;
    return swapPolicy.pairs.find((pair) => pair.id === selectedPairId) || null;
  }, [swapPolicy, selectedPairId]);

  const getAssetLabel = (assetId: string) => assetLabelMap.get(assetId) || assetId;

  const createDefaultTier = (pairId: string): SwapTier => ({
    id: `${pairId}-TIER-001`,
    name: 'Default Tier',
    priority: 1,
    enabled: true,
    rateMarkupBps: 0,
    conditions: {
      amountMin: '0',
      amountMax: null,
    },
    feeItems: [],
  });

  const normalizePair = (pair: SwapPair): SwapPair => {
    const tier = pair.tiers?.[0] || createDefaultTier(pair.id);
    const assetALabel = getAssetLabel(pair.assetAId);
    const assetBLabel = getAssetLabel(pair.assetBId);

    return {
      ...pair,
      name: pair.name || `${assetALabel} -> ${assetBLabel}`,
      assetALabel,
      assetBLabel,
      routing: {
        provider: 'LP_A',
        maxStalenessSec: Math.max(1, Number(pair.routing?.maxStalenessSec || 30)),
        quoteLockSeconds: Math.max(1, Number(pair.routing?.quoteLockSeconds || 30)),
        rounding: {
          dp: Math.max(0, Number(pair.routing?.rounding?.dp ?? 8)),
          mode: pair.routing?.rounding?.mode || 'ROUND',
        },
      },
      tiers: [
        {
          ...tier,
          priority: Math.max(1, Number(tier.priority || 1)),
          enabled: tier.enabled !== false,
          conditions: {
            amountMin: tier.conditions?.amountMin ?? '0',
            amountMax: tier.conditions?.amountMax ?? null,
          },
          feeItems: Array.isArray(tier.feeItems) ? tier.feeItems : [],
        },
      ],
    };
  };

  const normalizePolicy = (policy: SwapPolicy): SwapPolicy => ({
    ...policy,
    pairs: (policy.pairs || []).map(normalizePair),
  });

  const loadAssets = async () => {
    const response = await adminFetch(
      `${import.meta.env.VITE_API_URL}/assets?status=ACTIVE&take=200`,
    );
    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, 'Failed to load assets'));
    }
    const payload = await response.json();
    setAssets(payload.items || []);
  };

  const loadSwapPolicy = async () => {
    const response = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/pricing/policies/swap`);
    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, 'Failed to load swap policy'));
    }
    const payload = (await response.json()) as SwapPolicy;
    setSwapPolicy(payload);
    setSelectedPairId(payload.pairs[0]?.id || null);
  };

  const loadSwapSummary = async () => {
    const response = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/pricing/policies`);
    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, 'Failed to load pricing policy summary'));
    }
    const payload = await response.json();
    const summary = (payload.items || []).find((item: PolicySummary) => item.policyCode === 'SWAP_PRICING');
    setSwapSummary(summary || null);
  };

  const loadSwapPairMarketSource = async (pairId: string) => {
    setMarketSourceLoading(true);
    setMarketSourceError(null);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/pricing/policies/swap/pairs/${pairId}/market-source`,
      );
      if (!response.ok) {
        throw new Error(
          await getApiErrorMessage(response, 'Failed to load Binance market source'),
        );
      }
      const payload = (await response.json()) as SwapMarketSource;
      setMarketSource(payload);
    } catch (err) {
      setMarketSource(null);
      setMarketSourceError(err instanceof Error ? err.message : String(err));
    } finally {
      setMarketSourceLoading(false);
    }
  };

  const refresh = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      await Promise.all([loadAssets(), loadSwapPolicy(), loadSwapSummary()]);
      setDetailMode('preview');
      setEditSnapshot(null);
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

  useEffect(() => {
    if (!swapPolicy || assets.length === 0) return;

    const normalized = normalizePolicy(swapPolicy);
    const changed = JSON.stringify(normalized) !== JSON.stringify(swapPolicy);
    if (changed) {
      setSwapPolicy(normalized);
    }
  }, [assets, swapPolicy]);

  useEffect(() => {
    if (viewMode !== 'detail' || !selectedPairId) {
      setMarketSource(null);
      setMarketSourceError(null);
      return;
    }
    loadSwapPairMarketSource(selectedPairId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, selectedPairId]);

  const updatePair = (pairId: string, updater: (pair: SwapPair) => SwapPair) => {
    if (!swapPolicy) return;
    setSwapPolicy({
      ...swapPolicy,
      pairs: swapPolicy.pairs.map((pair) => (pair.id === pairId ? normalizePair(updater(pair)) : pair)),
    });
  };

  const openPairDetail = (pairId: string) => {
    setSelectedPairId(pairId);
    setViewMode('detail');
    setDetailMode('preview');
    setEditSnapshot(null);
    setMarketSource(null);
    setMarketSourceError(null);
    setError(null);
    setMessage(null);
  };

  const cancelEdit = () => {
    if (!selectedPairId) return;
    if (editSnapshot) {
      updatePair(selectedPairId, () => editSnapshot);
    }
    setDetailMode('preview');
    setEditSnapshot(null);
    setMessage(null);
  };

  const removePair = (pairId: string) => {
    void pairId;
    setError(null);
    setMessage(readOnlyMessage);
  };

  const savePolicy = async () => {
    setError(null);
    setMessage(readOnlyMessage);
  };

  const renderTopBar = () => (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Swap Config</h1>
        <p className="text-sm text-gray-500 mt-1">Directional pairs, Binance only, single tier</p>
      </div>
      <div className="flex items-center gap-2">
        {viewMode === 'detail' && detailMode === 'preview' && (
          <button
            onClick={() => {
              setViewMode('list');
              setDetailMode('preview');
              setEditSnapshot(null);
            }}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-admin-border bg-white text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeft size={16} /> Back to Pair List
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

  if (!swapPolicy) {
    return (
      <div className="space-y-4">
        {renderTopBar()}
        {error && <div className="rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>}
        {!error && <div className="rounded-lg bg-white border border-admin-border px-4 py-3 text-sm text-gray-600">Loading swap policy...</div>}
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
          Swap pricing is now managed by config-as-code and Business Config Releases. This page is read-only and remains here for current-value inspection.
        </div>

        <div className="flex justify-end">
          <div className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <Plus size={16} /> Pair changes move through Config Releases
          </div>
        </div>

        <div className="bg-white rounded-xl border border-admin-border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Pair ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Direction</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Provider</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Enabled</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Last Updated</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {swapPolicy.pairs.map((pair) => (
                <tr key={pair.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{pair.id}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{formatPairDirection(pair)}</td>
                  <td className="px-4 py-3 text-gray-700">BINANCE</td>
                  <td className="px-4 py-3 text-gray-700">{pair.enabled ? 'Enabled' : 'Disabled'}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {swapSummary ? (
                      <>
                        <div>{new Date(swapSummary.lastUpdatedAt).toLocaleString('en-US')}</div>
                        <div className="text-gray-500">by {swapSummary.lastUpdatedBy || 'SYSTEM'}</div>
                      </>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openPairDetail(pair.id)}
                      className="px-3 py-1.5 rounded-lg bg-brand-primary text-white hover:bg-brand-primary/90"
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
              {swapPolicy.pairs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    No pair configured.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const tier = selectedPair?.tiers[0];

  return (
    <div className="space-y-4">
      {renderTopBar()}

      {error && <div className="rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>}
      {message && <div className="rounded-lg bg-green-50 text-green-700 px-4 py-3 text-sm">{message}</div>}

      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        Pair details remain explorable here, but add, edit, delete, and publish actions are managed via Business Config Releases.
      </div>

      <div className="bg-white rounded-xl border border-admin-border p-6 space-y-6">
        {!selectedPair && <div className="text-sm text-gray-500">No pair selected.</div>}

        {selectedPair && tier && (
          <>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Pair Details</h2>
                <p className="text-sm text-gray-500 mt-1">Manage exchange-rate parameters for this direction.</p>
              </div>

              {detailMode === 'preview' ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setViewMode('list');
                      setDetailMode('preview');
                      setEditSnapshot(null);
                    }}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-admin-border bg-white text-gray-700 hover:bg-gray-50"
                  >
                    <ArrowLeft size={14} /> Back
                  </button>
                  <div className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-800">
                    <Edit3 size={14} /> Read-only in Phase 2
                  </div>
                  <button
                    onClick={() => removePair(selectedPair.id)}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={14} /> Change via Releases
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={cancelEdit}
                    disabled={saving}
                    className="px-3 py-1.5 rounded-lg border border-admin-border bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={savePolicy}
                    disabled={saving}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-brand-primary text-white hover:bg-brand-primary/90 disabled:opacity-60"
                  >
                    <Save size={14} /> Save
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <FieldBlock label="Pair ID" value={selectedPair.id} />
              <FieldBlock label="Provider" value="BINANCE" />
              <FieldBlock label="From Asset" value={selectedPair.assetALabel} />
              <FieldBlock label="To Asset" value={selectedPair.assetBLabel} />
              <FieldBlock label="Tier ID" value={tier.id} />
              <FieldBlock label="Tier Name" value={tier.name} />
              <FieldBlock label="Tier Enabled" value={tier.enabled ? 'Enabled' : 'Disabled'} />
              <FieldBlock label="Tier Priority" value={String(tier.priority)} />
              <FieldBlock label="Amount Min" value={tier.conditions.amountMin ?? 'None'} />
              <FieldBlock label="Amount Max" value={tier.conditions.amountMax ?? 'None'} />

              <div className="space-y-1">
                <div className="text-xs text-gray-500 uppercase tracking-wide">Trading Status</div>
                {detailMode === 'edit' ? (
                  <select
                    value={selectedPair.enabled ? 'true' : 'false'}
                    onChange={(e) =>
                      updatePair(selectedPair.id, (pair) => ({
                        ...pair,
                        enabled: e.target.value === 'true',
                      }))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-admin-border"
                  >
                    <option value="true">Enabled</option>
                    <option value="false">Disabled</option>
                  </select>
                ) : (
                  <div className="px-3 py-2 rounded-lg border border-admin-border bg-gray-50 text-gray-800">
                    {selectedPair.enabled ? 'Enabled' : 'Disabled'}
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <div className="text-xs text-gray-500 uppercase tracking-wide">Markup (bps)</div>
                {detailMode === 'edit' ? (
                  <input
                    type="number"
                    value={tier.rateMarkupBps}
                    onChange={(e) =>
                      updatePair(selectedPair.id, (pair) => ({
                        ...pair,
                        tiers: [
                          {
                            ...pair.tiers[0],
                            rateMarkupBps: toInt(e.target.value, 0),
                          },
                        ],
                      }))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-admin-border"
                  />
                ) : (
                  <div className="px-3 py-2 rounded-lg border border-admin-border bg-gray-50 text-gray-800">
                    {tier.rateMarkupBps}
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <div className="text-xs text-gray-500 uppercase tracking-wide">Max Staleness (sec)</div>
                {detailMode === 'edit' ? (
                  <input
                    type="number"
                    value={selectedPair.routing.maxStalenessSec}
                    onChange={(e) =>
                      updatePair(selectedPair.id, (pair) => ({
                        ...pair,
                        routing: {
                          ...pair.routing,
                          maxStalenessSec: Math.max(1, toInt(e.target.value, 30)),
                        },
                      }))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-admin-border"
                  />
                ) : (
                  <div className="px-3 py-2 rounded-lg border border-admin-border bg-gray-50 text-gray-800">
                    {selectedPair.routing.maxStalenessSec}
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <div className="text-xs text-gray-500 uppercase tracking-wide">Quote TTL (sec)</div>
                {detailMode === 'edit' ? (
                  <input
                    type="number"
                    value={selectedPair.routing.quoteLockSeconds}
                    onChange={(e) =>
                      updatePair(selectedPair.id, (pair) => ({
                        ...pair,
                        routing: {
                          ...pair.routing,
                          quoteLockSeconds: Math.max(1, toInt(e.target.value, 30)),
                        },
                      }))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-admin-border"
                  />
                ) : (
                  <div className="px-3 py-2 rounded-lg border border-admin-border bg-gray-50 text-gray-800">
                    {selectedPair.routing.quoteLockSeconds}
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <div className="text-xs text-gray-500 uppercase tracking-wide">Rounding Precision (dp)</div>
                {detailMode === 'edit' ? (
                  <input
                    type="number"
                    value={selectedPair.routing.rounding.dp}
                    onChange={(e) =>
                      updatePair(selectedPair.id, (pair) => ({
                        ...pair,
                        routing: {
                          ...pair.routing,
                          rounding: {
                            ...pair.routing.rounding,
                            dp: Math.max(0, toInt(e.target.value, 8)),
                          },
                        },
                      }))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-admin-border"
                  />
                ) : (
                  <div className="px-3 py-2 rounded-lg border border-admin-border bg-gray-50 text-gray-800">
                    {selectedPair.routing.rounding.dp}
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <div className="text-xs text-gray-500 uppercase tracking-wide">Rounding Mode</div>
                {detailMode === 'edit' ? (
                  <select
                    value={selectedPair.routing.rounding.mode}
                    onChange={(e) =>
                      updatePair(selectedPair.id, (pair) => ({
                        ...pair,
                        routing: {
                          ...pair.routing,
                          rounding: {
                            ...pair.routing.rounding,
                            mode: e.target.value as RoundingMode,
                          },
                        },
                      }))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-admin-border"
                  >
                    {roundingModes.map((mode) => (
                      <option key={mode} value={mode}>
                        {mode}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="px-3 py-2 rounded-lg border border-admin-border bg-gray-50 text-gray-800">
                    {selectedPair.routing.rounding.mode}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-admin-border bg-gray-50/50 p-4 space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Fee Snapshot (Read-only)</h3>
                <p className="text-xs text-gray-500 mt-1">
                  This section reflects the active runtime tier config, including disabled tiers, amount range, and fee items.
                </p>
              </div>
              {tier.feeItems.length > 0 ? (
                <pre className="text-xs bg-white border border-gray-200 rounded-lg p-3 overflow-auto text-gray-700">
                  {JSON.stringify(tier.feeItems, null, 2)}
                </pre>
              ) : (
                <div className="text-sm text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-2">
                  No fee items configured for this tier.
                </div>
              )}
            </div>

            <div className="rounded-xl border border-admin-border bg-gray-50/50 p-4 space-y-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">
                    Binance Pricing Source (Read-only)
                  </h3>
                  <p className="text-xs text-gray-500 mt-1">
                    Pricing uses Binance order book (`bookTicker`) with directional side logic and AED peg conversion.
                  </p>
                </div>
                <button
                  onClick={() => loadSwapPairMarketSource(selectedPair.id)}
                  disabled={marketSourceLoading}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-admin-border bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  <RefreshCw size={14} className={marketSourceLoading ? 'animate-spin' : ''} />
                  Refresh Source
                </button>
              </div>

              {marketSourceError && (
                <div className="rounded-lg bg-red-50 text-red-700 px-3 py-2 text-xs">
                  {marketSourceError}
                </div>
              )}

              {marketSourceLoading && !marketSource && (
                <div className="text-xs text-gray-500">Loading source details...</div>
              )}

              {marketSource && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <FieldBlock label="Endpoint" value={marketSource.endpoint} />
                  <FieldBlock label="Symbol" value={marketSource.symbol} />
                  <FieldBlock label="Bid" value={marketSource.bid} />
                  <FieldBlock label="Ask" value={marketSource.ask} />
                  <FieldBlock
                    label="Side Used"
                    value={marketSource.sideUsed === 'BID' ? 'BID' : '1 / ASK'}
                  />
                  <FieldBlock
                    label="AED Peg"
                    value={
                      marketSource.aedPegApplied
                        ? `Applied (${marketSource.aedPegRate})`
                        : `Not applied (${marketSource.aedPegRate})`
                    }
                  />
                  <FieldBlock
                    label="Effective Base Rate"
                    value={marketSource.effectiveBaseRate}
                  />
                  <FieldBlock
                    label="Updated At"
                    value={new Date(marketSource.fetchedAt).toLocaleString('en-US')}
                  />
                  <div className="md:col-span-2">
                    <FieldBlock label="Formula" value={marketSource.formula} />
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default PricingSwapConfigPage;

// admin-web/src/pages/funds-layer/SettlementDetailPage.tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import {
  DetailPageHeader,
  InfoField,
} from '../../components/compliance/DetailPageComponents';
import { SidebarGroup, SidebarKV } from '../../components/ui/SidebarPrimitives';
import { StatusPill } from '../../components/ui/StatusPill';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../../utils/adminFetch';

/* ── Types ──────────────────────────────────────────────────── */

interface SettlementTransfer {
  internalTxNo: string;
  assetCode: string | null;
  asset?: { code?: string | null; currency?: string | null } | null;
  grossInAmount: string | null;
  grossOutAmount: string | null;
  netAmount: string;
  pathLabel: string | null;
  status: string;
}

interface SettlementDetail {
  batchNo: string;
  settlementType: string | null;
  cutoffAt: string | null;
  status: string;
  totalAssetCount: number | null;
  settledAssetCount: number | null;
  totalOutstandingCount: number | null;
  settledOutstandingCount: number | null;
  transfers: SettlementTransfer[];
  createdAt: string;
  completedAt: string | null;
}

/* ── Helpers ────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/* ── Page Component ─────────────────────────────────────────── */

const SettlementDetailPage = () => {
  const { batchNo } = useParams<{ batchNo: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<SettlementDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    if (!batchNo) return;
    setLoading(true);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/funds-layer/settlements/${batchNo}`,
      );
      if (response.ok) {
        const result: SettlementDetail = await response.json();
        setData(result);
      } else {
        alert(await getApiErrorMessage(response, 'Failed to load settlement detail'));
        navigate('/admin/funds/settlements');
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch settlement detail', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (batchNo) void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchNo]);

  if (loading) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center">
        <RefreshCw className="mb-4 animate-spin text-adm-amber" size={32} />
        <p className="text-adm-t3">Loading settlement detail...</p>
      </div>
    );
  }

  if (!data) return null;

  const transfers = data.transfers ?? [];

  return (
    <div className="flex h-full flex-col">
      {/* ── Nav Header (back + refresh only) ── */}
      <DetailPageHeader
        onBack={() => navigate('/admin/funds/settlements')}
        onRefresh={fetchData}
        refreshing={loading}
        backLabel="Settlement Batches"
      />

      {/* ── Body: Main + Sidebar ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ── Main Body ── */}
        <div className="flex-1 divide-y divide-adm-border overflow-y-auto">
          {/* 1. Hero */}
          <div className="bg-adm-card px-6 py-5">
            <div className="font-mono text-[19px] font-bold text-adm-amber">
              {data.batchNo}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Status
                </span>
                <span className="mt-1 inline-block">
                  <StatusPill value={data.status} size="md" />
                </span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Type
                </span>
                <span className="font-mono text-adm-t1">{data.settlementType || '—'}</span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Cutoff
                </span>
                <span className="font-mono text-adm-t1">{fmt(data.cutoffAt)}</span>
              </div>
            </div>
          </div>

          {/* 2. Core Context */}
          <div className="px-6 py-5">
            <h3 className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">
              Settlement Context
            </h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <InfoField
                label="Assets Settled"
                value={`${data.settledAssetCount ?? 0} / ${data.totalAssetCount ?? 0}`}
                mono
              />
              <InfoField
                label="Outstanding Settled"
                value={`${data.settledOutstandingCount ?? 0} / ${data.totalOutstandingCount ?? 0}`}
                mono
              />
            </div>
          </div>

          {/* 3. Per-asset settlement transfers */}
          <div className="px-6 py-5">
            <h3 className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">
              Settlement Transfers
            </h3>
            {transfers.length === 0 ? (
              <div className="p-4 text-center text-sm italic text-adm-t3">No settlement transfers</div>
            ) : (
              <div className="space-y-4">
                {transfers.map((t) => {
                  const assetCode = t.assetCode || t.asset?.code || t.asset?.currency || '—';
                  return (
                    <div
                      key={t.internalTxNo}
                      className="rounded-lg border border-adm-border bg-adm-bg p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono text-[11px] font-semibold text-adm-amber">
                          {assetCode}
                        </span>
                        <StatusPill value={t.status} />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 font-mono text-[10px] text-adm-t3">
                        <span>
                          In: <span className="text-adm-t2">{t.grossInAmount ?? '0'}</span>
                        </span>
                        <span>
                          Out: <span className="text-adm-t2">{t.grossOutAmount ?? '0'}</span>
                        </span>
                        <span>
                          Net: <span className="text-adm-t2">{t.netAmount}</span>
                        </span>
                        <span>
                          Direction:{' '}
                          <span className="text-adm-t2">{t.pathLabel || '—'}</span>
                        </span>
                        <span
                          className="cursor-pointer break-all text-adm-blue hover:underline"
                          onClick={() => navigate('/admin/funds/transfers/' + t.internalTxNo)}
                        >
                          Transfer: {t.internalTxNo}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>

        {/* ── Sidebar ── */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">
          {/* IDENTITY SUMMARY */}
          <SidebarGroup title="Identity">
            <SidebarKV label="Batch No" value={data.batchNo} mono />
            <SidebarKV label="Status" value={<StatusPill value={data.status} />} />
            <SidebarKV label="Settlement Type" value={data.settlementType} mono />
          </SidebarGroup>

          {/* LIFECYCLE */}
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={fmt(data.createdAt)} mono />
            <SidebarKV label="Cutoff" value={fmt(data.cutoffAt)} mono />
            <SidebarKV
              label="Completed"
              value={data.completedAt ? fmt(data.completedAt) : null}
              mono
            />
          </SidebarGroup>
        </div>
      </div>
    </div>
  );
};

export default SettlementDetailPage;

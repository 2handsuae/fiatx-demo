// admin-web/src/pages/funds-layer/InternalTransferDetailPage.tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import {
  DetailPageHeader,
  InfoField,
  JsonBlock,
} from '../../components/compliance/DetailPageComponents';
import { SidebarGroup, SidebarKV } from '../../components/ui/SidebarPrimitives';
import { AdminBadge } from '../../components/ui/AdminBadge';
import { formatAssetAmount } from '../../utils/number-format';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../../utils/adminFetch';

/* ── Types ──────────────────────────────────────────────────── */

interface TransferAsset {
  code: string;
  currency?: string | null;
  type?: string | null;
  network?: string | null;
  decimals?: number;
}

interface TransferWallet {
  walletNo: string | null;
  walletRole: string;
  ownerType: string;
  ownerNo?: string | null;
}

interface FundLeg {
  id: string;
  internalFundNo: string;
  status: string;
  amount: string;
}

interface TransferDetail {
  internalTxNo: string;
  status: string;
  pathLabel: string | null;
  accountingClass: string | null;
  medium: string | null;
  traceId: string | null;
  amount: string;
  fromWallet: TransferWallet | null;
  toWallet: TransferWallet | null;
  asset: TransferAsset | null;
  funds: FundLeg[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/* ── Page Component ─────────────────────────────────────────── */

const InternalTransferDetailPage = () => {
  const { internalTxNo } = useParams<{ internalTxNo: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<TransferDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    if (!internalTxNo) return;
    setLoading(true);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/funds-layer/transfers/${internalTxNo}`,
      );
      if (response.ok) {
        const result: TransferDetail = await response.json();
        setData(result);
      } else {
        alert(await getApiErrorMessage(response, 'Failed to load transfer detail'));
        navigate('/admin/funds/transfers');
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch transfer detail', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (internalTxNo) void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [internalTxNo]);

  if (loading) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center">
        <RefreshCw className="mb-4 animate-spin text-adm-amber" size={32} />
        <p className="text-adm-t3">Loading transfer detail...</p>
      </div>
    );
  }

  if (!data) return null;

  const decimals = data.asset?.decimals;
  const assetCode = data.asset?.code || data.asset?.currency || '—';
  const amountDisplay = `${formatAssetAmount(data.amount, decimals)} ${data.asset?.code || ''}`.trim();

  const walletLine = (w: TransferWallet | null): string =>
    w ? `${w.walletNo || '—'} · ${w.walletRole}` : '—';

  return (
    <div className="flex h-full flex-col">
      {/* ── Nav Header (back + refresh only) ── */}
      <DetailPageHeader
        onBack={() => navigate('/admin/funds/transfers')}
        onRefresh={fetchData}
        refreshing={loading}
        backLabel="Internal Transfers"
      />

      {/* ── Body: Main + Sidebar ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ── Main Body ── */}
        <div className="flex-1 divide-y divide-adm-border overflow-y-auto">
          {/* 1. Hero */}
          <div className="bg-adm-card px-6 py-5">
            <div className="font-mono text-[19px] font-bold text-adm-amber">
              {data.internalTxNo}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Status
                </span>
                <span className="mt-1 inline-block">
                  <AdminBadge value={data.status} />
                </span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Path
                </span>
                <span className="font-mono text-adm-t1">{data.pathLabel || '—'}</span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Asset
                </span>
                <span className="font-mono text-adm-t1">{assetCode}</span>
              </div>
            </div>
          </div>

          {/* 2. Core Context */}
          <div className="px-6 py-5">
            <h3 className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">
              Transfer Context
            </h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <InfoField label="From Wallet" value={walletLine(data.fromWallet)} mono />
              <InfoField label="To Wallet" value={walletLine(data.toWallet)} mono />
              <InfoField label="Amount" value={amountDisplay} accent />
              <InfoField label="Accounting Class" value={data.accountingClass} mono />
              <InfoField label="Medium" value={data.medium} mono />
              <InfoField label="Trace ID" value={data.traceId} mono />
            </div>
          </div>

          {/* 3. Funds binding rows */}
          <div className="px-6 py-5">
            <h3 className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">
              Funds
            </h3>
            {data.funds.length === 0 ? (
              <div className="p-4 text-center text-sm italic text-adm-t3">No funds bound</div>
            ) : (
              <div className="divide-y divide-adm-border rounded-lg border border-adm-border">
                {data.funds.map((leg) => (
                  <div key={leg.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="font-mono text-[11px] font-semibold text-adm-amber">{leg.internalFundNo}</span>
                    <AdminBadge value={leg.status} />
                    <span className="font-mono text-[10px] text-adm-t2">
                      {formatAssetAmount(leg.amount, decimals)} {data.asset?.code || ''}
                    </span>
                    <span
                      className="cursor-pointer font-mono text-[10px] text-adm-blue hover:underline"
                      onClick={() => navigate(`/admin/funds/internal-funds/${leg.internalFundNo}`)}
                    >
                      View →
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 4. Technical Detail (last) */}
          <div className="px-6 py-5">
            <h3 className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">
              Technical Detail
            </h3>
            <div className="mt-1 space-y-3">
              <JsonBlock
                title="Execution Legs (raw)"
                value={data.funds.map((leg) => ({
                  id: leg.id,
                  internalFundNo: leg.internalFundNo,
                  status: leg.status,
                }))}
                compact
              />
            </div>
          </div>
        </div>

        {/* ── Sidebar ── */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">
          {/* IDENTITY SUMMARY */}
          <SidebarGroup title="Identity">
            <SidebarKV label="Internal Tx No" value={data.internalTxNo} mono />
            <SidebarKV label="Path" value={data.pathLabel} mono />
            <SidebarKV label="Status" value={<AdminBadge value={data.status} />} />
            <SidebarKV label="Asset" value={data.asset?.code || data.asset?.currency || null} />
          </SidebarGroup>

          {/* LIFECYCLE */}
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={new Date(data.createdAt).toLocaleString()} mono />
            <SidebarKV
              label="Completed"
              value={data.completedAt ? new Date(data.completedAt).toLocaleString() : null}
              mono
            />
            <SidebarKV label="Updated" value={new Date(data.updatedAt).toLocaleString()} mono />
          </SidebarGroup>
        </div>
      </div>
    </div>
  );
};

export default InternalTransferDetailPage;

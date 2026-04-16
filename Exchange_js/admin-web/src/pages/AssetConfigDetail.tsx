import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DetailPageHeader } from '../components/compliance/DetailPageComponents';
import { AdminBadge } from '../components/ui/AdminBadge';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

/* ── Types ─────────────────────────────────────────────────────── */

interface AssetPayload {
  assetNo: string;
  code: string;
  type: 'FIAT' | 'CRYPTO';
  network: string;
  decimals: number;
  description: string | null;
  status: 'ACTIVE' | 'DISABLED';
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  depositMinAmount: string;
  depositMaxAmount: string | null;
  withdrawMinAmount: string;
  withdrawMaxAmount: string | null;
  minConfirmations: number | null;
}

interface ReleaseContext {
  releaseNo: string;
  publishedAt: string | null;
  effectiveFrom: string | null;
}

/* ── Local layout primitives ─────────────────────────────────────── */

const Cap = ({ children }: { children: ReactNode }) => (
  <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
    {children}
  </p>
);

const FieldGrid = ({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 }) => (
  <div
    className={[
      'grid gap-x-8 gap-y-4',
      cols === 1 ? 'grid-cols-1' : 'grid-cols-2',
    ].join(' ')}
  >
    {children}
  </div>
);

const Field = ({
  label,
  value,
  mono = false,
  amber = false,
  full = false,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  amber?: boolean;
  full?: boolean;
}) => {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className={full ? 'col-span-2' : ''}>
      <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
        {label}
      </p>
      <p
        className={[
          'break-all leading-relaxed',
          mono ? 'font-mono text-[10px]' : 'text-[11px]',
          amber ? 'font-semibold text-adm-amber' : 'text-adm-t2',
        ].join(' ')}
      >
        {value}
      </p>
    </div>
  );
};

const SidebarGroup = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="border-b border-adm-border py-4 last:border-b-0">
    <Cap>{title}</Cap>
    <div className="mt-2.5 flex flex-col gap-1.5">{children}</div>
  </div>
);

const SidebarKV = ({
  label,
  value,
  mono = false,
}: {
  label: string;
  value?: ReactNode;
  mono?: boolean;
}) => {
  if (value === null || value === undefined || value === '' || value === '—') return null;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 font-mono text-[9px] text-adm-t3">{label}</span>
      <span
        className={[
          'min-w-0 break-all text-right text-adm-t2',
          mono ? 'font-mono text-[10px]' : 'text-[11px]',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  );
};

const TypeBadge = ({ type }: { type: 'FIAT' | 'CRYPTO' }) => (
  <span
    className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest ${
      type === 'FIAT'
        ? 'border-adm-blue/25 bg-adm-blue/10 text-adm-blue'
        : 'border-adm-amber/25 bg-adm-amber/10 text-adm-amber'
    }`}
  >
    {type}
  </span>
);

/* ── Helpers ─────────────────────────────────────────────────────── */

const fmtDate = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(Number(v));
  if (Number.isNaN(d.getTime())) {
    const d2 = new Date(v);
    return Number.isNaN(d2.getTime()) ? v : d2.toLocaleString();
  }
  return d.toLocaleString();
};

/* ── Component ─────────────────────────────────────────────────── */

const AssetConfigDetail = () => {
  const { assetNo } = useParams<{ assetNo: string }>();
  const navigate = useNavigate();

  const [payload, setPayload] = useState<AssetPayload | null>(null);
  const [release, setRelease] = useState<ReleaseContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const relListRes = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/business-config/releases?subjectType=ASSET_CONFIG&status=ACTIVE&take=1`,
      );

      if (!relListRes.ok)
        throw new Error(await getApiErrorMessage(relListRes, 'Failed to fetch releases.'));

      const listData = await relListRes.json();
      const first = listData?.items?.[0];
      if (!first?.releaseNo) throw new Error('No active ASSET_CONFIG release found.');

      const detailRes = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/business-config/releases/${first.releaseNo as string}`,
      );
      if (!detailRes.ok)
        throw new Error(await getApiErrorMessage(detailRes, 'Failed to fetch release detail.'));

      const detail = await detailRes.json();
      const item = (detail.items as Array<{ businessKey: string; payload: unknown }> | undefined)?.find(
        (i) => i.businessKey === assetNo,
      );
      if (!item) throw new Error(`Asset "${assetNo}" not found in current release.`);

      setPayload(item.payload as AssetPayload);
      setRelease({
        releaseNo: detail.releaseNo as string,
        publishedAt: (detail.publishedAt ?? null) as string | null,
        effectiveFrom: (detail.effectiveFrom ?? null) as string | null,
      });
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load asset.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [assetNo]);

  /* ── Loading stub ── */
  if (loading && !payload) {
    return (
      <div className="flex h-full items-center justify-center gap-3">
        <p className="font-mono text-[11px] text-adm-t3">Loading…</p>
      </div>
    );
  }

  /* ── Error stub ── */
  if (error && !payload) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 border-b border-adm-border bg-adm-panel px-6 py-4 flex items-center gap-2">
          <button
            onClick={() => navigate('/dashboard/system/asset-configs')}
            className="inline-flex items-center gap-1.5 rounded border border-adm-border bg-adm-panel px-3 py-1.5 font-mono text-[11px] text-adm-t2 hover:bg-adm-hover"
          >
            ← Assets
          </button>
        </div>
        <div className="px-6 py-6">
          <div className="rounded-lg border border-adm-red/30 bg-adm-red/10 px-4 py-3 font-mono text-[11px] text-adm-red">
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (!payload) return null;

  const isCrypto = payload.type === 'CRYPTO';
  const effectiveDate = release?.effectiveFrom ?? release?.publishedAt;

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Sticky header ── */}
      <DetailPageHeader
        title="Asset · Operational Config"
        subtitle={`${payload.code}${payload.network ? ` · ${payload.network}` : ''}`}
        onBack={() => navigate('/dashboard/system/asset-configs')}
        onRefresh={() => void fetchData()}
        refreshing={loading}
        backLabel="Assets"
      />

      {/* ── Inline error (after data loaded) ── */}
      {error && (
        <div className="shrink-0 px-6 pt-3 pb-1">
          <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">
            {error}
          </div>
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ════ LEFT MAIN ════ */}
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">

          {/* ① Identity */}
          <section className="bg-adm-card px-6 py-5">
            <Cap>Asset</Cap>
            <div className="mt-1.5 flex items-baseline gap-2">
              <p className="font-mono text-[19px] font-bold leading-snug text-adm-amber">
                {payload.code}
              </p>
              {payload.network && (
                <span className="font-mono text-[13px] text-adm-t3">
                  · {payload.network}
                </span>
              )}
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <TypeBadge type={payload.type} />
              <AdminBadge value={payload.status} />
            </div>
            <div className="mt-4 border-t border-adm-border pt-4">
              <p className="font-mono text-[11px] text-adm-t2">{payload.assetNo}</p>
              {payload.description && (
                <p className="mt-1 font-mono text-[10px] text-adm-t3">{payload.description}</p>
              )}
            </div>
          </section>

          {/* ② Deposit */}
          <section className="px-6 py-5">
            <Cap>Deposit</Cap>
            <div className="mt-3">
              <FieldGrid>
                <Field
                  label="Enabled"
                  value={payload.depositEnabled ? 'Yes' : 'No'}
                  amber={payload.depositEnabled}
                />
                <Field
                  label="Min Amount"
                  value={`${payload.depositMinAmount} ${payload.code}`}
                  mono
                />
                <Field
                  label="Max Amount"
                  value={payload.depositMaxAmount ? `${payload.depositMaxAmount} ${payload.code}` : 'No limit'}
                  mono
                />
              </FieldGrid>
            </div>
          </section>

          {/* ③ Withdrawal */}
          <section className="px-6 py-5">
            <Cap>Withdrawal</Cap>
            <div className="mt-3">
              <FieldGrid>
                <Field
                  label="Enabled"
                  value={payload.withdrawEnabled ? 'Yes' : 'No'}
                  amber={payload.withdrawEnabled}
                />
                <Field
                  label="Min Amount"
                  value={`${payload.withdrawMinAmount} ${payload.code}`}
                  mono
                />
                <Field
                  label="Max Amount"
                  value={payload.withdrawMaxAmount ? `${payload.withdrawMaxAmount} ${payload.code}` : 'No limit'}
                  mono
                />
              </FieldGrid>
            </div>
          </section>

          {/* ④ Blockchain (CRYPTO only) */}
          {isCrypto && (
            <section className="px-6 py-5">
              <Cap>Blockchain</Cap>
              <div className="mt-3">
                <FieldGrid>
                  <Field
                    label="Min Confirmations"
                    value={
                      payload.minConfirmations != null
                        ? `${payload.minConfirmations} blocks`
                        : '—'
                    }
                    mono
                  />
                </FieldGrid>
              </div>
            </section>
          )}

        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">

          {/* Release */}
          {release && (
            <SidebarGroup title="Release">
              <SidebarKV label="Release No"   value={release.releaseNo}            mono />
              <SidebarKV label="Effective"    value={fmtDate(effectiveDate)}       mono />
              <SidebarKV label="Published"    value={fmtDate(release.publishedAt)} mono />
            </SidebarGroup>
          )}

          {/* Asset Properties */}
          <SidebarGroup title="Properties">
            <SidebarKV label="Decimals" value={String(payload.decimals)} mono />
          </SidebarGroup>

          {/* Navigation */}
          <SidebarGroup title="History">
            <button
              onClick={() => navigate('/dashboard/system/asset-configs/history')}
              className="text-left font-mono text-[10px] text-adm-amber underline transition-opacity hover:opacity-75"
            >
              View all versions →
            </button>
          </SidebarGroup>

        </div>
      </div>

    </div>
  );
};

export default AssetConfigDetail;

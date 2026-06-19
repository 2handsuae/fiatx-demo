// admin-web/src/pages/ReconciliationStatementDetailPage.tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import {
  DetailPageHeader,
  DetailCard,
  InfoField,
  JsonBlock,
} from '../components/compliance/DetailPageComponents';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { StatusPill } from '../components/ui/StatusPill';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

/* ── Types ──────────────────────────────────────────────────── */

interface ZandRecord {
  ChannelRefId?: string;
  InstructionIdentification?: string;
  ValueDate?: string;
  PostedDate?: string;
  InstructedAmount?: { Amount?: string; Currency?: string };
  TransactionAmount?: { Amount?: string; Currency?: string };
  TransactionType?: string; // Credit | Debit
  Remarks?: string;
  BeneficiaryDetails?: string;
  Description?: string;
  PartType?: string;
  Balance?: string;
  VirtualAccount?: string;
}

interface HextrustTx {
  id?: string;
  traceId?: string;
  txHash?: string;
  amountDecimal?: string;
  assetKey?: string;
  transactionType?: string;
  primaryTransactionStatus?: string;
  vaultId?: string;
  from?: string;
  to?: string;
  confirmationCount?: number;
  blockTimestamp?: string;
  createdAt?: string;
}

interface ParsedZand {
  kind: 'ZAND';
  info?: { FromDate?: string; ToDate?: string; AccountId?: string };
  records: ZandRecord[];
}

interface ParsedHextrust {
  kind: 'HEXTRUST';
  txs: HextrustTx[];
}

interface ParsedUnknown {
  kind: string;
  parseError?: boolean;
}

type ParsedStatement = ParsedZand | ParsedHextrust | ParsedUnknown;

interface ExternalStatementDetail {
  id: string;
  statementNo: string;
  source: string;
  businessDate: string;
  currency: string;
  accountRef: string;
  closingBalance: string;
  rawJson: string;
  fetchedAt: string;
  createdAt: string;
  parsed: ParsedStatement;
}

/* ── Helpers ────────────────────────────────────────────────── */

const fmtTime = (v: string | null) => (v ? new Date(v).toLocaleString() : null);
const truncate = (v: string | undefined | null, head = 10, tail = 8) => {
  if (!v) return '—';
  if (v.length <= head + tail + 1) return v;
  return `${v.slice(0, head)}…${v.slice(-tail)}`;
};

const isZand = (p: ParsedStatement): p is ParsedZand => p.kind === 'ZAND';
const isHextrust = (p: ParsedStatement): p is ParsedHextrust => p.kind === 'HEXTRUST';

const entryCount = (p: ParsedStatement): number => {
  if (isZand(p)) return p.records?.length ?? 0;
  if (isHextrust(p)) return p.txs?.length ?? 0;
  return 0;
};

// Small adm-* pill for the HexTrust transaction type — no raw Tailwind colors.
const TypePill = ({ value }: { value: string | undefined }) => {
  if (!value) return <span className="text-adm-t3">—</span>;
  const up = value.toUpperCase();
  const tone = up.includes('DEPOSIT')
    ? 'border-adm-green/30 bg-adm-green/10 text-adm-green'
    : up.includes('WITHDRAW')
      ? 'border-adm-blue/30 bg-adm-blue/10 text-adm-blue'
      : 'border-adm-border bg-adm-bg text-adm-t2';
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-[9px] font-semibold ${tone}`}
    >
      {value}
    </span>
  );
};

/* ── Page Component ─────────────────────────────────────────── */

const ReconciliationStatementDetailPage = () => {
  const { statementNo } = useParams<{ statementNo: string }>();
  const navigate = useNavigate();
  const [stmt, setStmt] = useState<ExternalStatementDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatement = async () => {
    if (!statementNo) return;
    setLoading(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/statements/${encodeURIComponent(statementNo)}`,
      );
      if (res.ok) {
        setStmt((await res.json()) as ExternalStatementDetail);
      } else {
        alert(await getApiErrorMessage(res, 'Failed to load external statement'));
        navigate('/admin/reconciliation/statements');
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch external statement', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (statementNo) void fetchStatement();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statementNo]);

  if (loading && !stmt) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center">
        <RefreshCw className="mb-4 animate-spin text-adm-amber" size={32} />
        <p className="text-adm-t3">Loading external statement...</p>
      </div>
    );
  }

  if (!stmt) return null;

  const parsed = stmt.parsed;
  const count = entryCount(parsed);

  return (
    <div className="flex h-full flex-col">
      {/* ── Nav Header (back + refresh only) ── */}
      <DetailPageHeader
        onBack={() => navigate('/admin/reconciliation/statements')}
        onRefresh={fetchStatement}
        refreshing={loading}
        backLabel="Statements"
      />

      {/* ── Body: Main + Sidebar ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ── Main Body ── */}
        <div className="flex-1 divide-y divide-adm-border overflow-y-auto">
          {/* 1. Hero */}
          <div className="bg-adm-card px-6 py-5">
            <div className="font-mono text-[19px] font-bold text-adm-amber">{stmt.statementNo}</div>
            <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Source
                </span>
                <span className="mt-1 inline-block">
                  <StatusPill value={stmt.source} size="md" />
                </span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Currency
                </span>
                <span className="font-mono text-adm-t1">{stmt.currency}</span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Closing Balance
                </span>
                <span className="font-mono font-semibold text-adm-t1">{stmt.closingBalance}</span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Business Date
                </span>
                <span className="font-mono text-adm-t1">{stmt.businessDate}</span>
              </div>
            </div>
          </div>

          {/* 2. Statement Info */}
          <DetailCard title="Statement Info" columns={3}>
            <InfoField label="Source" value={stmt.source} />
            <InfoField label="Account Ref" value={stmt.accountRef} mono />
            <InfoField label="Closing Balance" value={stmt.closingBalance} highlight />
            <InfoField label="Business Date" value={stmt.businessDate} mono />
            <InfoField label="Fetched At" value={fmtTime(stmt.fetchedAt)} mono />
            <InfoField label="Entry Count" value={String(count)} mono />
          </DetailCard>

          {/* 3. Entries (source-aware) */}
          {isZand(parsed) && (
            <DetailCard title={`Statement Records (${parsed.records?.length ?? 0})`} columns={1}>
              <div className="overflow-x-auto rounded-lg border border-adm-border">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-adm-border bg-adm-bg">
                    <tr>
                      {['Value Date', 'Channel Ref', 'Description', 'Amount', 'Balance', 'Virtual Account'].map(
                        (h) => (
                          <th
                            key={h}
                            className={`px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3 ${h === 'Amount' || h === 'Balance' ? 'text-right' : 'text-left'}`}
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-adm-border">
                    {(parsed.records?.length ?? 0) === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-3 py-8 text-center font-mono text-[11px] text-adm-t3"
                        >
                          No statement records.
                        </td>
                      </tr>
                    ) : (
                      parsed.records.map((rec, idx) => {
                        const isCredit = (rec.TransactionType || '').toUpperCase() === 'CREDIT';
                        const amountCls = isCredit ? 'text-adm-green' : 'text-adm-red';
                        const amount = rec.TransactionAmount?.Amount ?? '—';
                        return (
                          <tr
                            key={rec.ChannelRefId || rec.InstructionIdentification || idx}
                            className="transition-colors hover:bg-adm-hover"
                          >
                            <td className="px-3 py-2.5 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                              {rec.ValueDate || '—'}
                            </td>
                            <td className="px-3 py-2.5 font-mono text-[11px] text-adm-t1">
                              {rec.ChannelRefId || '—'}
                            </td>
                            <td className="px-3 py-2.5 text-[11px] text-adm-t2">
                              {rec.Description || rec.Remarks || '—'}
                            </td>
                            <td className={`px-3 py-2.5 text-right font-mono text-[11px] font-semibold ${amountCls}`}>
                              {isCredit ? '+' : '−'}
                              {amount}
                              <span className="ml-1 text-[9px] font-normal text-adm-t3">
                                {rec.TransactionType || ''}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-[11px] text-adm-t1">
                              {rec.Balance ?? '—'}
                            </td>
                            <td className="px-3 py-2.5 font-mono text-[10px] text-adm-t2">
                              {rec.VirtualAccount || '—'}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </DetailCard>
          )}

          {isHextrust(parsed) && (
            <DetailCard title={`On-chain Transactions (${parsed.txs?.length ?? 0})`} columns={1}>
              <div className="overflow-x-auto rounded-lg border border-adm-border">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-adm-border bg-adm-bg">
                    <tr>
                      {['Block Time', 'Tx Hash', 'Amount', 'Type', 'Status', 'Vault', 'From', 'To'].map(
                        (h) => (
                          <th
                            key={h}
                            className={`px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3 ${h === 'Amount' ? 'text-right' : 'text-left'}`}
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-adm-border">
                    {(parsed.txs?.length ?? 0) === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-3 py-8 text-center font-mono text-[11px] text-adm-t3"
                        >
                          No on-chain transactions.
                        </td>
                      </tr>
                    ) : (
                      parsed.txs.map((tx, idx) => (
                        <tr
                          key={tx.id || tx.txHash || idx}
                          className="transition-colors hover:bg-adm-hover"
                        >
                          <td className="px-3 py-2.5 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                            {tx.blockTimestamp ? new Date(tx.blockTimestamp).toLocaleString() : '—'}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[10px] text-adm-t1">
                            {truncate(tx.txHash)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-[11px] font-semibold text-adm-t1">
                            {tx.amountDecimal ?? '—'}
                          </td>
                          <td className="px-3 py-2.5">
                            <TypePill value={tx.transactionType} />
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[10px] text-adm-t2">
                            {tx.primaryTransactionStatus || '—'}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[10px] text-adm-t2">
                            {tx.vaultId || '—'}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[10px] text-adm-t2">
                            {truncate(tx.from)}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[10px] text-adm-t2">
                            {truncate(tx.to)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </DetailCard>
          )}

          {/* 4. Technical (LAST) */}
          <DetailCard title="Technical" columns={1}>
            <InfoField label="Account Ref" value={stmt.accountRef} mono />
            <JsonBlock title="Raw Statement (rawJson)" value={stmt.rawJson} />
          </DetailCard>
        </div>

        {/* ── Sidebar (no Actions block — read-only) ── */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">
          <SidebarGroup title="Identity">
            <SidebarKV label="Statement No" value={stmt.statementNo} mono />
            <SidebarKV label="Source" value={<StatusPill value={stmt.source} />} />
            <SidebarKV label="Currency" value={stmt.currency} mono />
            <SidebarKV label="Closing Balance" value={stmt.closingBalance} mono />
          </SidebarGroup>

          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Business Date" value={stmt.businessDate} mono />
            <SidebarKV label="Fetched At" value={fmtTime(stmt.fetchedAt)} mono />
            <SidebarKV label="Created" value={fmtTime(stmt.createdAt)} mono />
          </SidebarGroup>
        </div>
      </div>
    </div>
  );
};

export default ReconciliationStatementDetailPage;

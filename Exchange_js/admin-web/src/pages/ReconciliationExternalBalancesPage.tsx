import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { StatusPill } from '../components/ui/StatusPill';

interface ExternalBalanceRow {
  id: string;
  source: string;
  accountRef: string;
  currency: string;
  book: string;
  cutoffDate: string;
  closingBalance: string;
  openingBalance: string | null;
  status: string | null;
  lineCount: number | null;
  walletRef: string | null;
  walletNo: string | null;
  walletRole: string | null;
  decimals: number;
}

interface StatementLine {
  id: string;
  datetime: string;
  direction: 'IN' | 'OUT';
  amount: string;
  externalRef: string | null;
  channelRef: string | null;
  balanceAfter: string | null;
  description: string | null;
  raw: string | null;
}

interface ExternalBalanceDetail extends ExternalBalanceRow {
  ownerNo: string | null;
  asOfAt: string | null;
  ingestedAt: string | null;
  lines: StatementLine[];
}

const SOURCE_LABELS: Record<string, { groupLabel: string; subLabel: string }> = {
  HEXTRUST: { groupLabel: 'CRYPTO', subLabel: 'HexTrust' },
  ZAND: { groupLabel: 'FIAT', subLabel: 'Zand' },
  CHAIN: { groupLabel: 'CRYPTO', subLabel: 'Chain (raw)' },
};
const BOOK_BADGE: Record<string, string> = {
  CLIENT: 'border-adm-blue/30 bg-adm-blue/10 text-adm-blue',
  FIRM: 'border-adm-green/30 bg-adm-green/10 text-adm-green',
};

const fmtAmount = (v: string | number | null, decimals?: number) => {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  const dec = decimals ?? 2;
  const scale = Math.pow(10, dec);
  return (n / scale).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
};
const todayIso = () => new Date().toISOString().slice(0, 10);

const ReconciliationExternalBalancesPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const date = searchParams.get('date') ?? todayIso();
  const selectedWallet = searchParams.get('wallet');

  const [rows, setRows] = useState<ExternalBalanceRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [detail, setDetail] = useState<ExternalBalanceDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchList = async (d: string) => {
    setLoadingList(true);
    try {
      const url = new URL(`${import.meta.env.VITE_API_URL}/admin/reconciliation/external-balances`);
      url.searchParams.set('cutoffDate', d);
      const res = await adminFetch(url.toString());
      if (res.ok) setRows((await res.json()) as ExternalBalanceRow[]);
      else alert(await getApiErrorMessage(res, 'Failed to load external balances'));
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      console.error(e);
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => { void fetchList(date); }, [date]);

  const fetchDetail = async (walletNo: string, d: string) => {
    setLoadingDetail(true);
    setExpanded(new Set());
    try {
      const url = new URL(`${import.meta.env.VITE_API_URL}/admin/reconciliation/external-balances/${encodeURIComponent(walletNo)}`);
      url.searchParams.set('date', d);
      const res = await adminFetch(url.toString());
      if (res.ok) setDetail((await res.json()) as ExternalBalanceDetail);
      else { setDetail(null); alert(await getApiErrorMessage(res, 'Failed to load wallet statement')); }
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      console.error(e);
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => {
    if (selectedWallet) void fetchDetail(selectedWallet, date);
    else setDetail(null);
  }, [selectedWallet, date]);

  const toggleExpand = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // Group rows by source's groupLabel (CRYPTO/FIAT/OTHER)
  const grouped = useMemo(() => {
    const groups: Record<string, { subLabel: string; rows: ExternalBalanceRow[] }> = {};
    for (const r of rows) {
      const meta = SOURCE_LABELS[r.source] ?? { groupLabel: `OTHER (${r.source})`, subLabel: r.source };
      if (!groups[meta.groupLabel]) groups[meta.groupLabel] = { subLabel: meta.subLabel, rows: [] };
      groups[meta.groupLabel].rows.push(r);
    }
    // Sort each group's rows: book asc (CLIENT first), then walletNo asc
    for (const g of Object.values(groups)) {
      g.rows.sort((a, b) => (a.book ?? '').localeCompare(b.book ?? '') || (a.walletNo ?? '').localeCompare(b.walletNo ?? ''));
    }
    return groups;
  }, [rows]);

  const groupOrder = ['CRYPTO', 'FIAT', ...Object.keys(grouped).filter(k => k !== 'CRYPTO' && k !== 'FIAT')];
  const totals = groupOrder.map(k => ({ key: k, count: grouped[k]?.rows.length ?? 0 }));

  const onSelectWallet = (walletNo: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (walletNo) next.set('wallet', walletNo); else next.delete('wallet');
    setSearchParams(next);
  };

  return (
    <div className="flex h-full flex-col">
      <PageTitleBar
        title="External Balances"
        subtitle={`${date} · ${rows.length} wallets · ${totals.filter(t => t.count > 0).map(t => `${t.key === 'CRYPTO' ? 'Crypto' : t.key === 'FIAT' ? 'Fiat' : t.key} ${t.count}`).join(' · ')}`}
      >
        <input
          type="date"
          value={date}
          onChange={(e) => {
            const next = new URLSearchParams(searchParams);
            next.set('date', e.target.value);
            next.delete('wallet');
            setSearchParams(next);
          }}
          className="rounded border border-adm-border bg-adm-bg px-2 py-1 font-mono text-[11px] text-adm-t1"
        />
        <button onClick={() => void fetchList(date)} className="rounded border border-adm-border px-3 py-1 text-[11px] hover:bg-adm-hover">
          <RefreshCw size={12} className={loadingList ? 'animate-spin' : ''} /> Refresh
        </button>
      </PageTitleBar>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* MASTER */}
        <aside className="w-[360px] min-w-[360px] overflow-y-auto border-r border-adm-border bg-adm-panel">
          {groupOrder.filter(k => grouped[k]).map((groupKey) => {
            const group = grouped[groupKey];
            return (
              <section key={groupKey} className="border-b border-adm-border">
                <header className="bg-adm-bg px-4 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-adm-t3">
                  {groupKey} <span className="ml-2 text-adm-t2 normal-case">({group.subLabel})</span>
                </header>
                {group.rows.map((r) => {
                  const isSelected = r.walletNo === selectedWallet;
                  return (
                    <button
                      key={r.id}
                      onClick={() => onSelectWallet(r.walletNo)}
                      disabled={!r.walletNo}
                      className={`w-full border-b border-adm-border px-4 py-2.5 text-left transition-colors ${
                        isSelected ? 'border-l-2 border-l-adm-amber bg-adm-card' : 'hover:bg-adm-hover'
                      } ${!r.walletNo ? 'cursor-not-allowed opacity-60' : ''}`}
                    >
                      <div className="font-mono text-[12px] text-adm-t1">{r.walletNo ?? (r.walletRef ? r.walletRef.slice(0, 8) + '…' : '—')}</div>
                      <div className="mt-1 flex items-center gap-2">
                        {r.book && (
                          <span className={`inline-flex rounded border px-1.5 py-0 font-mono text-[9px] uppercase ${BOOK_BADGE[r.book] ?? 'border-adm-border bg-adm-bg text-adm-t2'}`}>
                            {r.book}
                          </span>
                        )}
                        <span className="font-mono text-[11px] text-adm-t2">{r.currency}</span>
                        <span className={`ml-auto font-mono text-[11px] ${Number(r.closingBalance) < 0 ? 'text-adm-red' : 'text-adm-t1'}`}>
                          {fmtAmount(r.closingBalance, r.decimals)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </section>
            );
          })}
          {rows.length === 0 && !loadingList && (
            <div className="px-4 py-8 text-center text-[12px] text-adm-t3">No external balances for {date}</div>
          )}
        </aside>

        {/* DETAIL */}
        <main className="flex-1 overflow-y-auto divide-y divide-adm-border">
          {!selectedWallet ? (
            <div className="flex h-full items-center justify-center text-[13px] text-adm-t3">
              Select a wallet from the left to view its statement
            </div>
          ) : loadingDetail && !detail ? (
            <div className="flex h-full flex-col items-center justify-center">
              <RefreshCw className="mb-3 animate-spin text-adm-amber" size={28} />
              <p className="text-[12px] text-adm-t3">Loading statement…</p>
            </div>
          ) : !detail ? null : (
            <>
              {/* Notice strip */}
              <div className="border-b border-adm-border bg-adm-panel px-6 py-2 text-[11px] text-adm-t2">
                {detail.lineCount ?? detail.lines.length} lines · ingested {detail.ingestedAt ? new Date(detail.ingestedAt).toLocaleString() : '—'}
                {detail.status && <span className="ml-3"><StatusPill value={detail.status} /></span>}
              </div>

              {/* Hero */}
              <section className="bg-adm-card p-6">
                <div className="font-mono text-[19px] font-bold text-adm-amber">{detail.walletNo ?? '—'}</div>
                <div className="mt-4 grid grid-cols-[120px_1fr] gap-y-2 text-[13px]">
                  <div className="text-adm-t3">SOURCE</div><div className="text-adm-t1">{detail.source}</div>
                  <div className="text-adm-t3">BOOK</div>
                  <div>
                    {detail.book ? (
                      <span className={`inline-flex rounded border px-2 py-0.5 font-mono text-[10px] uppercase ${BOOK_BADGE[detail.book] ?? 'border-adm-border bg-adm-bg text-adm-t2'}`}>{detail.book}</span>
                    ) : '—'}
                  </div>
                  <div className="text-adm-t3">ROLE</div><div className="font-mono text-adm-t1">{detail.walletRole ?? '—'}</div>
                  <div className="text-adm-t3">CCY</div><div className="font-mono text-adm-t1">{detail.currency}</div>
                  <div className="text-adm-t3">OWNER</div><div className="font-mono text-adm-t1">{detail.ownerNo ?? '—'}</div>
                </div>
                <div className="mt-5 border-t border-adm-border pt-4">
                  <div className="text-[11px] uppercase tracking-wider text-adm-t3">CLOSING</div>
                  <div className={`mt-1 font-mono text-[24px] font-semibold ${Number(detail.closingBalance) < 0 ? 'text-adm-red' : 'text-adm-t1'}`}>{fmtAmount(detail.closingBalance, detail.decimals)}</div>
                </div>
              </section>

              {/* Roll-Forward Check */}
              {(() => {
                const opening = Number(detail.openingBalance ?? 0);
                const closing = Number(detail.closingBalance);
                const net = detail.lines.reduce((s, l) => s + (l.direction === 'IN' ? Number(l.amount) : -Number(l.amount)), 0);
                const drift = opening + net - closing;
                const continuous = Math.abs(drift) < 0.000001;
                const empty = detail.lines.length === 0;
                return (
                  <section className="p-6">
                    <div className="text-[11px] uppercase tracking-wider text-adm-t3">Roll-Forward Check</div>
                    <div className="mt-2 font-mono text-[13px] text-adm-t1">
                      {fmtAmount(opening, detail.decimals)} + {fmtAmount(net, detail.decimals)} net {continuous ? '=' : '≠'} {fmtAmount(closing, detail.decimals)}
                    </div>
                    <div className={`mt-2 text-[12px] ${empty ? 'text-adm-t3' : continuous ? 'text-adm-green' : 'text-adm-red'}`}>
                      {empty ? '⚠️ Empty statement — opening/closing only' :
                       continuous ? `✅ continuous · drift = 0` :
                       `❌ drift = ${fmtAmount(drift, detail.decimals)} · contact ${detail.source}`}
                    </div>
                  </section>
                );
              })()}

              {/* Statement Lines */}
              <section className="p-6">
                <div className="text-[11px] uppercase tracking-wider text-adm-t3 mb-3">Statement Lines ({detail.lines.length})</div>
                {detail.lines.length === 0 ? (
                  <div className="text-[12px] text-adm-t3">No lines recorded for this wallet on {detail.cutoffDate}</div>
                ) : (
                  <table className="w-full border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-adm-bg text-adm-t3">
                        <th className="px-2 py-1.5 text-left font-mono uppercase tracking-wider">Time</th>
                        <th className="px-2 py-1.5 text-left font-mono uppercase tracking-wider">Dir</th>
                        <th className="px-2 py-1.5 text-right font-mono uppercase tracking-wider">Amount</th>
                        <th className="px-2 py-1.5 text-left font-mono uppercase tracking-wider">External Ref</th>
                        <th className="px-2 py-1.5 text-left font-mono uppercase tracking-wider">Channel Ref</th>
                        <th className="px-2 py-1.5 text-left font-mono uppercase tracking-wider">Description</th>
                        <th className="px-2 py-1.5 text-right font-mono uppercase tracking-wider">Balance After</th>
                        <th className="w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.lines.map((l) => [
                        <tr key={l.id} className="border-b border-adm-border hover:bg-adm-hover cursor-pointer" onClick={() => toggleExpand(l.id)}>
                          <td className="px-2 py-2 font-mono text-adm-t2">{new Date(l.datetime).toLocaleTimeString()}</td>
                          <td className="px-2 py-2">
                            <span className={`inline-flex rounded px-1.5 py-0 font-mono text-[10px] font-semibold ${l.direction === 'IN' ? 'bg-adm-green/15 text-adm-green' : 'bg-adm-red/15 text-adm-red'}`}>{l.direction}</span>
                          </td>
                          <td className={`px-2 py-2 text-right font-mono ${l.direction === 'OUT' ? 'text-adm-red' : 'text-adm-t1'}`}>{fmtAmount(l.amount, detail.decimals)}</td>
                          <td className="px-2 py-2 font-mono text-adm-t2">{l.externalRef ?? '—'}</td>
                          <td className="px-2 py-2 font-mono text-adm-t3">{l.channelRef ?? '—'}</td>
                          <td className="px-2 py-2 text-adm-t2">{l.description ?? '—'}</td>
                          <td className="px-2 py-2 text-right font-mono text-adm-t2">{l.balanceAfter ? fmtAmount(l.balanceAfter, detail.decimals) : '—'}</td>
                          <td className="px-2 py-2 text-adm-t3">{expanded.has(l.id) ? '▾' : '▸'}</td>
                        </tr>,
                        expanded.has(l.id) && l.raw ? (
                          <tr key={`${l.id}-raw`} className="bg-adm-bg">
                            <td colSpan={8} className="px-4 py-2">
                              <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[10px] text-adm-t2">{(() => { try { return JSON.stringify(JSON.parse(l.raw), null, 2); } catch { return l.raw; } })()}</pre>
                            </td>
                          </tr>
                        ) : null,
                      ])}
                    </tbody>
                  </table>
                )}
              </section>

              {/* Cross-ref footer */}
              <section className="p-6">
                <a
                  href="/admin/ledger/account-statement?crossingOnly=true"
                  className="text-[12px] text-adm-amber hover:underline"
                >
                  View in Internal Book →
                </a>
                <p className="mt-1 text-[10px] text-adm-t3">
                  Opens the internal account statement filtered to cross-account transfers. Wallet pre-selection deferred — see design doc §11.
                </p>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
};

export default ReconciliationExternalBalancesPage;

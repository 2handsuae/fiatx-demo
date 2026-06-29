import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { PageTitleBar } from '../components/ui/PageTitleBar';

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

const fmtAmount = (v: string | number | null) => {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
};
const todayIso = () => new Date().toISOString().slice(0, 10);

const ReconciliationExternalBalancesPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const date = searchParams.get('date') ?? todayIso();
  const selectedWallet = searchParams.get('wallet');

  const [rows, setRows] = useState<ExternalBalanceRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);

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
                      <div className="font-mono text-[12px] text-adm-t1">{r.walletNo ?? r.walletRef?.slice(0, 8) + '…'}</div>
                      <div className="mt-1 flex items-center gap-2">
                        {r.book && (
                          <span className={`inline-flex rounded border px-1.5 py-0 font-mono text-[9px] uppercase ${BOOK_BADGE[r.book] ?? 'border-adm-border bg-adm-bg text-adm-t2'}`}>
                            {r.book}
                          </span>
                        )}
                        <span className="font-mono text-[11px] text-adm-t2">{r.currency}</span>
                        <span className={`ml-auto font-mono text-[11px] ${Number(r.closingBalance) < 0 ? 'text-adm-red' : 'text-adm-t1'}`}>
                          {fmtAmount(r.closingBalance)}
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

        {/* DETAIL — Task B2 fills this */}
        <main className="flex-1 overflow-y-auto">
          {!selectedWallet ? (
            <div className="flex h-full items-center justify-center text-[13px] text-adm-t3">
              Select a wallet from the left to view its statement
            </div>
          ) : (
            <div className="px-6 py-12 text-center text-[13px] text-adm-t3">Detail pane — wired in Task B2</div>
          )}
        </main>
      </div>
    </div>
  );
};

export default ReconciliationExternalBalancesPage;

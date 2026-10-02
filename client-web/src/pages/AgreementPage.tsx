// 战役丙波三 T7 · /agreement 客户协议阅读页（通知深链 / 横幅的落点）。
// 三块：①版本状态头（由 me.consent 推，见 utils/agreementView.ts）②正文（AgreementSections，
// 生效版 / 在途版两版对照切换，无在途版则不出切换钮）③打印（.print-agreement，样式见 index.css）。
// 同意动作与弹窗共用同一端点 POST /client/agreements/{versionKey}/consent，本页 source=PAGE。
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Printer, RefreshCw } from 'lucide-react';
import AgreementSections from '../components/AgreementSections';
import { CustomerSessionError, customerFetch, getCustomerApiErrorMessage } from '../utils/customerFetch';
import { agreementStatusLines, type AgreementMe, type AgreementVersion } from '../utils/agreementView';

const API = import.meta.env.VITE_API_URL;

type ViewKey = 'current' | 'pending';

const toDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');

const AgreementPage = () => {
  const [me, setMe] = useState<AgreementMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<ViewKey>('current');
  const [accepting, setAccepting] = useState(false);
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await customerFetch(`${API}/client/agreements/me`);
      if (!res.ok) {
        setError(await getCustomerApiErrorMessage(res, 'Failed to load the customer agreement'));
        return;
      }
      setMe((await res.json()) as AgreementMe);
    } catch (err) {
      if (err instanceof CustomerSessionError) return;
      setError(err instanceof Error ? err.message : 'Network connection error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const accept = async (versionKey: string) => {
    setAccepting(true);
    setActionError('');
    try {
      const res = await customerFetch(
        `${API}/client/agreements/${encodeURIComponent(versionKey)}/consent`,
        { method: 'POST', body: JSON.stringify({ action: 'ACCEPTED', source: 'PAGE' }) },
      );
      if (!res.ok) {
        setActionError(await getCustomerApiErrorMessage(res, 'Could not record your acceptance'));
        return;
      }
      await load();
    } catch (err) {
      if (err instanceof CustomerSessionError) return;
      setActionError(err instanceof Error ? err.message : 'Network connection error');
    } finally {
      setAccepting(false);
    }
  };

  // 在途版消失（如已生效翻为 current）时回到生效版，避免停在一个不存在的视图上。
  const shown: { key: ViewKey; version: AgreementVersion } | null = me
    ? view === 'pending' && me.pending
      ? { key: 'pending', version: me.pending }
      : { key: 'current', version: me.current }
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[26px] font-normal text-fx-sand">Customer Agreement</h1>
          <p className="mt-1.5 text-[12px] text-fx-dust">The terms of your account with FIATX</p>
        </div>
        {shown && (
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-fx-dust hover:text-fx-brass transition-colors border border-fx-rule px-3 py-1.5"
          >
            <Printer size={12} /> Print / Save as PDF
          </button>
        )}
      </div>

      {error && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertCircle size={22} className="text-fx-rust" />
          <p className="font-mono text-[12px] text-fx-rust">{error}</p>
          <button
            onClick={() => void load()}
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-fx-dust hover:text-fx-brass transition-colors border border-fx-rule px-3 py-1.5"
          >
            Retry
          </button>
        </div>
      )}

      {!error && loading && !me && (
        <div className="flex items-center justify-center py-24">
          <RefreshCw className="animate-spin text-fx-dust" size={20} />
        </div>
      )}

      {!error && me && shown && (
        <>
          {/* ① 版本状态头 */}
          <div className="border border-fx-rule bg-fx-ink divide-y divide-fx-rule">
            {agreementStatusLines(me).map((line) => (
              <div
                key={line.kind}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-5 py-3.5"
              >
                <p className="text-[13px] text-fx-dune">{line.text}</p>
                {line.kind === 'AWAITING_CONSENT' && (
                  <button
                    type="button"
                    onClick={() => void accept(line.acceptVersionKey)}
                    disabled={accepting}
                    className="fx-btn-primary shrink-0"
                  >
                    {accepting ? 'Recording…' : `Accept version ${line.acceptVersionKey}`}
                  </button>
                )}
              </div>
            ))}
          </div>
          {actionError && <p className="font-mono text-[12px] text-fx-rust">{actionError}</p>}

          {/* 两版切换（无在途版时不出） */}
          {me.pending && (
            <div className="flex items-center gap-2">
              {(
                [
                  ['current', me.current, 'In effect'],
                  ['pending', me.pending, 'Upcoming'],
                ] as const
              ).map(([key, v, tag]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setView(key)}
                  aria-pressed={shown.key === key}
                  className={`font-mono text-[10px] uppercase tracking-[0.12em] border px-3 py-1.5 transition-colors ${
                    shown.key === key
                      ? 'border-fx-brass text-fx-brass'
                      : 'border-fx-rule text-fx-dust hover:text-fx-brass'
                  }`}
                >
                  {v.versionKey} · {tag}
                </button>
              ))}
            </div>
          )}

          {/* ②③ 正文 + 打印区块（样式见 index.css .print-agreement） */}
          <section className="print-agreement border border-fx-rule bg-fx-ink px-6 md:px-10 py-8">
            <div className="mb-8 pb-6 border-b border-fx-rule">
              <h2 className="fx-display text-[22px] leading-tight text-fx-sand">
                Customer Agreement · {shown.version.versionKey}
              </h2>
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-fx-dust">
                {shown.key === 'current' ? 'In effect since' : 'Takes effect on'} {toDay(shown.version.effectiveAt)}
              </p>
              {shown.version.summary && (
                <p className="mt-3 text-[13px] text-fx-dune">{shown.version.summary}</p>
              )}
            </div>
            <div className="space-y-12 max-w-2xl">
              <AgreementSections sections={shown.version.sections} />
            </div>
          </section>
        </>
      )}
    </div>
  );
};

export default AgreementPage;

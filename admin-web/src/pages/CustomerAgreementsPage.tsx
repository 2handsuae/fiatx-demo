// admin-web/src/pages/CustomerAgreementsPage.tsx
// 战役丙波三 · 客户协议（Task 10）：Compliance Office 下的 Customer Agreements——版本卡列表 + 选中版
// 只读详情。三件事：①看每个版本走到哪一步（DRAFT → PENDING_APPROVAL → PUBLISHED → EFFECTIVE → SUPERSEDED）；
// ②合规官对 DRAFT 版「Submit for publication」填生效日（真校验——≥ 今天+30 天、仅 DRAFT、同时只一版在途——
// 全在后端，400 的 message 原样展示，本页不复刻业务规则）；③演示者对 PUBLISHED 版 ⚡「Fast-forward to
// effective」（DEMO_CLOCK_WRITE && Simulation 开关双门，照 ComplianceObligationListPage / ComplaintDetailPage 先例；
// 合规官持有读权限看得见页面却点不动 ⚡，RBAC 交叉是产物非缺陷，spec §3）。
// 正文只读：协议正文住后端代码登记处，管理台没有任何写正文的入口。铁律⑥：只认 versionKey / 审批单号，
// 接口本就不返回内部 id，本页零 UUID 外露。
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Zap } from 'lucide-react';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';
import { InfoField } from '../components/compliance/DetailPageComponents';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { useSimulationMode } from '../utils/simulationMode';

interface VersionListItem {
  versionKey: string;
  status: string;
  summary: string;
  effectiveAt: string | null;
  publishedAt: string | null;
  pendingApprovalNo: string | null;
}

interface AgreementSection {
  no: string;
  title: string;
  body: string[];
}

interface VersionDetail extends VersionListItem {
  sections: AgreementSection[];
}

const API = import.meta.env.VITE_API_URL;

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/** 本地日历日 YYYY-MM-DD，今天 + n 天（date input 的 value / min 都吃这个格式）。 */
const localYmdFromToday = (plusDays: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + plusDays);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

/** 提交发布弹窗：填生效日。前端 min 只是提示，不拦——真校验在后端，后端 400 的人话原样回显。 */
const SubmitPublishModal = ({
  versionKey, open, onClose, onSubmitted,
}: {
  versionKey: string | null;
  open: boolean;
  onClose: () => void;
  onSubmitted: (versionKey: string, approvalNo: string) => void;
}) => {
  const [effectiveDate, setEffectiveDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    // 预填今天+31：本地 00:00 起算恰好满足 ≥ 今天+30 天的通知期（见下方提交处的换算）。
    setEffectiveDate(localYmdFromToday(31));
    setError('');
  }, [open, versionKey]);

  if (!open || !versionKey) return null;

  const submit = async () => {
    setError('');
    if (!effectiveDate) { setError('Choose an effective date'); return; }
    setSubmitting(true);
    try {
      // 后端 effectiveAt 收 ISO 时刻串：date input 选的是日历日，按本地当天 00:00 起算。
      const effectiveAt = new Date(`${effectiveDate}T00:00:00`).toISOString();
      const res = await adminFetch(`${API}/admin/customer-agreements/${encodeURIComponent(versionKey)}/submit-publish`, {
        method: 'POST', body: JSON.stringify({ effectiveAt }),
      });
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to submit the agreement for publication')); return; }
      const data = await res.json();
      onSubmitted(versionKey, data?.approvalNo ?? '');
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to submit the agreement for publication');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[460px] max-h-[85vh] overflow-y-auto rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-sm font-semibold text-adm-t1">Submit for publication</h3>
        <p className="mb-3 font-mono text-[11px] text-adm-amber">{versionKey}</p>
        <p className="mb-3 text-xs text-adm-t2">
          Senior management approves the publication. Customers are notified on approval and must respond
          once the version takes effect.
        </p>

        <label className="mb-1 block text-xs">Effective date
          <input
            type="date"
            value={effectiveDate}
            min={localYmdFromToday(30)}
            onChange={(e) => setEffectiveDate(e.target.value)}
            className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs"
          />
        </label>
        <p className="mb-3 text-[11px] text-adm-t3">
          At least 30 days from today (VARA Market Conduct II.A.7 notice period). The server makes the final check.
        </p>

        {error && <p className="mb-2 text-xs text-adm-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={adminButtonClass('modalCancel')}>Cancel</button>
          <button type="button" disabled={submitting} onClick={() => void submit()} className={adminButtonClass('modalConfirm')}>
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
};

const CustomerAgreementsPage = () => {
  const { hasPermission } = useAdminSession();
  const { enabled: simEnabled } = useSimulationMode();
  // 写钮只看 AGREEMENT_WRITE（合规官独占）；⚡ 是 DEMO_CLOCK_WRITE（金库拨钟组）&& Simulation 开关双门。
  const canWrite = hasPermission(PERMISSIONS.AGREEMENT_WRITE);
  const canFastForward = simEnabled && hasPermission(PERMISSIONS.DEMO_CLOCK_WRITE);

  const [items, setItems] = useState<VersionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const [detail, setDetail] = useState<VersionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailTick, setDetailTick] = useState(0);

  const [submitTarget, setSubmitTarget] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState<{ text: string; approvalNo?: string } | null>(null);

  const fetchItems = async () => {
    setLoading(true);
    setListError('');
    try {
      const res = await adminFetch(`${API}/admin/customer-agreements`);
      if (!res.ok) { setListError(await getApiErrorMessage(res, 'Failed to load customer agreements')); return; }
      const data = await res.json();
      const rows: VersionListItem[] = Array.isArray(data) ? data : [];
      setItems(rows);
      // 保持当前选中；没有（或选中的版本不在了）就落到最新一版（列表按 versionKey 升序）。
      setSelectedKey((prev) => (prev && rows.some((r) => r.versionKey === prev)
        ? prev
        : rows.length > 0 ? rows[rows.length - 1].versionKey : null));
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setListError(e instanceof Error ? e.message : 'Failed to load customer agreements');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems();
  }, []);

  useEffect(() => {
    if (!selectedKey) { setDetail(null); setDetailError(''); return; }
    let cancelled = false;
    void (async () => {
      setDetailLoading(true);
      setDetailError('');
      try {
        const res = await adminFetch(`${API}/admin/customer-agreements/${encodeURIComponent(selectedKey)}`);
        if (!res.ok) {
          const message = await getApiErrorMessage(res, 'Failed to load the agreement version');
          if (!cancelled) { setDetail(null); setDetailError(message); }
          return;
        }
        const data = await res.json();
        if (!cancelled) setDetail(data);
      } catch (e) {
        if (e instanceof AdminSessionError) return;
        if (!cancelled) { setDetail(null); setDetailError(e instanceof Error ? e.message : 'Failed to load the agreement version'); }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedKey, detailTick]);

  const refreshAll = async () => {
    await fetchItems();
    setDetailTick((n) => n + 1);
  };

  const handleSubmitted = (versionKey: string, approvalNo: string) => {
    setSubmitTarget(null);
    setActionError('');
    setNotice({
      text: `${versionKey} submitted for publication — waiting for senior-management approval`,
      approvalNo: approvalNo || undefined,
    });
    void refreshAll();
  };

  const handleFastForward = async (versionKey: string) => {
    setSimulating(true);
    setActionError('');
    setNotice(null);
    try {
      const res = await adminFetch(`${API}/admin/customer-agreements/${encodeURIComponent(versionKey)}/simulate-effective`, {
        method: 'POST',
      });
      if (!res.ok) { setActionError(await getApiErrorMessage(res, 'Failed to fast-forward this agreement version')); return; }
      setNotice({ text: `${versionKey} fast-forwarded — it is now the effective agreement` });
      await refreshAll();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setActionError(e instanceof Error ? e.message : 'Failed to fast-forward this agreement version');
    } finally {
      setSimulating(false);
    }
  };

  // 切到别的版本时旧详情还在 state 里，只展示与选中版一致的那份。
  const shown = detail && detail.versionKey === selectedKey ? detail : null;

  return (
    <div className="flex h-full flex-col">
      <PageTitleBar
        title="Customer Agreements"
        subtitle="Versioned customer terms — publication needs senior-management approval and a 30-day notice period"
        meta={`${items.length} version(s)`}
      >
        <button
          type="button"
          onClick={() => void refreshAll()}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={13} className={loading || detailLoading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {(notice || actionError || listError) && (
        <div className="shrink-0 space-y-2 border-b border-adm-border px-5 py-2">
          {notice && (
            <div className="rounded border border-adm-green/30 bg-adm-green/10 px-4 py-2 font-mono text-[11px] text-adm-green">
              {notice.text}
              {notice.approvalNo && (
                <>
                  {' '}·{' '}
                  <Link to={`/admin/governance/approvals/${encodeURIComponent(notice.approvalNo)}`} className="underline hover:opacity-75">
                    {notice.approvalNo}
                  </Link>
                </>
              )}
            </div>
          )}
          {(actionError || listError) && (
            <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">
              {actionError || listError}
            </div>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ════ 版本卡列表 ════ */}
        <aside className="w-[300px] min-w-[300px] shrink-0 space-y-2 overflow-y-auto border-r border-adm-border bg-adm-panel p-3">
          {items.map((it) => {
            const active = it.versionKey === selectedKey;
            return (
              <button
                key={it.versionKey}
                type="button"
                onClick={() => setSelectedKey(it.versionKey)}
                className={`block w-full rounded border p-3 text-left transition-colors ${
                  active ? 'border-adm-amber bg-adm-hover' : 'border-adm-border bg-adm-card hover:bg-adm-hover'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[13px] font-bold text-adm-amber">{it.versionKey}</span>
                  <AdminBadge value={it.status} />
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-adm-t2">{it.summary}</p>
                <div className="mt-2 flex flex-col gap-0.5 font-mono text-[10px] text-adm-t3">
                  <span>Effective · {fmt(it.effectiveAt)}</span>
                  <span>Published · {fmt(it.publishedAt)}</span>
                </div>
              </button>
            );
          })}
          {!loading && items.length === 0 && !listError && (
            <p className="px-2 py-8 text-center text-xs text-adm-t3">No agreement versions registered</p>
          )}
        </aside>

        {/* ════ 选中版详情 ════ */}
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">
          {detailError && (
            <section className="px-6 py-5">
              <p className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">{detailError}</p>
            </section>
          )}

          {!shown && !detailError && (
            <section className="px-6 py-8 text-center text-xs text-adm-t3">
              {selectedKey ? 'Loading…' : 'Select an agreement version'}
            </section>
          )}

          {shown && (
            <>
              <section className="bg-adm-card px-6 py-5">
                <div className="flex items-start justify-between gap-4">
                  <p className="font-mono text-[19px] font-bold leading-snug text-adm-amber">{shown.versionKey}</p>
                  {canWrite && shown.status === 'DRAFT' && (
                    <button type="button" onClick={() => setSubmitTarget(shown.versionKey)} className={adminButtonClass('workflowPrimary')}>
                      Submit for publication
                    </button>
                  )}
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {/* InfoField 只吃文本，状态要徽章，所以这一格本地落一个同样式的「标签 + 徽章」。 */}
                  <div className="min-w-0">
                    <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Status</div>
                    <div className="mt-1"><AdminBadge value={shown.status} /></div>
                  </div>
                  <InfoField label="Effective" value={fmt(shown.effectiveAt)} mono />
                  <InfoField label="Published" value={fmt(shown.publishedAt)} mono />
                  <InfoField
                    label="Pending Approval"
                    value={shown.pendingApprovalNo}
                    link={shown.pendingApprovalNo ? `/admin/governance/approvals/${encodeURIComponent(shown.pendingApprovalNo)}` : undefined}
                    mono
                  />
                  <div className="md:col-span-2 xl:col-span-3">
                    <InfoField label="Summary" value={shown.summary} />
                  </div>
                </div>
              </section>

              {shown.status === 'PUBLISHED' && canFastForward && (
                <section className="px-6 py-5">
                  <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">Manual Simulation</p>
                  <p className="mt-1 text-[11px] text-adm-t3">
                    Skip the notice period: the effective date becomes now and this version takes effect immediately (demo only).
                  </p>
                  <div className="mt-3">
                    <button
                      type="button"
                      disabled={simulating}
                      onClick={() => void handleFastForward(shown.versionKey)}
                      className={adminButtonClass('simulationAction')}
                      title="Fast-forward this version to effective (demo only)"
                    >
                      <Zap size={12} />
                      {simulating ? 'Working…' : 'Fast-forward to effective'}
                    </button>
                  </div>
                </section>
              )}

              <section className="px-6 py-5">
                <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">Agreement Text</p>
                <p className="mt-1 text-[11px] text-adm-t3">
                  Read-only — the text is registered in code with each version; changing it means adding a new version.
                </p>
                <div className="mt-4 space-y-5">
                  {shown.sections.map((s) => (
                    <div key={s.no}>
                      <h3 className="text-[13px] font-semibold text-adm-t1">{s.no}. {s.title}</h3>
                      <div className="mt-1.5 space-y-2">
                        {s.body.map((para, i) => (
                          <p key={i} className="text-[12px] leading-relaxed text-adm-t2">{para}</p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>

      <SubmitPublishModal
        versionKey={submitTarget}
        open={!!submitTarget}
        onClose={() => setSubmitTarget(null)}
        onSubmitted={handleSubmitted}
      />
    </div>
  );
};

export default CustomerAgreementsPage;

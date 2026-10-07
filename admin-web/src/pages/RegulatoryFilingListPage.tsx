// admin-web/src/pages/RegulatoryFilingListPage.tsx
// 战役甲波二 · 报送台骨架（Task 9）：报送单列表 + 手工开单入口。
// 铁律⑥：列表投影零 UUID（后端 RegulatoryFilingService.list 已保证）。
// 模板：IncidentListPage.tsx 的表格 + 弹层结构。
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { StatusPill } from '../components/ui/StatusPill';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { INCIDENT_REPORT_BASES, INCIDENT_TYPE_LABEL, INCIDENT_TYPE_REGISTRY_MIRROR } from '../utils/incidentStatusMap';
import {
  AUTHORITY_LABEL,
  FILING_ORIGIN_LABEL,
  FILING_ORIGINS,
  FILING_STATUS_LABEL,
  FILING_STATUSES,
  FILING_TYPE_LABEL,
  FILING_TYPE_MIRROR,
  FILING_TYPES,
  filingTypeDisplay,
  REGULATORY_AUTHORITIES,
  REPORT_DEADLINE_TONE_CLASS,
  reportBasisClockText,
  reportDeadlineDisplay,
  type FilingOrigin,
} from '../utils/regulatoryFilingMap';

interface Item {
  filingNo: string;
  direction: string;
  type: string;
  status: string;
  authority: string;
  ccAuthorities: string[];
  basisCode: string | null;
  incidentNo: string | null;
  title: string;
  receivedAt: string | null;
  deadlineAt: string | null;
  externalRef: string | null;
  submittedAt: string | null;
  overdueMarkedAt: string | null;
  createdAt: string;
}

// 后台路由键（幕后 type，只进提交 payload 与弹窗内部编码，**不渲染成任何员工可见文案**——
// 员工可见的第二层是"材料"，见整备波 spec §2.1/§2.4）。
const INCIDENT_ROUTE_TYPE = 'INCIDENT_REPORT';
const PERIODIC_ROUTE_TYPE = 'PERIODIC_RETURN';

// 弹窗下拉 value 的内部编码 `TYPE::code`（仅前端内部，提交 payload 仍是 type/basisCode/title/authority
// 既有字段，后端零感知）：事故材料 = `<路由键>::<basisCode>`，义务行 = `<路由键>::<obligationNo>`，
// 类型即材料的选项 = 裸 type。
const SEL_SEP = '::';
const encodeSel = (type: string, code?: string) => (code ? `${type}${SEL_SEP}${code}` : type);
const decodeSel = (sel: string) => {
  const i = sel.indexOf(SEL_SEP);
  return i < 0 ? { type: sel, code: '' } : { type: sel.slice(0, i), code: sel.slice(i + SEL_SEP.length) };
};

interface ObligationOption { obligationNo: string; name: string; authority: string }
interface SelectOption { value: string; label: string; disabled?: boolean }

/** 手工开单弹窗——受控枚举纪律（Ruling-14）：authority/材料/entry kind 全下拉受控，
 * 零自由文本机构（spec §9）。整备波 spec §2.4：Type 下拉按来源（origin）分六组 optgroup，
 * 组内选项 = 员工可见的"材料层"——事故组列七个材料（选中 = 幕后事故通报类型 + 该材料码预选；
 * 已填事故号时按该事故类型的候选集过滤）、周期义务组动态列 ACTIVE 义务行（选中仅预填标题/
 * 受文机构，payload 不带义务号）、其余组列类型本身。字段显隐按类型注册表镜像决定：
 * 事故通报显 incidentNo；无默认受文机构的非事故类型（来函回复、周期补报）显 authority；
 * INBOUND（来函回复）另显 receivedAt；双头类（MARKET_OFFENCE_DUAL_REPORT）显 ccAuthorities 多选。 */
const OpenFilingModal = ({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (filingNo: string) => void }) => {
  const [selection, setSelection] = useState<string>(() => encodeSel(INCIDENT_ROUTE_TYPE, Object.keys(INCIDENT_REPORT_BASES)[0]));
  const [obligations, setObligations] = useState<ObligationOption[]>([]);
  const [title, setTitle] = useState('');
  const autoTitle = useRef('');   // 上一次由义务行预填的标题——换选项时若用户没改过则一并清掉
  const [incidentNo, setIncidentNo] = useState('');
  const [incidentLookup, setIncidentLookup] = useState<{ no: string; type: string } | null>(null);
  const [receivedAt, setReceivedAt] = useState('');
  const [authority, setAuthority] = useState<string>(REGULATORY_AUTHORITIES[0]);
  const [ccAuthorities, setCcAuthorities] = useState<string[]>([]);
  // 波三 T3/T9：requiresExternalCaseRef 类型（STR/SAR/CNMR/PNMR）手工开单必填——
  // Sumsub 案件引用或 EOCN 名单条目引用，服务层缺失即 400（openManual 校验）。
  const [externalCaseRef, setExternalCaseRef] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const { type, code } = decodeSel(selection);

  // 事故组材料：已填事故号且查到事故类型 → 只列该类型候选集内的材料；查不到 / 候选集为空 → 列全七个
  // （前端只是提示过滤，真门在后端 openManual：码不在该事故候选集即 400）。
  const allMaterials = Object.keys(INCIDENT_REPORT_BASES);
  const lookupCandidates = incidentLookup && incidentLookup.no === incidentNo.trim()
    ? INCIDENT_TYPE_REGISTRY_MIRROR[incidentLookup.type]?.reportBasisCandidates ?? []
    : [];
  const incidentMaterials = lookupCandidates.length > 0 ? allMaterials.filter((c) => lookupCandidates.includes(c)) : allMaterials;
  const materialsKey = incidentMaterials.join(',');

  useEffect(() => {
    if (!open) return;
    setSelection(encodeSel(INCIDENT_ROUTE_TYPE, allMaterials[0]));
    setObligations([]);
    setTitle('');
    autoTitle.current = '';
    setIncidentNo('');
    setIncidentLookup(null);
    setReceivedAt('');
    setAuthority(REGULATORY_AUTHORITIES[0]);
    setCcAuthorities([]);
    setExternalCaseRef('');
    setError('');
    // 周期义务组：每次打开弹窗读一次 ACTIVE 义务行（无读权 / 失败 → 该组显示"无义务"占位，不报错）。
    let cancelled = false;
    void (async () => {
      try {
        const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/compliance-obligations`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !Array.isArray(data)) return;
        setObligations(
          (data as Array<ObligationOption & { status: string }>)
            .filter((o) => o.status === 'ACTIVE')
            .map((o) => ({ obligationNo: o.obligationNo, name: o.name, authority: o.authority })),
        );
      } catch {
        // 会话失效已由 adminFetch 跳转登录；无读权（403）则义务组为空，其余五组照常可用。
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 事故号查出类型后材料列表收窄；当前选中的事故材料若被筛掉，落到收窄后的第一个。
  useEffect(() => {
    if (type === INCIDENT_ROUTE_TYPE && !incidentMaterials.includes(code)) {
      setSelection(encodeSel(INCIDENT_ROUTE_TYPE, incidentMaterials[0]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialsKey]);

  if (!open) return null;

  const cfg = FILING_TYPE_MIRROR[type];
  const basisCode = type === INCIDENT_ROUTE_TYPE ? code : '';
  const isDualHeaded = type === 'MARKET_OFFENCE_DUAL_REPORT';
  // 非事故类型且注册表没有默认受文机构（来函回复、周期补报）→ 开单人必须选机构。
  const needsAuthority = !cfg.requiresIncident && cfg.defaultAuthority === null;

  // 六组 optgroup：组内选项 = spec §2.1 "员工可见第二层"。
  const groups: Array<{ origin: FilingOrigin; options: SelectOption[] }> = FILING_ORIGINS.map((origin) => {
    if (origin === 'INCIDENT') {
      return { origin, options: incidentMaterials.map((c) => ({ value: encodeSel(INCIDENT_ROUTE_TYPE, c), label: INCIDENT_REPORT_BASES[c].label })) };
    }
    if (origin === 'PERIODIC_OBLIGATION') {
      return {
        origin,
        options: obligations.length > 0
          ? obligations.map((o) => ({ value: encodeSel(PERIODIC_ROUTE_TYPE, o.obligationNo), label: o.name }))
          : [{ value: '', label: 'No active obligations', disabled: true }],
      };
    }
    return { origin, options: FILING_TYPES.filter((t) => FILING_TYPE_MIRROR[t].origin === origin).map((t) => ({ value: t as string, label: FILING_TYPE_LABEL[t] })) };
  });

  const pick = (value: string) => {
    setSelection(value);
    const next = decodeSel(value);
    if (next.type === PERIODIC_ROUTE_TYPE) {
      const ob = obligations.find((o) => o.obligationNo === next.code);
      if (ob) {
        // 仅预填：标题 + 受文机构；补报无锚无钟语义不变，payload 不带义务号。
        const prefill = `${ob.name} — make-up filing`;
        autoTitle.current = prefill;
        setTitle(prefill);
        setAuthority(ob.authority);
      }
    } else if (autoTitle.current && title === autoTitle.current) {
      autoTitle.current = '';
      setTitle('');
    }
  };

  const lookupIncident = async () => {
    const no = incidentNo.trim();
    if (!no) { setIncidentLookup(null); return; }
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/incidents/${encodeURIComponent(no)}`);
      if (!res.ok) { setIncidentLookup(null); return; }
      const data = await res.json();
      setIncidentLookup(typeof data?.type === 'string' ? { no, type: data.type } : null);
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setIncidentLookup(null);   // 无读权 / 网络失败：不收窄，后端照旧是真门
    }
  };

  const toggleCc = (auth: string) => {
    setCcAuthorities((prev) => (prev.includes(auth) ? prev.filter((c) => c !== auth) : [...prev, auth]));
  };

  const close = () => { onClose(); };

  const submit = async () => {
    setError('');
    if (!title.trim()) { setError('Title is required'); return; }
    if (cfg.requiresIncident && !incidentNo.trim()) { setError('Incident No is required for this filing type'); return; }
    if (cfg.requiresExternalCaseRef && !externalCaseRef.trim()) { setError('External Case Reference is required for this filing type'); return; }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { type, title: title.trim() };
      if (cfg.requiresIncident) {
        body.incidentNo = incidentNo.trim();
        body.basisCode = basisCode;
      }
      if (needsAuthority) {
        body.authority = authority;
      }
      if (cfg.direction === 'INBOUND' && receivedAt) {
        body.receivedAt = new Date(receivedAt).toISOString();
      }
      if (isDualHeaded && ccAuthorities.length > 0) {
        body.ccAuthorities = ccAuthorities;
      }
      if (cfg.requiresExternalCaseRef) {
        body.externalCaseRef = externalCaseRef.trim();
      }
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/regulatory-filings`, {
        method: 'POST', body: JSON.stringify(body),
      });
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to open filing')); return; }
      const data = await res.json();
      onCreated(data.filingNo as string);
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to open filing');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={close}>
      <div className="w-[540px] max-h-[85vh] overflow-y-auto rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold text-adm-t1">Open Filing</h3>

        <label className="mb-3 block text-xs">Filing Type
          <select value={selection} onChange={(e) => pick(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs">
            {groups.map((g) => (
              <optgroup key={g.origin} label={FILING_ORIGIN_LABEL[g.origin]}>
                {g.options.map((o) => <option key={o.value || o.label} value={o.value} disabled={o.disabled}>{o.label}</option>)}
              </optgroup>
            ))}
          </select>
          {basisCode && INCIDENT_REPORT_BASES[basisCode] && (
            <span className="mt-1 block font-mono text-[10px] text-adm-amber">
              {INCIDENT_REPORT_BASES[basisCode].statuteRef} — {reportBasisClockText(basisCode)}
            </span>
          )}
        </label>

        <label className="mb-3 block text-xs">Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="e.g. Material Client VA discrepancy report" />
        </label>

        {cfg.requiresIncident && (
          <label className="mb-3 block text-xs">Incident No
            <input
              value={incidentNo}
              onChange={(e) => setIncidentNo(e.target.value)}
              onBlur={() => void lookupIncident()}
              className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono"
              placeholder="INC-…"
            />
            {incidentLookup && incidentLookup.no === incidentNo.trim() && (
              <span className="mt-1 block font-mono text-[10px] text-adm-t3">
                {INCIDENT_TYPE_LABEL[incidentLookup.type] ?? incidentLookup.type}
                {lookupCandidates.length > 0
                  ? ` — ${lookupCandidates.length} reportable material(s) for this incident type`
                  : ' — no reporting basis is defined for this incident type'}
              </span>
            )}
          </label>
        )}

        {(needsAuthority || cfg.direction === 'INBOUND') && (
          <div className="mb-3 grid grid-cols-2 gap-2">
            {needsAuthority && (
              <label className="block text-xs">Authority
                <select value={authority} onChange={(e) => setAuthority(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs">
                  {REGULATORY_AUTHORITIES.map((a) => <option key={a} value={a}>{AUTHORITY_LABEL[a]}</option>)}
                </select>
              </label>
            )}
            {cfg.direction === 'INBOUND' && (
              <label className="block text-xs">Received At (optional)
                <input type="datetime-local" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" />
              </label>
            )}
          </div>
        )}

        {cfg.requiresExternalCaseRef && (
          <label className="mb-3 block text-xs">External Case Reference
            <input value={externalCaseRef} onChange={(e) => setExternalCaseRef(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" placeholder="Sumsub case ref / EOCN list entry ref" />
          </label>
        )}

        {isDualHeaded && (
          <div className="mb-3">
            <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">CC Authorities (optional, multi-select)</p>
            <div className="flex flex-wrap gap-2">
              {REGULATORY_AUTHORITIES.map((a) => (
                <label key={a} className="flex items-center gap-1 text-[11px]">
                  <input type="checkbox" checked={ccAuthorities.includes(a)} onChange={() => toggleCc(a)} />
                  {AUTHORITY_LABEL[a]}
                </label>
              ))}
            </div>
          </div>
        )}

        {error && <p className="mb-2 text-xs text-adm-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className={adminButtonClass('modalCancel')}>Cancel</button>
          <button type="button" disabled={submitting} onClick={() => void submit()} className={adminButtonClass('modalConfirm')}>
            {submitting ? 'Opening…' : 'Open Filing'}
          </button>
        </div>
      </div>
    </div>
  );
};

const RegulatoryFilingListPage = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();
  const canWrite = hasPermission(PERMISSIONS.REG_FILING_WRITE);
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  // 整备波 spec §2.4：来源筛选。注册表 origin 不落库、列表接口也不带来源参数——按类型镜像的
  // origin 在前端对已加载的行过滤，切换来源无需重新请求。
  const [origin, setOrigin] = useState<'' | FilingOrigin>('');
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const fetchItems = async (nextStatus = status, nextType = type) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (nextStatus) params.set('status', nextStatus);
      if (nextType) params.set('type', nextType);
      const qs = params.toString();
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/regulatory-filings${qs ? `?${qs}` : ''}`);
      if (!res.ok) {
        alert(await getApiErrorMessage(res, 'Failed to load regulatory filings'));
        return;
      }
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleItems = origin ? items.filter((it) => FILING_TYPE_MIRROR[it.type]?.origin === origin) : items;

  return (
    <div className="flex h-full flex-col">
      <PageTitleBar
        title="Regulatory Filings"
        subtitle="The compliance desk's filing tracker — incident reports, regulator correspondence, and standing notifications, all on one clock"
        meta={`${visibleItems.length} filing(s)`}
      >
        {canWrite && (
          <button type="button" onClick={() => setShowNew(true)} className={adminButtonClass('listPrimary')}>
            <Plus size={13} /> Open Filing
          </button>
        )}
        <button type="button" onClick={() => void fetchItems()} className={adminIconButtonClass()} title="Refresh">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      <div className="flex gap-2 border-b border-adm-border px-5 py-2 text-xs">
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); void fetchItems(e.target.value, type); }}
          className="rounded border border-adm-border bg-adm-panel px-2 py-1"
        >
          <option value="">All statuses</option>
          {FILING_STATUSES.map((s) => <option key={s} value={s}>{FILING_STATUS_LABEL[s]}</option>)}
        </select>
        <select
          value={origin}
          onChange={(e) => setOrigin(e.target.value as '' | FilingOrigin)}
          className="rounded border border-adm-border bg-adm-panel px-2 py-1"
        >
          <option value="">All sources</option>
          {FILING_ORIGINS.map((o) => <option key={o} value={o}>{FILING_ORIGIN_LABEL[o]}</option>)}
        </select>
        <select
          value={type}
          onChange={(e) => { setType(e.target.value); void fetchItems(status, e.target.value); }}
          className="rounded border border-adm-border bg-adm-panel px-2 py-1"
        >
          <option value="">All types</option>
          {FILING_TYPES.map((t) => <option key={t} value={t}>{FILING_TYPE_LABEL[t]}</option>)}
        </select>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-adm-panel">
            <tr className="border-b border-adm-border text-left text-adm-t3">
              {['Filing No.', 'Type', 'Direction', 'Authority', 'Status', 'Deadline', 'Incident'].map((h) => (
                <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((it) => {
              const deadline = reportDeadlineDisplay(it.deadlineAt, it.submittedAt, it.overdueMarkedAt, it.basisCode);
              return (
                <tr
                  key={it.filingNo}
                  onClick={() => navigate(`/admin/governance/regulatory-filings/${encodeURIComponent(it.filingNo)}`)}
                  className={`cursor-pointer border-b border-adm-border/60 hover:bg-adm-hover/40 ${it.overdueMarkedAt ? 'bg-adm-red/10' : ''}`}
                >
                  <td className="px-4 py-2 font-mono text-adm-blue">{it.filingNo}</td>
                  <td className="px-4 py-2">{filingTypeDisplay(it.type, it.basisCode, it.title)}</td>
                  <td className="px-4 py-2">{it.direction === 'INBOUND' ? 'Inbound' : 'Outbound'}</td>
                  <td className="px-4 py-2">{AUTHORITY_LABEL[it.authority] ?? it.authority}</td>
                  <td className="px-4 py-2"><StatusPill value={it.status} /></td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${REPORT_DEADLINE_TONE_CLASS[deadline.tone]}`}>
                      {deadline.text}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono">
                    {it.incidentNo ? (
                      <Link
                        to={`/admin/governance/incidents/${encodeURIComponent(it.incidentNo)}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-adm-blue hover:underline"
                      >
                        {it.incidentNo}
                      </Link>
                    ) : '—'}
                  </td>
                </tr>
              );
            })}
            {!loading && visibleItems.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-adm-t3">
                  No regulatory filings yet — filings open automatically when an incident assessment requires reporting, or click "Open Filing" to open one manually
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <OpenFilingModal
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreated={(filingNo) => { setShowNew(false); navigate(`/admin/governance/regulatory-filings/${encodeURIComponent(filingNo)}`); }}
      />
    </div>
  );
};

export default RegulatoryFilingListPage;

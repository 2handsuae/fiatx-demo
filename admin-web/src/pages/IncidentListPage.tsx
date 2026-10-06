// admin-web/src/pages/IncidentListPage.tsx
// 平账三期 · 事故登记：列表 + 人工登记入口（四入口之一，另三个在案子详情页，Task 12）。
// 铁律⑥：列表投影零 UUID（后端 IncidentService.list 已保证）。
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { StatusPill } from '../components/ui/StatusPill';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import {
  INCIDENT_STATUS_LABEL,
  INCIDENT_REGISTRATION_FORM,
  INCIDENT_STATUSES,
  INCIDENT_SUBJECT_REF_FIELDS,
  INCIDENT_TYPE_LABEL,
  INCIDENT_TYPE_REGISTRY_MIRROR,
  INCIDENT_TYPES,
  MANUAL_DROPDOWN_TYPES,
  TOP_LEVEL_ANCHOR_KEYS,
} from '../utils/incidentStatusMap';

/** subjectRefs 单个字段值——checkbox 是 boolean，multiselect 是选中值数组（提交时 join(',')），其余是字符串。 */
type AnchorValue = string | boolean | string[];

interface Item {
  incidentNo: string;
  type: string;
  status: string;
  title: string;
  customerNo: string | null;
  assetCode: string | null;
  amount: string | null;
  sourceCaseNo: string | null;
  reportRequired: boolean;
  createdAt: string;
}

const PAGE_SIZE = 20;

/** 登记弹窗 Type-specific 段里来路字段 / 顶层锚的展示规格（显隐与必填由 INCIDENT_REGISTRATION_FORM 定）。 */
const SOURCE_FIELD_META: Record<string, { label: string; placeholder: string }> = {
  sourceCaseNo: { label: 'Source Case No', placeholder: 'CASE-…' },
  sourceDispositionNo: { label: 'Source Disposition Line No', placeholder: 'DISP-…' },
  sourceAdvanceTransferNo: { label: 'Source Advance Transfer No', placeholder: 'TRF-…' },
};
const TOP_LEVEL_META: Record<string, { label: string; placeholder: string }> = {
  customerNo: { label: 'Customer No', placeholder: 'Customer No' },
  assetCode: { label: 'Asset', placeholder: 'Asset code' },
  amount: { label: 'Amount', placeholder: 'Amount' },
};
const GRID_COLS: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3' };

/** Task 12：案子详情页三入口跳转过来的预填——业务键 only（铁律⑥）。钱包 / 账单行
 * 参考号在这份表单里没有专用字段，由调用方拼进 description（人读、可编辑），不当
 * 结构化字段传。 */
export interface NewIncidentPrefill {
  type?: string; title?: string; description?: string;
  sourceCaseNo?: string; sourceDispositionNo?: string; sourceAdvanceTransferNo?: string;
  customerNo?: string; assetCode?: string; amount?: string;
}

/** 人工登记表单（四入口的第四个：治理台空表单，类型手选，来源案号为空；
 * 另三个入口——案子定性升级 / 大额到线 / 退汇欠款——在案子详情页，通过 `prefill`
 * 带着业务键跳到这里，Task 12）。 */
const NewIncidentModal = ({ open, prefill, onClose, onCreated }: { open: boolean; prefill?: NewIncidentPrefill; onClose: () => void; onCreated: (incidentNo: string) => void }) => {
  const [type, setType] = useState<string>(MANUAL_DROPDOWN_TYPES[0]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sourceCaseNo, setSourceCaseNo] = useState('');
  const [sourceDispositionNo, setSourceDispositionNo] = useState('');
  const [sourceAdvanceTransferNo, setSourceAdvanceTransferNo] = useState('');
  const [customerNo, setCustomerNo] = useState('');
  const [assetCode, setAssetCode] = useState('');
  const [amount, setAmount] = useState('');
  // 战役甲波一 T10：新七类动态锚字段（非顶层键）——键=INCIDENT_SUBJECT_REF_FIELDS 的 field.key。
  const [anchorValues, setAnchorValues] = useState<Record<string, AnchorValue>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Task 12：每次打开都按 prefill 重新灌一遍字段——同一个弹层实例在案子页跳转
  // 之间复用，不重置就会把上一次的预填带进下一次打开。
  useEffect(() => {
    if (!open) return;
    setType(prefill?.type ?? MANUAL_DROPDOWN_TYPES[0]);
    setTitle(prefill?.title ?? '');
    setDescription(prefill?.description ?? '');
    setSourceCaseNo(prefill?.sourceCaseNo ?? '');
    setSourceDispositionNo(prefill?.sourceDispositionNo ?? '');
    setSourceAdvanceTransferNo(prefill?.sourceAdvanceTransferNo ?? '');
    setCustomerNo(prefill?.customerNo ?? '');
    setAssetCode(prefill?.assetCode ?? '');
    setAmount(prefill?.amount ?? '');
    setAnchorValues({});
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill]);

  if (!open) return null;

  const reset = () => {
    setType(MANUAL_DROPDOWN_TYPES[0]); setTitle(''); setDescription('');
    setSourceCaseNo(''); setSourceDispositionNo(''); setSourceAdvanceTransferNo('');
    setCustomerNo(''); setAssetCode(''); setAmount(''); setAnchorValues({}); setError('');
  };

  // 切类型：新类型不渲染的字段值一并清掉，免得看不见的旧值照常进 payload（动态锚本来就整体清）。
  // 新旧类型都渲染的输入位（如 Customer No / Amount）保留已填值。只有下拉可达这里——prefill 带
  // type 时类型控件已锁定、不会走到这；案件页预填里弹窗不渲染的值（如大额查不出带来的定性行号，
  // 后端靠它把定损回写到那行）因此原样留在 state、照常进 payload。
  const changeType = (next: string) => {
    const f = INCIDENT_REGISTRATION_FORM[next];
    setType(next); setAnchorValues({});
    if (!f.sourceFields.includes('sourceCaseNo')) setSourceCaseNo('');
    if (!f.sourceFields.includes('sourceDispositionNo')) setSourceDispositionNo('');
    if (!f.sourceFields.includes('sourceAdvanceTransferNo')) setSourceAdvanceTransferNo('');
    if (!('customerNo' in f.topLevel)) setCustomerNo('');
    if (!('assetCode' in f.topLevel)) setAssetCode('');
    if (!('amount' in f.topLevel)) setAmount('');
  };

  const anchorFields = INCIDENT_SUBJECT_REF_FIELDS[type] ?? [];

  const setAnchorText = (key: string, v: string) => setAnchorValues((prev) => ({ ...prev, [key]: v }));
  const setAnchorCheckbox = (key: string, v: boolean) => setAnchorValues((prev) => ({ ...prev, [key]: v }));
  const toggleAnchorMulti = (key: string, value: string) => setAnchorValues((prev) => {
    const cur = Array.isArray(prev[key]) ? (prev[key] as string[]) : [];
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    return { ...prev, [key]: next };
  });

  /** 该锚键是否已填——checkbox 恒真（false 是合法值，后端 assertAnchors 只拒 null/''）；
   * 其余按当前值判非空，镜像 IncidentService.assertAnchors 的判据。 */
  const isAnchorFilled = (key: string): boolean => {
    if (TOP_LEVEL_ANCHOR_KEYS.has(key)) {
      const v = key === 'assetCode' ? assetCode : key === 'customerNo' ? customerNo : amount;
      return !!v.trim();
    }
    const spec = anchorFields.find((f) => f.key === key);
    if (spec?.kind === 'checkbox') return true;
    const raw = anchorValues[key];
    if (Array.isArray(raw)) return raw.length > 0;
    return !!(typeof raw === 'string' && raw.trim());
  };

  const close = () => { reset(); onClose(); };

  // spec §2：来路字段与顶层锚（assetCode/customerNo/amount）的显隐/必填统一读 INCIDENT_REGISTRATION_FORM；
  // 动态锚（subjectRefs 键）的必填仍按注册表镜像的 requiredAnchors。
  const formSpec = INCIDENT_REGISTRATION_FORM[type];
  const topLevelEntries = Object.entries(formSpec.topLevel);
  const sourceValues: Record<string, string> = { sourceCaseNo, sourceDispositionNo, sourceAdvanceTransferNo };
  const sourceSetters: Record<string, (v: string) => void> = { sourceCaseNo: setSourceCaseNo, sourceDispositionNo: setSourceDispositionNo, sourceAdvanceTransferNo: setSourceAdvanceTransferNo };
  const topValues: Record<string, string> = { customerNo, assetCode, amount };
  const topSetters: Record<string, (v: string) => void> = { customerNo: setCustomerNo, assetCode: setAssetCode, amount: setAmount };
  const cfgAnchors = INCIDENT_TYPE_REGISTRY_MIRROR[type]?.requiredAnchors ?? [];

  const submit = async () => {
    setError('');
    if (!title.trim() || !description.trim()) { setError('Title and description are required'); return; }
    for (const key of formSpec.requiredSources) {
      if (!sourceValues[key].trim()) { setError(`${SOURCE_FIELD_META[key].label} is required`); return; }
    }
    for (const [key, req] of topLevelEntries) {
      if (req === 'required' && !topValues[key].trim()) { setError(`${TOP_LEVEL_META[key].label} is required`); return; }
    }
    // 新七类锚键校验（前端友好提示；真正裁决仍在后端 IncidentService.assertAnchors）。
    for (const key of cfgAnchors) {
      if (!isAnchorFilled(key)) { setError(`This incident type requires "${key}"`); return; }
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { type, title: title.trim(), description: description.trim() };
      if (sourceCaseNo.trim()) body.sourceCaseNo = sourceCaseNo.trim();
      if (sourceDispositionNo.trim()) body.sourceDispositionNo = sourceDispositionNo.trim();
      if (sourceAdvanceTransferNo.trim()) body.sourceAdvanceTransferNo = sourceAdvanceTransferNo.trim();
      if (customerNo.trim()) body.customerNo = customerNo.trim();
      if (assetCode.trim()) body.assetCode = assetCode.trim();
      if (amount.trim()) body.amount = amount.trim();
      // 新七类锚键值——顶层键（assetCode/customerNo/amount）已经在上面落顶层字段，这里只收
      // subjectRefs 键（TOP_LEVEL_ANCHOR_KEYS 之外的），镜像后端 TOP_LEVEL_ANCHOR_KEYS 分流。
      if (anchorFields.length > 0) {
        const subjectRefs: Record<string, string | number | boolean> = {};
        for (const f of anchorFields) {
          const raw = anchorValues[f.key];
          if (f.kind === 'checkbox') subjectRefs[f.key] = !!raw;
          else if (f.kind === 'multiselect') subjectRefs[f.key] = Array.isArray(raw) ? raw.join(',') : '';
          else subjectRefs[f.key] = typeof raw === 'string' ? raw.trim() : '';
        }
        body.subjectRefs = subjectRefs;
      }
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/incidents`, {
        method: 'POST', body: JSON.stringify(body),
      });
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Registration failed')); return; }
      const data = await res.json();
      reset();
      onCreated(data.incidentNo as string);
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={close}>
      <div className="w-[560px] max-h-[85vh] overflow-y-auto rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold text-adm-t1">Register Incident</h3>

        <div className="space-y-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Common details</p>

          {/* spec §3：prefill 带 type（案件页三入口）时类型锁定为只读——被通用下拉砍掉的两类
              （未授权转出 / 大额查不出）只经此路登记，也免得从案件页进来后手滑换类型。 */}
          {prefill?.type ? (
            <div className="text-xs">Type
              <div className="mt-1 w-full rounded border border-adm-border bg-adm-hover/40 px-2 py-1 text-xs text-adm-t2">
                {INCIDENT_TYPE_LABEL[prefill.type] ?? prefill.type} <span className="text-adm-t3">(entry-locked)</span>
              </div>
            </div>
          ) : (
            <label className="block text-xs">Type
              <select value={type} onChange={(e) => changeType(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs">
                {MANUAL_DROPDOWN_TYPES.map((t) => <option key={t} value={t}>{INCIDENT_TYPE_LABEL[t]}</option>)}
              </select>
            </label>
          )}

          <label className="block text-xs">Title*
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="e.g. Customer wallet ghost OUT" />
          </label>

          <label className="block text-xs">Description*
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="What happened" />
          </label>
        </div>

        {/* spec §2：Type-specific 段 = 来路字段 → 顶层三框（顺序即 INCIDENT_REGISTRATION_FORM 键序）→ 动态锚。
            顶层键 assetCode/customerNo/amount 仍落 payload 顶层，只是展示分组挪到这里。 */}
        <div className="mb-3 mt-3 space-y-2 border-t border-adm-border pt-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Type-specific details</p>
          {formSpec.sourceFields.map((key) => (
            <label key={key} className="block text-xs">{SOURCE_FIELD_META[key].label}{formSpec.requiredSources.includes(key) ? '*' : ' (optional)'}
              <input value={sourceValues[key]} onChange={(e) => sourceSetters[key](e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" placeholder={SOURCE_FIELD_META[key].placeholder} />
            </label>
          ))}
          {topLevelEntries.length > 0 && (
            <div className={`grid gap-2 ${GRID_COLS[topLevelEntries.length]}`}>
              {topLevelEntries.map(([key, req]) => (
                <label key={key} className="block text-xs">{TOP_LEVEL_META[key].label}{req === 'required' ? '*' : ' (optional)'}
                  <input value={topValues[key]} onChange={(e) => topSetters[key](e.target.value)} placeholder={TOP_LEVEL_META[key].placeholder} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" />
                </label>
              ))}
            </div>
          )}
          {anchorFields.map((f) => {
            if (f.kind === 'checkbox') {
              return (
                <label key={f.key} className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={!!anchorValues[f.key]}
                    onChange={(e) => setAnchorCheckbox(f.key, e.target.checked)}
                  />
                  {f.label}
                </label>
              );
            }
            if (f.kind === 'select') {
              return (
                <label key={f.key} className="block text-xs">{f.label}*
                  <select
                    value={typeof anchorValues[f.key] === 'string' ? (anchorValues[f.key] as string) : ''}
                    onChange={(e) => setAnchorText(f.key, e.target.value)}
                    className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs"
                  >
                    <option value="">Select…</option>
                    {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              );
            }
            if (f.kind === 'multiselect') {
              const selected = Array.isArray(anchorValues[f.key]) ? (anchorValues[f.key] as string[]) : [];
              return (
                <div key={f.key}>
                  <p className="mb-1 text-xs">{f.label}*</p>
                  <div className="flex flex-wrap gap-2">
                    {(f.options ?? []).map((o) => (
                      <label key={o.value} className="flex items-center gap-1 text-[11px]">
                        <input
                          type="checkbox"
                          checked={selected.includes(o.value)}
                          onChange={() => toggleAnchorMulti(f.key, o.value)}
                        />
                        {o.label}
                      </label>
                    ))}
                  </div>
                </div>
              );
            }
            return (
              <label key={f.key} className="block text-xs">{f.label}*
                <input
                  value={typeof anchorValues[f.key] === 'string' ? (anchorValues[f.key] as string) : ''}
                  onChange={(e) => setAnchorText(f.key, e.target.value)}
                  placeholder={f.label}
                  className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono"
                />
              </label>
            );
          })}
        </div>

        {error && <p className="mb-2 text-xs text-adm-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className={adminButtonClass('modalCancel')}>Cancel</button>
          <button type="button" disabled={submitting} onClick={() => void submit()} className={adminButtonClass('modalConfirm')}>
            {submitting ? 'Submitting…' : 'Register'}
          </button>
        </div>
      </div>
    </div>
  );
};

const IncidentListPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { hasPermission } = useAdminSession();
  const canWrite = hasPermission(PERMISSIONS.INCIDENT_WRITE);
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  // Task 12：案子详情页三入口带 query 跳过来的预填——存在 type 就当作是跳转
  // 过来的，直接开弹层，不用再让人自己点「登记事故」。
  const [newPrefill, setNewPrefill] = useState<NewIncidentPrefill | undefined>(undefined);

  useEffect(() => {
    const qType = searchParams.get('type');
    if (!qType) return;
    setNewPrefill({
      type: qType,
      title: searchParams.get('title') ?? undefined,
      description: searchParams.get('description') ?? undefined,
      sourceCaseNo: searchParams.get('sourceCaseNo') ?? undefined,
      sourceDispositionNo: searchParams.get('sourceDispositionNo') ?? undefined,
      sourceAdvanceTransferNo: searchParams.get('sourceAdvanceTransferNo') ?? undefined,
      customerNo: searchParams.get('customerNo') ?? undefined,
      assetCode: searchParams.get('assetCode') ?? undefined,
      amount: searchParams.get('amount') ?? undefined,
    });
    setShowNew(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchItems = async (nextPage = page, nextStatus = status, nextType = type) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        skip: String((nextPage - 1) * PAGE_SIZE),
        take: String(PAGE_SIZE),
      });
      if (nextStatus) params.set('status', nextStatus);
      if (nextType) params.set('type', nextType);
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/incidents?${params.toString()}`);
      if (!res.ok) {
        alert(await getApiErrorMessage(res, 'Failed to load incidents'));
        return;
      }
      const data = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
      setPage(nextPage);
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full flex-col">
      <PageTitleBar
        title="Incident Register"
        subtitle="How incidents get accounted for — investigation, assessment, remediation, and regulatory reporting on record; zero accounting impact"
        meta={`${total} incident(s)`}
      >
        {canWrite && (
          <button type="button" onClick={() => { setNewPrefill(undefined); setShowNew(true); }} className={adminButtonClass('listPrimary')}>
            <Plus size={13} /> Register Incident
          </button>
        )}
        <button type="button" onClick={() => void fetchItems(page)} className={adminIconButtonClass()} title="Refresh">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      <div className="flex gap-2 border-b border-adm-border px-5 py-2 text-xs">
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); void fetchItems(1, e.target.value, type); }}
          className="rounded border border-adm-border bg-adm-panel px-2 py-1"
        >
          <option value="">All statuses</option>
          {INCIDENT_STATUSES.map((s) => <option key={s} value={s}>{INCIDENT_STATUS_LABEL[s]}</option>)}
        </select>
        <select
          value={type}
          onChange={(e) => { setType(e.target.value); void fetchItems(1, status, e.target.value); }}
          className="rounded border border-adm-border bg-adm-panel px-2 py-1"
        >
          <option value="">All types</option>
          {INCIDENT_TYPES.map((t) => <option key={t} value={t}>{INCIDENT_TYPE_LABEL[t]}</option>)}
        </select>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-adm-panel">
            <tr className="border-b border-adm-border text-left text-adm-t3">
              {['No.', 'Type', 'Status', 'Amount', 'Source Case', 'Reporting'].map((h) => (
                <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr
                key={it.incidentNo}
                onClick={() => navigate(`/admin/governance/incidents/${encodeURIComponent(it.incidentNo)}`)}
                className="cursor-pointer border-b border-adm-border/60 hover:bg-adm-hover/40"
              >
                <td className="px-4 py-2 font-mono text-adm-blue">{it.incidentNo}</td>
                <td className="px-4 py-2">{INCIDENT_TYPE_LABEL[it.type] ?? it.type}</td>
                <td className="px-4 py-2"><StatusPill value={it.status} /></td>
                <td className="px-4 py-2 font-mono">{it.amount != null ? `${it.amount} ${it.assetCode ?? ''}` : '—'}</td>
                <td className="px-4 py-2 font-mono">{it.sourceCaseNo ?? '—'}</td>
                {/* 战役甲波二 T9（评审黄1 补裁）：Report Status/Deadline 两列随单槽退役——截止
                    时间与超时红标的可视面统一搬到报送台列表页，事故列表不再重复；这里只留
                    「该不该报」这一件事故域自己的判定留痕。 */}
                <td className="px-4 py-2">{it.reportRequired ? 'Required' : '—'}</td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-adm-t3">
                  No incidents yet — escalate from a reconciliation case's disposition, or click "Register Incident" to register one manually
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination currentPage={page} totalItems={total} pageSize={PAGE_SIZE} onPageChange={(p) => void fetchItems(p)} />

      <NewIncidentModal
        open={showNew}
        prefill={newPrefill}
        onClose={() => setShowNew(false)}
        onCreated={(incidentNo) => { setShowNew(false); navigate(`/admin/governance/incidents/${encodeURIComponent(incidentNo)}`); }}
      />
    </div>
  );
};

export default IncidentListPage;

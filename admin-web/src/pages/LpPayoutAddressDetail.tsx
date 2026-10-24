// admin-web/src/pages/LpPayoutAddressDetail.tsx
// LP 两步准入 Task 7：LP 打款地址详情——route-only（入口 = 档案详情的 Payout Addresses 区块 + 审批台回链），不进侧栏。
// 版式照 WithdrawalAddressDetail.tsx：左主区信息段（Identity / Details / 坐标 / Attribution / Red Flag / Screening）、
// 右侧栏 272px——**操作段（Actions → ⚡Screening Simulation）排在信息段（Identity Summary → Lifecycle）之前**
// （module-parity 规则 3）。归因 / 筛查徽章取共享 AddressBadges，侧栏取共享 SidebarPrimitives。
// LP 没有受益人概念，故无 Beneficiary 区块。铁律⑥：投影无 UUID，页面只认 addressNo / lpNo / approvalNo。
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { ViewAuditTrailButton } from '../components/common/ViewAuditTrailButton';
import { DetailPageHeader, InfoField } from '../components/compliance/DetailPageComponents';
import { VaspProfileFields, type VaspProfile } from '../components/compliance/VaspProfileFields';
import { AdminBadge } from '../components/ui/AdminBadge';
import { ADDRESS_TYPE_LABEL, AddressTypeBadge, ScreeningBadge } from '../components/ui/AddressBadges';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';

/* ── Interfaces ──────────────────────────────────────────────── */

interface LpPayoutAddress {
  addressNo: string;
  lpNo: string;
  assetCode: string | null;
  network: string | null;
  address: string | null;
  iban: string | null;
  bankName: string | null;
  swiftBic: string | null;
  declaredHosting: string | null;
  addressType: string | null;
  hostingMismatch: boolean;
  counterpartyVaspName: string | null;
  counterpartyVaspDid: string | null;
  /** VASP 名录档案（EEC / 评分 / 牌照），后端详情读时按 counterpartyVaspDid 现拼；无归因 / 名录查无为 null。 */
  vaspProfile?: VaspProfile | null;
  screeningAnswer: string | null;
  screenedAt: string | null;
  evidenceRef: string;
  label: string | null;
  approvalNo: string | null;
  status: string;
  suspendedAt: string | null;
  cancelledAt: string | null;
  deactivatedAt: string | null;
  createdAt: string;
}

type ScreeningAnswer = 'GREEN' | 'YELLOW' | 'RED';

/** 弹层动作：reason 型（撤回 / 停用 / 恢复 / 退役）与改标签共用一个输入弹层。 */
type PromptKind = 'cancel' | 'suspend' | 'reactivate' | 'deactivate' | 'label';

const PROMPT_META: Record<PromptKind, {
  title: string; description: string; field: string; placeholder: string; confirm: string; negative: boolean;
}> = {
  cancel: {
    title: 'Withdraw Payout Address',
    description: 'Withdraws the pending registration and its approval. The address can never be used; register a new one if needed.',
    field: 'Reason', placeholder: 'e.g. Wrong coordinate keyed in', confirm: 'Withdraw', negative: true,
  },
  suspend: {
    title: 'Suspend Payout Address',
    description: 'A suspended address cannot be chosen as the payout destination of new LP exchange orders.',
    field: 'Reason', placeholder: 'e.g. LP asked us to hold payouts while custody is migrated', confirm: 'Suspend', negative: true,
  },
  reactivate: {
    title: 'Reactivate Payout Address',
    description: 'Lifts the suspension — the address can be chosen for new LP exchange orders again.',
    field: 'Reason', placeholder: 'e.g. Custody migration finished', confirm: 'Reactivate', negative: false,
  },
  deactivate: {
    title: 'Retire Payout Address',
    description: 'Permanently retires the address. There is no way back — to use the coordinate again, register it anew.',
    field: 'Reason', placeholder: 'e.g. Replaced by a new address', confirm: 'Retire', negative: true,
  },
  label: {
    title: 'Rename Label',
    description: 'Only the label changes — the coordinate is frozen at registration (a new coordinate means a new registration).',
    field: 'Label', placeholder: 'e.g. Primary USDT payout', confirm: 'Save', negative: false,
  },
};

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const Cap = ({ children }: { children: ReactNode }) => (
  <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
    {children}
  </p>
);

/** 单字段输入弹层（理由 / 标签）。 */
const PromptModal = ({
  kind,
  initial,
  busy,
  onCancel,
  onConfirm,
}: {
  kind: PromptKind;
  initial: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (text: string) => void;
}) => {
  const meta = PROMPT_META[kind];
  const [text, setText] = useState(initial);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-xl border border-adm-border bg-adm-panel shadow-xl">
        <div className="border-b border-adm-border px-6 py-4">
          <h2 className="text-base font-semibold text-adm-t1">{meta.title}</h2>
          <p className="mt-1 text-xs text-adm-t3">{meta.description}</p>
        </div>
        <div className="px-6 py-4">
          <label className="mb-1.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3">
            {meta.field}
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={meta.placeholder}
            className="h-20 w-full resize-none rounded border border-adm-border bg-adm-bg px-2.5 py-2 text-xs text-adm-t1 outline-none placeholder:text-adm-t3 focus:border-adm-amber"
          />
        </div>
        <div className="flex justify-end gap-3 border-t border-adm-border px-6 py-4">
          <button onClick={onCancel} className={adminButtonClass('modalCancel')}>Cancel</button>
          <button
            onClick={() => onConfirm(text.trim())}
            disabled={!text.trim() || busy}
            className={adminButtonClass(meta.negative ? 'workflowNegative' : 'workflowPrimary')}
          >
            {meta.confirm}
          </button>
        </div>
      </div>
    </div>
  );
};

/** ⚡筛查喂弹层内容（RED 与 GREEN/YELLOW 的说明与按钮色不同，故不复用 PromptModal）。 */
const ScreeningFeedBody = ({
  pick,
  busy,
  onCancel,
  onConfirm,
}: {
  pick: ScreeningAnswer;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) => {
  const [reason, setReason] = useState('');
  return (
    <div className="w-full max-w-md rounded-xl border border-adm-border bg-adm-panel shadow-xl">
      <div className="border-b border-adm-border px-6 py-4">
        <h2 className="text-base font-semibold text-adm-t1">Feed {pick} Screening Verdict</h2>
        <p className="mt-1 text-xs text-adm-t3">
          {pick === 'RED'
            ? 'RED rejects this registration on the spot. If needed, the same coordinate can be registered again.'
            : 'The screening result is rewritten; the address stays pending CFO approval.'}
        </p>
      </div>
      <div className="px-6 py-4">
        <label className="mb-1.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3">
          Reason
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Address linked to a sanctioned cluster"
          className="h-20 w-full resize-none rounded border border-adm-border bg-adm-bg px-2.5 py-2 text-xs text-adm-t1 outline-none placeholder:text-adm-t3 focus:border-adm-amber"
        />
      </div>
      <div className="flex justify-end gap-3 border-t border-adm-border px-6 py-4">
        <button onClick={onCancel} className={adminButtonClass('modalCancel')}>Cancel</button>
        <button
          onClick={() => onConfirm(reason.trim())}
          disabled={!reason.trim() || busy}
          className={adminButtonClass(pick === 'RED' ? 'workflowNegative' : 'workflowPrimary')}
        >
          Feed {pick}
        </button>
      </div>
    </div>
  );
};

/* ── Main Component ──────────────────────────────────────────── */

export default function LpPayoutAddressDetail() {
  const { addressNo } = useParams<{ addressNo: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();

  const [data, setData] = useState<LpPayoutAddress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [prompt, setPrompt] = useState<PromptKind | null>(null);
  const [screeningPick, setScreeningPick] = useState<ScreeningAnswer | null>(null);

  const canCancel = hasPermission(PERMISSIONS.LP_PAYOUT_ADDRESS_CANCEL);
  const canSuspend = hasPermission(PERMISSIONS.LP_PAYOUT_ADDRESS_SUSPEND);
  const canReactivate = hasPermission(PERMISSIONS.LP_PAYOUT_ADDRESS_REACTIVATE);
  const canDeactivate = hasPermission(PERMISSIONS.LP_PAYOUT_ADDRESS_DEACTIVATE);
  const canRelabel = hasPermission(PERMISSIONS.LP_PAYOUT_ADDRESS_LABEL_WRITE);
  // ⚡筛查喂挂 DEMO_VERDICT_WRITE（合规官持有，金库不持有）——有意不跟上面的金库动作权限混用
  const canSimulateScreening = hasPermission(PERMISSIONS.LP_PAYOUT_ADDRESS_SIMULATE_SCREENING);

  const base = `${import.meta.env.VITE_API_URL}/admin/lp-payout-addresses/${encodeURIComponent(addressNo ?? '')}`;

  const fetchData = async () => {
    if (!addressNo) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(base);
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to fetch payout address details.'));
      setData(await res.json());
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchData(); }, [addressNo]);

  /* ── Actions ── */

  /** 统一的写动作：POST/PATCH → 失败显示后端原话，成功给提示并重取。 */
  const runAction = async (
    path: string,
    method: 'POST' | 'PATCH',
    body: Record<string, string>,
    okNotice: string,
    failFallback: string,
  ): Promise<boolean> => {
    setActionLoading(true);
    setError(null);
    try {
      const res = await adminFetch(`${base}/${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(await getApiErrorMessage(res, failFallback));
        return false;
      }
      setNotice(okNotice);
      void fetchData();
      return true;
    } catch (err) {
      if (!(err instanceof AdminSessionError)) setError(failFallback);
      return false;
    } finally {
      setActionLoading(false);
    }
  };

  const handlePrompt = async (kind: PromptKind, text: string) => {
    const done = kind === 'label'
      ? await runAction('label', 'PATCH', { label: text }, 'Label updated.', 'Failed to update the label')
      : await runAction(
        kind,
        'POST',
        { reason: text },
        {
          cancel: 'Registration withdrawn — the pending approval was cancelled.',
          suspend: 'Payout address suspended.',
          reactivate: 'Payout address reactivated.',
          deactivate: 'Payout address retired.',
        }[kind],
        `Failed to ${kind} the payout address`,
      );
    if (done) setPrompt(null);
  };

  const handleSimulateScreening = async (reason: string) => {
    if (!screeningPick) return;
    const pick = screeningPick;
    const done = await runAction(
      'simulate-screening',
      'POST',
      { answer: pick, reason },
      pick === 'RED' ? 'Screening RED fed — address rejected.' : `Screening ${pick} recorded.`,
      'Failed to feed screening verdict',
    );
    if (done) setScreeningPick(null);
  };

  /* ── Loading / Error states ── */

  if (loading && !data) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-4">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-adm-amber border-t-transparent" />
        <p className="mt-1 font-mono text-[11px] text-adm-t3">Loading payout address…</p>
        <button onClick={() => navigate('/admin/lp-profiles')} className={adminButtonClass('detailUtility')}>
          ← Back to LP Register
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4 rounded border border-adm-red/30 bg-adm-red/10 p-8 text-center">
        <div className="font-mono text-[11px] text-adm-red">{error || 'Payout address not found'}</div>
        <button onClick={() => navigate(-1)} className={adminButtonClass('detailUtility')}>
          Back
        </button>
      </div>
    );
  }

  /* ── Derived state ── */

  const isBank = data.addressType === 'BANK';
  const isVasp = data.addressType === 'VASP';
  const isPending = data.status === 'PENDING_APPROVAL';
  const isActive = data.status === 'ACTIVE';
  const isSuspended = data.status === 'SUSPENDED';
  const showActions = isPending || isActive || isSuspended;
  const hasAnyAction =
    (isPending && canCancel) || (isActive && (canSuspend || canDeactivate)) || (isSuspended && canReactivate) || (showActions && canRelabel);
  // ⚡只在待批态有意义（后端同款守卫：已批 / 已拒 / 已撤的地址 409）
  const awaitingScreening = isPending;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <DetailPageHeader
        backLabel={data.lpNo}
        onBack={() => navigate(`/admin/lp-profiles/${encodeURIComponent(data.lpNo)}`)}
        onRefresh={() => void fetchData()}
        refreshing={loading}
      >
        <ViewAuditTrailButton params={{ subjectNo: data.addressNo }} />
      </DetailPageHeader>

      {/* ── Notices ── */}
      {(notice || error) && (
        <div className="shrink-0 space-y-2 px-6 pb-1 pt-3">
          {notice && (
            <div className="rounded border border-adm-green/30 bg-adm-green/10 px-4 py-2 font-mono text-[11px] text-adm-green">
              {notice}
            </div>
          )}
          {error && (
            <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">
              {error}
            </div>
          )}
        </div>
      )}

      {/* ── Body: two-column layout ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ════ LEFT MAIN ════ */}
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">

          {/* ① Identity */}
          <section className="bg-adm-card px-6 py-5">
            <p className="font-mono text-[19px] font-bold leading-snug text-adm-amber">
              {data.addressNo}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Status</div>
                <div className="mt-1"><AdminBadge value={data.status} /></div>
              </div>
              {data.addressType && (
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Type</div>
                  <div className="mt-1"><AddressTypeBadge type={data.addressType} /></div>
                </div>
              )}
            </div>
            {data.label && (
              <div className="mt-3">
                <InfoField label="Label" value={data.label} />
              </div>
            )}
          </section>

          {/* ② Details */}
          <section className="px-6 py-5">
            <Cap>Details</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Liquidity Provider" value={data.lpNo} mono link={`/admin/lp-profiles/${encodeURIComponent(data.lpNo)}`} />
              <InfoField label="Asset" value={data.assetCode} mono />
              {!isBank && <InfoField label="Network" value={data.network} />}
              <InfoField label="Registered" value={fmt(data.createdAt)} mono />
              <InfoField label="Evidence Ref" value={data.evidenceRef} mono />
              <InfoField
                label="Approval"
                value={data.approvalNo}
                mono
                link={data.approvalNo ? `/admin/governance/approvals/${encodeURIComponent(data.approvalNo)}` : undefined}
              />
            </div>
          </section>

          {/* ③ Address / Bank Info */}
          <section className="px-6 py-5">
            <Cap>{isBank ? 'Bank Account' : 'Crypto Address'}</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              {isBank ? (
                <>
                  <InfoField label="IBAN" value={data.iban} mono />
                  <InfoField label="SWIFT / BIC" value={data.swiftBic} mono />
                  <InfoField label="Bank Name" value={data.bankName} />
                </>
              ) : (
                <div className="col-span-2">
                  <InfoField label="Address" value={data.address} mono />
                </div>
              )}
            </div>
          </section>

          {/* ④ Attribution — 系统归因（地址筛查 / Travel Rule 的结论，不是金库自述） */}
          {!isBank && data.addressType && (
            <section className="px-6 py-5">
              <Cap>Attribution</Cap>
              <p className="mt-1 font-mono text-[10px] text-adm-t3">
                What the system attributed this address to — independent of what treasury declared.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
                <div className="min-w-0">
                  <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Address Type (system attribution)</div>
                  <div className="mt-1"><AddressTypeBadge type={data.addressType} /></div>
                </div>
                {isVasp && (
                  <>
                    <InfoField label="Counterparty VASP" value={data.counterpartyVaspName} />
                    <InfoField label="VASP DID" value={data.counterpartyVaspDid} mono />
                    {data.vaspProfile && <VaspProfileFields profile={data.vaspProfile} />}
                  </>
                )}
              </div>
            </section>
          )}

          {/* ⑤ Self-declaration & red flag — 金库替 LP 申报的托管类型 vs 系统归因 */}
          {!isBank && (
            <section className="px-6 py-5">
              <Cap>Self-declaration &amp; Red Flag</Cap>
              {data.hostingMismatch && (
                <div className="mt-3 flex items-start gap-2.5 rounded border border-adm-red/40 bg-adm-red/10 px-4 py-3 text-adm-red">
                  <AlertTriangle size={16} className="mt-px shrink-0" />
                  <div>
                    <div className="font-mono text-[12px] font-bold">Declared hosting does not match attribution</div>
                    <div className="mt-0.5 font-mono text-[10px]">
                      Treasury declared {ADDRESS_TYPE_LABEL[data.declaredHosting ?? ''] ?? data.declaredHosting ?? '—'}; system attributed {ADDRESS_TYPE_LABEL[data.addressType ?? ''] ?? data.addressType ?? '—'}.
                      Flag only — registration was not blocked.
                    </div>
                  </div>
                </div>
              )}
              <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
                <InfoField
                  label="Declared Hosting (declared by treasury)"
                  value={data.declaredHosting ? (ADDRESS_TYPE_LABEL[data.declaredHosting] ?? data.declaredHosting) : null}
                />
                <InfoField label="Hosting Match" value={data.hostingMismatch ? 'Mismatch' : 'Consistent'} />
              </div>
            </section>
          )}

          {/* ⑥ Screening */}
          {data.screeningAnswer && (
            <section className="px-6 py-5">
              <Cap>Screening</Cap>
              {data.status === 'REJECTED' && data.screeningAnswer === 'RED' && (
                <div className="mt-3 flex items-start gap-2.5 rounded border border-adm-red/40 bg-adm-red/10 px-4 py-3 text-adm-red">
                  <AlertTriangle size={16} className="mt-px shrink-0" />
                  <div className="font-mono text-[11px]">
                    Screening returned RED — the address was rejected and can never be used. To use another coordinate, register a new address.
                  </div>
                </div>
              )}
              <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
                <div className="min-w-0">
                  <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Verdict</div>
                  <div className="mt-1"><ScreeningBadge answer={data.screeningAnswer} /></div>
                </div>
                <InfoField label="Screened At" value={data.screenedAt ? fmt(data.screenedAt) : null} mono />
              </div>
            </section>
          )}

        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">

          {/* 操作段 ① Actions */}
          {showActions && hasAnyAction && (
            <div className="border-b border-adm-border py-4">
              <Cap>Actions</Cap>
              <div className="mt-2.5 flex flex-col gap-2">
                {isPending && canCancel && (
                  <button onClick={() => setPrompt('cancel')} disabled={actionLoading} className={adminButtonClass('workflowNegative')}>
                    Withdraw Registration
                  </button>
                )}
                {isActive && canSuspend && (
                  <button onClick={() => setPrompt('suspend')} disabled={actionLoading} className={adminButtonClass('workflowNegative')}>
                    Suspend
                  </button>
                )}
                {isSuspended && canReactivate && (
                  <button onClick={() => setPrompt('reactivate')} disabled={actionLoading} className={adminButtonClass('workflowPrimary')}>
                    Reactivate
                  </button>
                )}
                {isActive && canDeactivate && (
                  <button onClick={() => setPrompt('deactivate')} disabled={actionLoading} className={adminButtonClass('workflowNegative')}>
                    Retire
                  </button>
                )}
                {canRelabel && (
                  <button onClick={() => setPrompt('label')} disabled={actionLoading} className={adminButtonClass('workflowSecondary')}>
                    Rename Label
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 操作段 ② Screening Simulation — demo backdoor：站在 Sumsub 一侧喂地址筛查结论 */}
          {canSimulateScreening && awaitingScreening && (
            <div className="border-b border-adm-border py-4">
              <Cap>Screening Simulation ⚡</Cap>
              <p className="mt-1 font-mono text-[10px] text-adm-t3">
                Demo backdoor — feeds the address-screening verdict, as if returned by Sumsub. RED rejects this registration on the spot (the same coordinate can be registered again if needed). Reason is audited.
              </p>
              <div className="mt-2 flex flex-col gap-2">
                <button onClick={() => setScreeningPick('GREEN')} disabled={actionLoading} className={adminButtonClass('simulationAction')}>
                  ⚡ Feed GREEN
                </button>
                <button onClick={() => setScreeningPick('YELLOW')} disabled={actionLoading} className={adminButtonClass('simulationAction')}>
                  ⚡ Feed YELLOW
                </button>
                <button onClick={() => setScreeningPick('RED')} disabled={actionLoading} className={adminButtonClass('workflowNegative')}>
                  ⚡ Feed RED
                </button>
              </div>
            </div>
          )}

          {/* 信息段 ① Identity Summary */}
          <SidebarGroup title="Identity Summary">
            <SidebarKV label="Address No" value={data.addressNo} mono />
            <SidebarKV label="Status" value={<AdminBadge value={data.status} />} />
            <SidebarKV label="Type" value={data.addressType ? (ADDRESS_TYPE_LABEL[data.addressType] ?? data.addressType) : null} mono />
            <SidebarKV label="LP No" value={data.lpNo} mono />
            <SidebarKV label="Asset" value={data.assetCode} mono />
          </SidebarGroup>

          {/* 信息段 ② Lifecycle */}
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Registered" value={fmt(data.createdAt)} mono />
            <SidebarKV label="Suspended" value={data.suspendedAt ? fmt(data.suspendedAt) : null} mono />
            <SidebarKV label="Withdrawn" value={data.cancelledAt ? fmt(data.cancelledAt) : null} mono />
            <SidebarKV label="Retired" value={data.deactivatedAt ? fmt(data.deactivatedAt) : null} mono />
          </SidebarGroup>

        </div>
      </div>

      {/* ── Reason / label prompt ── */}
      {prompt && (
        <PromptModal
          key={prompt}
          kind={prompt}
          initial={prompt === 'label' ? (data.label ?? '') : ''}
          busy={actionLoading}
          onCancel={() => setPrompt(null)}
          onConfirm={(text) => void handlePrompt(prompt, text)}
        />
      )}

      {/* ── Screening Simulation Modal ── */}
      {screeningPick && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <ScreeningFeedBody
            pick={screeningPick}
            busy={actionLoading}
            onCancel={() => setScreeningPick(null)}
            onConfirm={(reason) => void handleSimulateScreening(reason)}
          />
        </div>
      )}
    </div>
  );
}

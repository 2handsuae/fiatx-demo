import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { CustomerSessionError, customerFetch, getCustomerApiErrorMessage } from '../utils/customerFetch';
import { AGREEMENT_CONSENT_CHANGED_EVENT, agreementGateState } from '../utils/agreementGate';
import { STATUS_COPY, type AgreementMe } from '../utils/agreementView';

/* ────────────────────────────────────────────────────────────────
 *  AgreementGate — 客户协议弹窗 / 横幅（战役丙波三 T8），挂在登录壳层。
 *
 *  显不显示、显示哪一态，全部由 GET /client/agreements/me 的 pending + consent
 *  经 agreementGateState() 一次判定（见 utils/agreementGate.ts）；本组件只把这四态
 *  换成文案与按钮，不自己推导任何条件。
 *
 *    EFFECTIVE_BLOCKING   强制弹窗：无关闭钮、遮罩不可点、无 Esc 处理；两钮 Accept / Not now
 *    PENDING_DISMISSIBLE  可关弹窗：Accept / View full terms / Remind me later
 *    DECLINED_BANNER      横幅常驻，带 Review & accept 链
 *    NONE                 什么都不渲染
 *
 *  「Remind me later」只是本次挂载内的 React state（按在途版本键记），不落库、不进 storage——
 *  刷新页面/重新登录会再弹；「Not now」才落一条 DECLINED（source=MODAL）。
 *  同意/拒绝后不整页刷新：本组件自己 await 重取 me；/agreement 页同意后发
 *  AGREEMENT_CONSENT_CHANGED_EVENT，本组件监听并重取（横幅/弹窗当场消失）。
 *
 *  文案口径：只陈述事实 + 中性动作词（Review & accept），不许诺「同意即可交易」——
 *  已被限制的客户同意后仍可能被中性拒绝（T5 移交裁决）。
 * ──────────────────────────────────────────────────────────────── */

const API = import.meta.env.VITE_API_URL;

// 固定文案登记处（禁散写到 JSX）。
const GATE_COPY = {
  forcedTitle: 'Customer Agreement',
  forcedBody: (versionKey: string) =>
    `Version ${versionKey} of the FIATX Customer Agreement is in effect. Please review the terms and record your decision.`,
  forcedHint:
    'Choose Not now to read the full terms first; a reminder will stay at the top of your account.',
  pendingTitle: 'Updated Customer Agreement',
  pendingBody: (versionKey: string, effectiveOn: string) =>
    `Version ${versionKey} of the FIATX Customer Agreement takes effect on ${effectiveOn}. You can accept it now or review the full terms first.`,
  accept: 'Accept',
  recording: 'Recording…',
  notNow: 'Not now',
  viewTerms: 'View full terms',
  remindLater: 'Remind me later',
  bannerLabel: 'Customer Agreement',
  bannerBody: (versionKey: string) => `Version ${versionKey} of the customer agreement is awaiting your acceptance.`,
  bannerLink: 'Review & accept',
  actionFailed: 'Could not record your choice',
} as const;

type BusyAction = 'ACCEPTED' | 'DECLINED';

/** Deposit / Swap 拦截错误条里的「去看协议」链（文案同样集中在上方登记处）。 */
export const AgreementReviewLink = () => (
  <Link to="/agreement" className="underline text-fx-brass">
    {GATE_COPY.bannerLink}
  </Link>
);

const AgreementGate = () => {
  const navigate = useNavigate();
  const [me, setMe] = useState<AgreementMe | null>(null);
  // 「Remind me later」：记被收起的在途版本键，换了新版本键才会再弹。仅内存。
  const [dismissedPendingKey, setDismissedPendingKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await customerFetch(`${API}/client/agreements/me`);
      if (!res.ok) return;
      setMe((await res.json()) as AgreementMe);
    } catch (err) {
      if (err instanceof CustomerSessionError) return;
      // 静默——弹窗/横幅不是关键路径，拉取失败时不打断壳层（后端能力闸仍是真拦截）
    }
  }, []);

  useEffect(() => {
    void load();
    window.addEventListener(AGREEMENT_CONSENT_CHANGED_EVENT, load);
    return () => window.removeEventListener(AGREEMENT_CONSENT_CHANGED_EVENT, load);
  }, [load]);

  if (!me) return null;
  const state = agreementGateState(me);

  const record = async (versionKey: string, action: BusyAction) => {
    setBusy(action);
    setActionError('');
    try {
      const res = await customerFetch(`${API}/client/agreements/${encodeURIComponent(versionKey)}/consent`, {
        method: 'POST',
        body: JSON.stringify({ action, source: 'MODAL' }),
      });
      if (!res.ok) {
        setActionError(await getCustomerApiErrorMessage(res, GATE_COPY.actionFailed));
        return;
      }
      await load();
    } catch (err) {
      if (err instanceof CustomerSessionError) return;
      setActionError(err instanceof Error ? err.message : GATE_COPY.actionFailed);
    } finally {
      setBusy(null);
    }
  };

  if (state === 'NONE') return null;

  if (state === 'DECLINED_BANNER') {
    return (
      <div className="shrink-0 border-l-4 border-l-fx-brass bg-fx-brass/[0.06] px-6 md:px-8 py-3 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <FileText size={14} className="shrink-0 mt-[1px] text-fx-brass" />
          <div className="min-w-0">
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-fx-brass mb-1">
              {GATE_COPY.bannerLabel}
            </div>
            <p className="font-sans text-[12px] text-fx-dune leading-snug">
              {GATE_COPY.bannerBody(me.current.versionKey)}
            </p>
          </div>
        </div>
        <Link
          to="/agreement"
          className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-fx-brass hover:text-fx-ember transition-colors"
        >
          {GATE_COPY.bannerLink}
        </Link>
      </div>
    );
  }

  // 强制弹窗针对生效版；可关弹窗针对在途版（PENDING_DISMISSIBLE 必有 pending，这里仅为收窄类型）。
  const forced = state === 'EFFECTIVE_BLOCKING';
  const targetVersion = forced ? me.current : me.pending;
  if (!targetVersion) return null;
  if (!forced && dismissedPendingKey === targetVersion.versionKey) return null;

  const title = forced ? GATE_COPY.forcedTitle : GATE_COPY.pendingTitle;
  const effectiveOn = targetVersion.effectiveAt
    ? new Date(targetVersion.effectiveAt).toLocaleDateString()
    : STATUS_COPY.dateUnknown;
  const body = forced
    ? GATE_COPY.forcedBody(targetVersion.versionKey)
    : GATE_COPY.pendingBody(targetVersion.versionKey, effectiveOn);

  const dismiss = () => setDismissedPendingKey(targetVersion.versionKey);

  // 遮罩与对话框都不挂任何关闭处理（不用原生 <dialog>：它自带 Esc 关闭）。
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="agreement-gate-title"
        className="bg-fx-ink border border-fx-rule shadow-xl w-full max-w-lg"
      >
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-fx-brass">
            <FileText size={14} />
            <span id="agreement-gate-title">{title}</span>
          </div>
          <p className="text-[13px] text-fx-dune leading-relaxed">{body}</p>
          {targetVersion.summary && (
            <p className="text-[12px] text-fx-dust leading-relaxed">{targetVersion.summary}</p>
          )}
          {forced && <p className="text-[11px] text-fx-dust leading-relaxed">{GATE_COPY.forcedHint}</p>}
          {actionError && <p className="font-mono text-[12px] text-fx-rust">{actionError}</p>}
          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="button"
              className="fx-btn-primary whitespace-nowrap"
              disabled={busy !== null}
              onClick={() => void record(targetVersion.versionKey, 'ACCEPTED')}
            >
              {busy === 'ACCEPTED' ? GATE_COPY.recording : GATE_COPY.accept}
            </button>
            {forced ? (
              <button
                type="button"
                className="fx-btn-ghost whitespace-nowrap"
                disabled={busy !== null}
                onClick={() => void record(targetVersion.versionKey, 'DECLINED')}
              >
                {busy === 'DECLINED' ? GATE_COPY.recording : GATE_COPY.notNow}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="fx-btn-ghost whitespace-nowrap"
                  disabled={busy !== null}
                  onClick={() => {
                    dismiss();
                    navigate('/agreement');
                  }}
                >
                  {GATE_COPY.viewTerms}
                </button>
                <button type="button" className="fx-btn-ghost whitespace-nowrap" disabled={busy !== null} onClick={dismiss}>
                  {GATE_COPY.remindLater}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgreementGate;

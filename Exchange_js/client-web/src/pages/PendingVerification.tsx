import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { customerFetch } from '../utils/customerFetch';
import { useSimulationMode } from '../utils/simulationMode';

/**
 * 客户级补料认证页（parity 2026-08-14）—— mirror of WithdrawVerification.tsx
 * (deliberate fork)。锚点差异：充值/提现的 action 挂「订单+seq」，本页挂
 * 「客户单槽 pendingAction」——URL 无参数，会话端点凭 JWT 定位，客户端
 * 全程拿不到 Sumsub 侧 action id（防探测姿态与充值/提现逐字同源）。
 *
 * 入口：Swap/Withdraw 页顶部的 PendingActionBanner CTA。
 * 完成后：banner 转「审核中」；officer GREEN 清限制后 banner 消失、
 * 交易按钮经 AuthContext.refreshProfile 自动解禁（banner 内闭环）。
 */
const SESSION_URL = () =>
  `${import.meta.env.VITE_API_URL}/client/me/pending-action/verification-session`;

const PendingVerification = () => {
  const navigate = useNavigate();
  const location = useLocation();

  /** 返回「从哪来回哪去」；直接输 URL / 刷新进来时(location.key==='default')
   *  栈里没有站内上一页，退回 Swap 页兜底（banner 的两个挂载页之一）。 */
  const goBack = () =>
    location.key === 'default' ? navigate('/swap') : navigate(-1);
  // useSimulationMode 返回 { enabled }，不是布尔值本身。
  const { enabled: simulation } = useSimulationMode();
  const [token, setToken] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  // 提交失败要能原地重试，不能被误当成"加载失败"整页切换（评审教训，随 fork 保留）。
  const [submitError, setSubmitError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setState('loading');
    setSubmitError(false);
    try {
      const r = await customerFetch(SESSION_URL());
      if (!r.ok) throw new Error('session failed');
      const s = await r.json();
      setSubmitted(s.submitted);
      setToken(s.sdkToken);
      // submitted===false 却拿不到 sdkToken：这条 action 眼下打不开验证。
      // 真接分支必须显式落错误态，否则渲染空容器且无任何可操作入口
      //（fork 自 WithdrawVerification 的评审修复 (c)）。
      if (!simulation && !s.submitted && !s.sdkToken) {
        setState('error');
        return;
      }
      // 真接分支保持 'loading' 直到 idCheck.onReady（评审修复 (b)）；
      // demo 分支无 iframe 空窗，会话到手即绪。
      if (simulation) setState('ready');
    } catch {
      setState('error');
    }
  };

  useEffect(() => { void load(); }, []);

  // token 刷新回调：必须真的换新 token（评审修复 (a)）。
  const refreshToken = async () => {
    const r = await customerFetch(SESSION_URL());
    const s = await r.json();
    return s.sdkToken as string;
  };

  // 真接 Sumsub：token 到手后由 SDK 自己往容器里塞 iframe。
  useEffect(() => {
    if (simulation || !token || submitted || !containerRef.current) return;
    const sdk = (window as any).snsWebSdk;
    if (!sdk) { setState('error'); return; }
    const inst = sdk
      .init(token, () => refreshToken())
      .withOptions({ addViewportTag: false, adaptIframeHeight: true })
      .on('idCheck.onReady', () => setState('ready'))
      .on('idCheck.onApplicantSubmitted', () => { void doSubmit(); })
      .on('idCheck.onError', () => setState('error'))
      .build();
    inst.launch('#sumsub-container');
    return () => { if (containerRef.current) containerRef.current.innerHTML = ''; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulation, token, submitted]);

  const doSubmit = async () => {
    setBusy(true);
    setSubmitError(false);
    try {
      const r = await customerFetch(`${SESSION_URL()}/submit`, { method: 'POST' });
      // 失败留在原地重试，绝不静默"成功"跳走（评审修复，随 fork 保留）。
      if (!r.ok) throw new Error('submit failed');
      // goBack 而非 navigate(固定页)：历史栈语义见 WithdrawVerification 同处注释。
      goBack();
    } catch {
      setSubmitError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <button onClick={goBack} className="flex items-center gap-2 text-sm text-fx-dust hover:text-fx-brass mb-6">
        <ArrowLeft size={16} /> Back
      </button>

      <h1 className="text-xl font-bold text-fx-sand mb-1">Additional verification</h1>
      <p className="text-sm text-fx-dust mb-6">Provide the requested information to continue trading.</p>

      {submitError && (
        <div className="rounded-xl border border-fx-rust/30 bg-fx-rust/5 px-4 py-3 mb-4 text-sm text-fx-rust">
          Could not submit your documents. Please try again.
        </div>
      )}

      {submitted ? (
        <div className="rounded-xl border border-fx-rule bg-fx-charcoal/40 px-4 py-4 text-sm text-fx-dust">
          We have received your information and it is being reviewed.
        </div>
      ) : state === 'error' ? (
        <div className="rounded-xl border border-fx-rust/30 bg-fx-rust/5 px-4 py-4">
          <p className="text-sm text-fx-rust mb-3">Verification failed to load.</p>
          <button onClick={() => void load()} className="fx-btn-ghost">Retry</button>
        </div>
      ) : state === 'loading' && simulation ? (
        <div className="rounded-xl border border-fx-rule bg-fx-charcoal/40 px-4 py-4 text-sm text-fx-dust">
          Loading verification…
        </div>
      ) : simulation ? (
        <MockUploader busy={busy} onSubmit={() => void doSubmit()} />
      ) : (
        <div className="relative min-h-[600px]">
          <div id="sumsub-container" ref={containerRef} />
          {state === 'loading' && (
            <div className="absolute inset-0 grid place-items-center text-sm text-fx-dust">
              Loading verification…
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/** 演示用的假上传界面。真接 Sumsub 时这块由 SDK 渲染，本组件不参与。 */
const MockUploader = ({ busy, onSubmit }: { busy: boolean; onSubmit: () => void }) => (
  <div className="rounded-xl border border-fx-rule bg-fx-charcoal/40 px-6 py-8">
    <div className="border border-dashed border-fx-rule rounded-xl px-6 py-10 text-center text-sm text-fx-dust mb-6">
      Drag a file here, or browse
    </div>
    <button onClick={onSubmit} disabled={busy} className="fx-btn-primary w-full disabled:opacity-50">
      {busy ? 'Submitting…' : 'Submit documents'}
    </button>
  </div>
);

export default PendingVerification;

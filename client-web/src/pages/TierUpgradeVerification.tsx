import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { customerFetch } from '../utils/customerFetch';
import { useAuth } from '../context/AuthContext';
import { useSimulationMode } from '../utils/simulationMode';

interface TierUpgradeTemplate {
  kind: 'TIER_UPGRADE_UPLOAD';
  uploadSlots?: Array<{ code: string; label: string }>;
}

interface TierUpgradeSession {
  submitted: boolean;
  sdkToken: string | null;
  template: TierUpgradeTemplate | null;
}

/**
 * 档位升级补料会话页（波三）——整体照 OnboardingVerification.tsx 的双分支骨架搬
 * （加载态先拦 / 提交必查 r.ok / demo 分支假上传，真接分支 snsWebSdk 容器）。
 * 与入驻认证页的差异：模板固定只认 template.kind === 'TIER_UPGRADE_UPLOAD' 一种
 * （渲染 uploadSlots 两个虚线占位框：Proof of Address / Source of Funds，与
 * EDD_UPLOAD 分支同构，不做真文件处理）；删去 CDD 表单分支与 withdraw 撤回区
 * ——升档没有撤回，波次裁定。
 */
const TierUpgradeVerification = () => {
  const navigate = useNavigate();
  const { refreshProfile } = useAuth();
  const { enabled: simulation } = useSimulationMode();

  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [submitted, setSubmitted] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [template, setTemplate] = useState<TierUpgradeTemplate | null>(null);
  const [submitError, setSubmitError] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const goBack = () => navigate('/profile');

  const load = useCallback(async () => {
    setState('loading');
    setSubmitError(false);
    try {
      const r = await customerFetch(`${import.meta.env.VITE_API_URL}/client/me/tier-upgrade/session`);
      if (!r.ok) throw new Error('session failed');
      const s = (await r.json()) as TierUpgradeSession;
      setSubmitted(s.submitted);
      setToken(s.sdkToken);
      setTemplate(s.template);
      // 真接分支专属：simulation===false 时 submitted===false 却没拿到 token，
      // 说明这条会话眼下铸不出来（Sumsub 侧异常）。simulation 分支不会走到这里。
      if (!simulation && !s.submitted && !s.sdkToken) {
        setState('error');
        return;
      }
      // demo 分支（simulation===true）没有 iframe 空窗，模板数据一到就绪。
      // 真接分支（simulation===false）必须保持 'loading' 直到 idCheck.onReady 才置 'ready'。
      if (simulation) setState('ready');
    } catch {
      setState('error');
    }
  }, [simulation]);

  useEffect(() => { void load(); }, [load]);

  // token 刷新回调：真接分支专属，重新打一次会话接口拿新签发的 sdkToken。
  const refreshToken = async () => {
    const r = await customerFetch(`${import.meta.env.VITE_API_URL}/client/me/tier-upgrade/session`);
    const s = await r.json();
    return s.sdkToken as string;
  };

  // 真接 Sumsub：simulation===false 时走真 SDK，token 到手后由 SDK 自己往容器里
  // 塞 iframe。demo 分支（simulation===true）不走这条。
  useEffect(() => {
    if (simulation || !token || submitted || !containerRef.current) return;
    const sdk = (window as any).snsWebSdk;
    if (!sdk) { setState('error'); return; }
    const inst = sdk
      .init(token, () => refreshToken())
      .withOptions({ addViewportTag: false, adaptIframeHeight: true })
      .on('idCheck.onReady', () => setState('ready'))
      .on('idCheck.onApplicantSubmitted', () => { void submitReal(); })
      .on('idCheck.onError', () => setState('error'))
      .build();
    inst.launch('#sumsub-container');
    return () => { if (containerRef.current) containerRef.current.innerHTML = ''; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulation, token, submitted]);

  const doSubmit = async () => {
    setSubmitError(false);
    const r = await customerFetch(`${import.meta.env.VITE_API_URL}/client/me/tier-upgrade/submit`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    // 不检查 r.ok 就往下走会在后端 404/500 时静默"成功"——MaterialVerification 踩过的坑。
    if (!r.ok) { setSubmitError(true); return; }
    setSubmitted(true);
    await refreshProfile();
  };

  // 真接分支：SDK 已在 Sumsub 侧收好资料，这里只需落 materialsSubmittedAt（零存储路径）。
  const submitReal = () => doSubmit();

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <button onClick={goBack} className="mb-6 flex items-center gap-2 text-sm text-fx-dust hover:text-fx-brass">
        <ArrowLeft size={16} /> Back
      </button>

      <h1 className="mb-1 text-xl font-bold text-fx-sand">Tier upgrade — additional documents</h1>
      <p className="mb-6 text-sm text-fx-dust">Proof of address and source of funds · reviewed by compliance.</p>

      {submitError && (
        <div className="mb-4 rounded-xl border border-fx-rust/30 bg-fx-rust/5 px-4 py-3 text-sm text-fx-rust">
          Could not submit your information. Please try again.
        </div>
      )}

      {submitted ? (
        <div className="rounded-xl border border-fx-rule bg-fx-charcoal/40 px-4 py-4 text-sm text-fx-dust">
          <p className="mb-4">We have received your documents and they are being reviewed.</p>
          <button onClick={goBack} className="fx-btn-ghost">
            Back to profile
          </button>
        </div>
      ) : state === 'error' ? (
        <div className="rounded-xl border border-fx-rust/30 bg-fx-rust/5 px-4 py-4">
          <p className="mb-3 text-sm text-fx-rust">Verification failed to load.</p>
          <button onClick={() => void load()} className="fx-btn-ghost">Retry</button>
        </div>
      ) : state === 'loading' && simulation ? (
        // demo 分支必须有加载态：会话 GET 还在飞时占位框不能已经可点（旧页踩过）。
        // 真接分支的加载态由下面的 SDK 容器自己处理，所以这条分支只拦 simulation。
        <div className="rounded-xl border border-fx-rule bg-fx-charcoal/40 px-4 py-4 text-sm text-fx-dust">
          Loading verification…
        </div>
      ) : simulation && template?.kind === 'TIER_UPGRADE_UPLOAD' ? (
        <div className="rounded-xl border border-fx-rule bg-fx-charcoal/40 px-6 py-8">
          {(template.uploadSlots || []).map((slot) => (
            <div
              key={slot.code}
              className="mb-6 rounded-xl border border-dashed border-fx-rule px-6 py-10 text-center text-sm text-fx-dust"
            >
              {slot.label} — drag a file here, or browse
            </div>
          ))}
          <button onClick={() => void doSubmit()} className="fx-btn-primary w-full">
            Submit documents
          </button>
        </div>
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

export default TierUpgradeVerification;

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { customerFetch } from '../utils/customerFetch';
import { useSimulationMode } from '../utils/simulationMode';

/**
 * 材料请求账（2026-08-17）统一认证页 —— 收掉 DepositVerification /
 * WithdrawVerification / PendingVerification 三个旧页（按 seq / 客户级单指针
 * 定位，后端端点已被 Task 8/9/12 物理删除）。定位符统一改成 `requestNo`，
 * 不论这条材料请求绑没绑单、绑的是充值/提现/兑换哪个域，都走这一个页面。
 *
 * 两态结构照抄 DepositVerification.tsx 已跑通的版本，带走它修过的两个坑：
 * - 提交前必须检查 r.ok（否则后端 404/500 时会静默"成功"跳走）
 * - demo 分支要有加载态（会话 GET 还在飞时假上传组件不能已经可点）
 */
const MaterialVerification = () => {
  const { requestNo } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { enabled: simulation } = useSimulationMode();

  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [submitted, setSubmitted] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  /** 从哪来回哪去。没有 from 就回 Profile —— 材料这件事的常驻入口在那儿。 */
  const goBack = () => navigate(params.get('from') || '/profile');

  const load = useCallback(async () => {
    setState('loading');
    setSubmitError(false);
    try {
      const r = await customerFetch(
        `${import.meta.env.VITE_API_URL}/client/me/material-requests/${requestNo}/session`,
      );
      if (!r.ok) throw new Error('session failed');
      const s = (await r.json()) as { submitted: boolean; sdkToken: string | null };
      setSubmitted(s.submitted);
      setToken(s.sdkToken);
      // 真接分支专属：submitted===false 却没拿到 token，说明这条 action 眼下
      // 铸不出会话（Sumsub 侧异常，或号不属于自己/不存在——服务端对这些情形
      // 统一回 {submitted:true, sdkToken:null}，不会走到这条分支）。
      // demo 分支不会走到这里。
      if (!simulation && !s.submitted && !s.sdkToken) {
        setState('error');
        return;
      }
      // demo 分支没有 iframe 空窗，会话数据一到就绪。真接分支必须保持
      // 'loading' 直到 idCheck.onReady 才置 'ready'（下面那个 useEffect 里）。
      if (simulation) setState('ready');
    } catch {
      setState('error');
    }
  }, [requestNo, simulation]);

  useEffect(() => { void load(); }, [load]);

  // token 刷新回调：SDK 在当前 token 到期时会调用这个函数换新的，官方契约要求
  // 真的返回一个新 token——重新打一次会话接口，拿新签发的 sdkToken 返回。
  const refreshToken = async () => {
    const r = await customerFetch(
      `${import.meta.env.VITE_API_URL}/client/me/material-requests/${requestNo}/session`,
    );
    const s = await r.json();
    return s.sdkToken as string;
  };

  // 真接 Sumsub：token 到手后由 SDK 自己往容器里塞 iframe。
  // demo 模式不走这条——见下方的假上传按钮。
  useEffect(() => {
    if (simulation || !token || submitted || !containerRef.current) return;
    const sdk = (window as any).snsWebSdk;
    if (!sdk) { setState('error'); return; }
    const inst = sdk
      .init(token, () => refreshToken())
      .withOptions({ addViewportTag: false, adaptIframeHeight: true })
      .on('idCheck.onReady', () => setState('ready'))
      .on('idCheck.onApplicantSubmitted', () => { void submit(); })
      .on('idCheck.onError', () => setState('error'))
      .build();
    inst.launch('#sumsub-container');
    return () => { if (containerRef.current) containerRef.current.innerHTML = ''; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulation, token, submitted]);

  const submit = async () => {
    setSubmitError(false);
    const r = await fetchSubmit();
    // 不检查 r.ok 就往下走会在后端 404/500 时静默"成功"——旧页踩过的坑。
    if (!r.ok) { setSubmitError(true); return; }
    setSubmitted(true);
  };

  const fetchSubmit = () =>
    customerFetch(
      `${import.meta.env.VITE_API_URL}/client/me/material-requests/${requestNo}/submit`,
      { method: 'POST' },
    );

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <button onClick={goBack} className="mb-6 flex items-center gap-2 text-sm text-fx-dust hover:text-fx-brass">
        <ArrowLeft size={16} /> Back
      </button>

      <h1 className="mb-1 text-xl font-bold text-fx-sand">Document request</h1>
      <p className="mb-6 text-sm text-fx-dust">Provide the requested documents to continue.</p>

      {submitError && (
        <div className="mb-4 rounded-xl border border-fx-rust/30 bg-fx-rust/5 px-4 py-3 text-sm text-fx-rust">
          Could not submit your documents. Please try again.
        </div>
      )}

      {submitted ? (
        <div className="rounded-xl border border-fx-rule bg-fx-charcoal/40 px-4 py-4 text-sm text-fx-dust">
          We have received your information and it is being reviewed.
        </div>
      ) : state === 'error' ? (
        <div className="rounded-xl border border-fx-rust/30 bg-fx-rust/5 px-4 py-4">
          <p className="mb-3 text-sm text-fx-rust">Verification failed to load.</p>
          <button onClick={() => void load()} className="fx-btn-ghost">Retry</button>
        </div>
      ) : state === 'loading' && simulation ? (
        // demo 分支必须有加载态：会话 GET 还在飞时假上传组件不能已经可点，
        // 否则这期间点提交会静默跳走（旧页踩过）。真接分支的加载态由下面的
        // SDK 容器自己处理（容器 DOM 必须全程挂着让 sdk.launch() 能找到它），
        // 所以这条分支只拦 simulation，不拦真接分支。
        <div className="rounded-xl border border-fx-rule bg-fx-charcoal/40 px-4 py-4 text-sm text-fx-dust">
          Loading verification…
        </div>
      ) : simulation ? (
        <div className="rounded-xl border border-fx-rule bg-fx-charcoal/40 px-6 py-8">
          <div className="mb-6 rounded-xl border border-dashed border-fx-rule px-6 py-10 text-center text-sm text-fx-dust">
            Drag a file here, or browse
          </div>
          <button onClick={() => void submit()} className="fx-btn-primary w-full">
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

export default MaterialVerification;

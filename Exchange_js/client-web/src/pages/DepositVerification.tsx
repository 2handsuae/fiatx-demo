import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { customerFetch } from '../utils/customerFetch';
import { useSimulationMode } from '../utils/simulationMode';

const DepositVerification = () => {
  const { depositNo, seq } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  /** 返回「从哪来回哪去」；直接输 URL / 刷新进来时(location.key==='default')
   *  栈里没有站内上一页，退回本单详情兜底。 */
  const goBack = () =>
    location.key === 'default' ? navigate(`/deposit/${depositNo}`) : navigate(-1);
  // useSimulationMode 返回 { enabled }，不是布尔值本身——直接当布尔用会永远真值。
  const { enabled: simulation } = useSimulationMode();
  const [token, setToken] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  // Important 1（评审）：提交失败要能在原地重试，不能被误当成"加载失败"整页切换。
  const [submitError, setSubmitError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setState('loading');
    setSubmitError(false);
    try {
      const r = await customerFetch(
        `${import.meta.env.VITE_API_URL}/deposit-transactions/my/${depositNo}/verification-session/${seq}`,
      );
      if (!r.ok) throw new Error('session failed');
      const s = await r.json();
      setSubmitted(s.submitted);
      setToken(s.sdkToken);
      // (c) 真接分支专属：submitted===false 却拿不到 sdkToken，说明这条 action 眼下
      // 打不开验证（客户还没有可用的 applicant）。不特殊处理的话，真接分支下面那个
      // useEffect 会因 !token 提前 return（不设 error、不发起任何 SDK 调用），render
      // 落进 else 分支渲染一个空的 <div id="sumsub-container">，而 state 还是 'ready'
      // 不是 'loading' —— 既不显示遮罩也不显示错误重试，标题下面就是一片空白、无任何
      // 可操作入口。demo 分支不受影响：MockUploader 本来就不读 token。
      if (!simulation && !s.submitted && !s.sdkToken) {
        setState('error');
        return;
      }
      // (b) 演示分支没有 iframe 空窗，会话数据一到就绪。真接分支不能这样处理：token
      // 到手只表示"可以开始加载 iframe 了"，不代表 iframe 内容已经渲染出来。这里如果
      // 无条件置 'ready'，专门为那 1-3 秒空窗准备的 Loading 遮罩（渲染在下面真 SDK 容器
      // 分支里）就永远不会出现——因为它早于 sdk.launch() 真正被调用，而 idCheck.onReady
      // 回调也就变成把已经是 'ready' 的状态再设一次的空操作。这正是 Sumsub 官方文档点名
      // 的"组件看起来是空的"典型误用。真接分支必须保持 'loading'，交给下面 useEffect 里
      // 的 idCheck.onReady 回调来置——那才是"内容真的渲染出来了"的信号。
      if (simulation) setState('ready');
    } catch {
      setState('error');
    }
  };

  useEffect(() => { void load(); }, [depositNo, seq]);

  // (a) token 刷新回调：SDK 在当前 token 到期时会调用这个函数换新的，官方契约要求它
  // 真的返回一个新 token——原写法是 `() => Promise.resolve(token)`，把已经过期的那个
  // 原样递回去，SDK 会挂死。这里重新打一次会话接口，拿新签发的 sdkToken 返回。
  const refreshToken = async () => {
    const r = await customerFetch(
      `${import.meta.env.VITE_API_URL}/deposit-transactions/my/${depositNo}/verification-session/${seq}`,
    );
    const s = await r.json();
    return s.sdkToken as string;
  };

  // 真接 Sumsub：token 到手后由 SDK 自己往容器里塞 iframe。
  // demo 模式不走这条——见下方的假上传组件。
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
  }, [simulation, token, submitted]);

  const doSubmit = async () => {
    setBusy(true);
    setSubmitError(false);
    try {
      const r = await customerFetch(
        `${import.meta.env.VITE_API_URL}/deposit-transactions/my/${depositNo}/verification-session/${seq}/submit`,
        { method: 'POST' },
      );
      // Important 1（评审）：原来不检查 r.ok 就直接 navigate()——后端返 404/500（seq
      // 失效、并发边界等）时，客户端会静默把用户导回详情页，让他误以为提交成功了。
      // 失败必须留在原地，交给下面的错误提示 + 现成的提交按钮承担"重试"。
      if (!r.ok) throw new Error('submit failed');
      // 提交成功后走 goBack 而不是 navigate(详情页)：
      //  · push  → 认证页留在历史里，用户在详情页按返回会被弹回一个已经交完的认证页
      //  · replace → 用详情页 URL 顶掉认证页那条，历史里就出现**两条相邻且相同**的
      //    详情页条目，再按返回等于原地不动（看着像按钮坏了）
      // goBack 是 navigate(-1)（把认证页这条弹掉，自然回到进来时那张详情页），
      // 深链直接进认证页时无站内上一页，退回本单详情兜底。
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
        <ArrowLeft size={16} /> Deposit {depositNo}
      </button>

      <h1 className="text-xl font-bold text-fx-sand mb-1">Document request {seq}</h1>
      <p className="text-sm text-fx-dust mb-6">Provide the requested documents to continue.</p>

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
        // Important 2（评审）：demo 分支原来没有加载态——会话 GET 还在飞时（state 仍是
        // 初始 'loading'）假上传组件已经可点。配合 Important 1，这期间点提交、而该 seq
        // 其实无效的话，前端会静默"成功"跳走。真接分支的加载态自己在下面容器里处理，
        // 这里不重复也不能顶掉它：(b) 修完之后真接分支要一直等到 idCheck.onReady 才离开
        // 'loading'，容器 DOM 节点必须全程挂着让 sdk.launch() 能找到它，所以这条分支只
        // 拦截 simulation，不拦截真接分支。
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

export default DepositVerification;

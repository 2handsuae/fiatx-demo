import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { CustomerSessionError, customerFetch, getCustomerApiErrorMessage } from '../utils/customerFetch';
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
/** 材料请求列表里本页要用的几列（`GET /client/me/material-requests`，客户面投影）。 */
interface MaterialRow {
  requestNo: string;
  formKind: 'OWNERSHIP_CLAIM' | null;
  status: 'PENDING_SUBMISSION' | 'SUBMITTED';
  orderDomain: 'DEPOSIT' | 'WITHDRAW' | 'SWAP' | null;
  orderRef: string | null;
}

type ClaimPayload =
  | { claimType: 'SELF' }
  | { claimType: 'THIRD_PARTY_PERSON'; name: string; relationship: string }
  | { claimType: 'THIRD_PARTY_VASP'; name: string };

const inputClass =
  'mt-1 w-full px-3 py-2 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand focus:outline-none focus:border-fx-brass';

function ChoiceCard({ checked, onSelect, title, hint }: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={checked}
      className={`flex-1 rounded-xl border px-3 py-2.5 text-left transition-colors ${
        checked ? 'border-fx-brass bg-fx-brass/10' : 'border-fx-rule bg-fx-charcoal hover:border-fx-brass/40'
      }`}
    >
      <div className="text-sm font-semibold text-fx-sand">{title}</div>
      {hint && <div className="mt-0.5 text-[11px] leading-snug text-fx-dust">{hint}</div>}
    </button>
  );
}

/**
 * 来源认领表单（对手方波二）——我方自己的表单，不起 Sumsub SDK。
 * 两个分支：本人钱包（一颗签名确认按钮，mock 即点即过）/ 别人发来的（个人要姓名+关系，交易所要名称）。
 */
function OwnershipClaimForm({ busy, onSubmit }: {
  busy: boolean;
  onSubmit: (payload: ClaimPayload) => void;
}) {
  const [branch, setBranch] = useState<'SELF' | 'OTHER'>('SELF');
  const [senderKind, setSenderKind] = useState<'PERSON' | 'VASP'>('PERSON');
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');

  const otherPayload: ClaimPayload | null =
    senderKind === 'PERSON'
      ? name.trim() && relationship.trim()
        ? { claimType: 'THIRD_PARTY_PERSON', name: name.trim(), relationship: relationship.trim() }
        : null
      : name.trim()
        ? { claimType: 'THIRD_PARTY_VASP', name: name.trim() }
        : null;

  return (
    <div className="rounded-xl border border-fx-rule bg-fx-charcoal/40 px-6 py-6 space-y-5">
      <div>
        <div className="text-sm font-semibold text-fx-sand">Whose wallet sent this deposit?</div>
        <p className="mt-1 text-xs text-fx-dust">
          Tell us who the sending wallet belongs to so we can finish processing your deposit.
        </p>
      </div>

      <div role="radiogroup" aria-label="Sending wallet" className="flex gap-2">
        <ChoiceCard
          checked={branch === 'SELF'}
          onSelect={() => setBranch('SELF')}
          title="This is my own wallet"
          hint="I control the sending address"
        />
        <ChoiceCard
          checked={branch === 'OTHER'}
          onSelect={() => setBranch('OTHER')}
          title="Sent by someone else"
          hint="The wallet belongs to another person or an exchange"
        />
      </div>

      {branch === 'SELF' ? (
        <div className="space-y-3">
          <p className="text-xs text-fx-dust">Confirm that you own the sending wallet by signing a message with it.</p>
          <button
            onClick={() => onSubmit({ claimType: 'SELF' })}
            disabled={busy}
            className="fx-btn-primary w-full"
          >
            {busy ? 'Submitting…' : 'Verify by signature'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div role="radiogroup" aria-label="Sender" className="flex gap-2">
            <ChoiceCard checked={senderKind === 'PERSON'} onSelect={() => { setSenderKind('PERSON'); setName(''); }} title="An individual" />
            <ChoiceCard checked={senderKind === 'VASP'} onSelect={() => { setSenderKind('VASP'); setName(''); }} title="An exchange or custodian" />
          </div>

          {senderKind === 'PERSON' ? (
            <>
              <label className="block text-xs text-fx-dust font-medium">
                Full name
                <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
              </label>
              <label className="block text-xs text-fx-dust font-medium">
                Relationship to you
                <input
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value)}
                  placeholder="e.g. Family member, business partner"
                  className={inputClass}
                />
              </label>
            </>
          ) : (
            <label className="block text-xs text-fx-dust font-medium">
              Exchange or custodian name
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
            </label>
          )}

          <button
            onClick={() => otherPayload && onSubmit(otherPayload)}
            disabled={busy || !otherPayload}
            className="fx-btn-primary w-full"
          >
            {busy ? 'Submitting…' : 'Submit declaration'}
          </button>
        </div>
      )}
    </div>
  );
}

const MaterialVerification = () => {
  const { requestNo } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { enabled: simulation } = useSimulationMode();

  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [submitted, setSubmitted] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState(false);
  // 认领型（formKind=OWNERSHIP_CLAIM）材料：我方表单，不起 SDK、不打 session 端点。claim 非空 = 渲染认领表单。
  const [claim, setClaim] = useState<{ depositNo: string } | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);

  /** 从哪来回哪去。没有 from 就回 Profile —— 材料这件事的常驻入口在那儿。 */
  const goBack = () => navigate(params.get('from') || '/profile');

  const load = useCallback(async () => {
    setState('loading');
    setSubmitError(false);
    setClaim(null);
    try {
      // 先按列表判型：认领型分叉在 session 请求之前（后端对这类行的 session 端点也只回「没什么可做」）。
      // 列表里找不到（已办结的号）就照旧走 session，由它回「已提交」。
      const lr = await customerFetch(`${import.meta.env.VITE_API_URL}/client/me/material-requests`);
      if (!lr.ok) throw new Error('list failed');
      const row = ((await lr.json()) as MaterialRow[]).find((m) => m.requestNo === requestNo);
      if (row?.formKind === 'OWNERSHIP_CLAIM') {
        setSubmitted(row.status === 'SUBMITTED');
        setClaim({ depositNo: row.orderRef! });
        setState('ready');
        return;
      }

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

  /**
   * 认领提交。成功后只置 submitted——回炉（RESUME）是后端异步监听器的活，POST 返回体的状态可能还停在旧态；
   * 客户点 Back 回到详情页时详情页会重新 GET，那一拉才是状态真相（详情页无轮询，所以不在这里替它刷）。
   */
  const submitClaim = async (payload: ClaimPayload) => {
    setClaimBusy(true);
    setClaimError('');
    try {
      const r = await customerFetch(
        `${import.meta.env.VITE_API_URL}/deposit-transactions/my/${claim!.depositNo}/ownership-claim`,
        { method: 'POST', body: JSON.stringify(payload) },
      );
      if (!r.ok) {
        setClaimError(await getCustomerApiErrorMessage(r, 'Could not submit your declaration. Please try again.'));
        return;
      }
      setSubmitted(true);
    } catch (error) {
      if (error instanceof CustomerSessionError) return;
      setClaimError('Could not submit your declaration. Please try again.');
    } finally {
      setClaimBusy(false);
    }
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

      <h1 className="mb-1 text-xl font-bold text-fx-sand">{claim ? 'Declare source' : 'Document request'}</h1>
      <p className="mb-6 text-sm text-fx-dust">
        {claim ? 'Complete this step to continue with your deposit.' : 'Provide the requested documents to continue.'}
      </p>

      {submitError && (
        <div className="mb-4 rounded-xl border border-fx-rust/30 bg-fx-rust/5 px-4 py-3 text-sm text-fx-rust">
          Could not submit your documents. Please try again.
        </div>
      )}

      {claimError && (
        <div className="mb-4 rounded-xl border border-fx-rust/30 bg-fx-rust/5 px-4 py-3 text-sm text-fx-rust">
          {claimError}
        </div>
      )}

      {submitted ? (
        <div className="rounded-xl border border-fx-rule bg-fx-charcoal/40 px-4 py-4 text-sm text-fx-dust">
          We have received your information and it is being reviewed.
        </div>
      ) : claim ? (
        <OwnershipClaimForm busy={claimBusy} onSubmit={(payload) => void submitClaim(payload)} />
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

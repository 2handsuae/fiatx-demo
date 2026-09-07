import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { customerFetch } from '../utils/customerFetch';
import { useAuth } from '../context/AuthContext';

interface OnboardingTemplate {
  kind: 'CDD_FORM' | 'EDD_UPLOAD';
  uploadSlots?: Array<{ code: string; label: string }>;
}

interface OnboardingPrefill {
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
  idDocType: string | null;
  idDocNumber: string | null;
  residentialAddress: string | null;
}

interface OnboardingSession {
  submitted: boolean;
  sdkToken: string | null;
  levelName: string | null;
  template: OnboardingTemplate | null;
  prefill: OnboardingPrefill | null;
}

/**
 * 入驻认证页（波二）——照 MaterialVerification.tsx 的双分支骨架搬（加载态先拦 /
 * 提交必查 r.ok / demo 分支假上传，真接分支 snsWebSdk 容器），差异只在模板区：
 * template.kind === 'CDD_FORM' 渲染五字段表单（prefill 预填、可改）；
 * template.kind === 'EDD_UPLOAD' 渲染 session.template.uploadSlots 两个虚线占位框
 * （与补料页假上传同构，不做真文件处理）。
 */
const OnboardingVerification = () => {
  const navigate = useNavigate();
  const { user, refreshProfile } = useAuth();

  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [submitted, setSubmitted] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [template, setTemplate] = useState<OnboardingTemplate | null>(null);
  const [submitError, setSubmitError] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // CDD 表单字段（五必填 + 姓名两可选），prefill 到手后一次性灌入。
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    nationality: '',
    idDocType: '',
    idDocNumber: '',
    residentialAddress: '',
  });

  const goBack = () => navigate('/overview');

  const load = useCallback(async () => {
    setState('loading');
    setSubmitError(false);
    try {
      const r = await customerFetch(`${import.meta.env.VITE_API_URL}/client/me/onboarding/session`);
      if (!r.ok) throw new Error('session failed');
      const s = (await r.json()) as OnboardingSession;
      setSubmitted(s.submitted);
      setToken(s.sdkToken);
      setTemplate(s.template);
      if (s.prefill) {
        setForm({
          firstName: s.prefill.firstName || '',
          lastName: s.prefill.lastName || '',
          dateOfBirth: s.prefill.dateOfBirth || '',
          nationality: s.prefill.nationality || '',
          idDocType: s.prefill.idDocType || '',
          idDocNumber: s.prefill.idDocNumber || '',
          residentialAddress: s.prefill.residentialAddress || '',
        });
      }
      // 真接分支专属：没有我方模板、也没拿到 token，说明这条会话眼下铸不出来
      // （Sumsub 侧异常）。有模板（CDD_FORM / EDD_UPLOAD）不会走到这里。
      if (!s.template && !s.submitted && !s.sdkToken) {
        setState('error');
        return;
      }
      // demo 模板（CDD_FORM / EDD_UPLOAD）没有 iframe 空窗，模板数据一到就绪。
      // 真接分支（无 template）必须保持 'loading' 直到 idCheck.onReady 才置 'ready'。
      if (s.template) setState('ready');
    } catch {
      setState('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void load(); }, [load]);

  // token 刷新回调：真接分支专属，重新打一次会话接口拿新签发的 sdkToken。
  const refreshToken = async () => {
    const r = await customerFetch(`${import.meta.env.VITE_API_URL}/client/me/onboarding/session`);
    const s = await r.json();
    return s.sdkToken as string;
  };

  // 真接 Sumsub：template 为 null 时说明当前档位没有我方模板（走真 SDK），token 到手后
  // 由 SDK 自己往容器里塞 iframe。demo 模板（有 template）不走这条。
  useEffect(() => {
    if (template || !token || submitted || !containerRef.current) return;
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
  }, [template, token, submitted]);

  const doSubmit = async (body?: Record<string, string>) => {
    setSubmitError(false);
    const r = await customerFetch(`${import.meta.env.VITE_API_URL}/client/me/onboarding/submit`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    });
    // 不检查 r.ok 就往下走会在后端 404/500 时静默"成功"——MaterialVerification 踩过的坑。
    if (!r.ok) { setSubmitError(true); return; }
    setSubmitted(true);
    await refreshProfile();
  };

  // 真接分支：SDK 已在 Sumsub 侧收好资料，这里只需落 submittedAt（EDD 零存储路径）。
  const submitReal = () => doSubmit();

  const submitCdd = () => doSubmit({ ...form });

  const withdraw = async () => {
    const r = await customerFetch(`${import.meta.env.VITE_API_URL}/client/me/onboarding/withdraw`, {
      method: 'POST',
    });
    if (!r.ok) return;
    await refreshProfile();
    navigate('/overview');
  };

  const setField = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <button onClick={goBack} className="mb-6 flex items-center gap-2 text-sm text-fx-dust hover:text-fx-brass">
        <ArrowLeft size={16} /> Back
      </button>

      <h1 className="mb-1 text-xl font-bold text-fx-sand">Identity verification</h1>
      <p className="mb-6 text-sm text-fx-dust">VARA regulated · takes about three minutes.</p>

      {submitError && (
        <div className="mb-4 rounded-xl border border-fx-rust/30 bg-fx-rust/5 px-4 py-3 text-sm text-fx-rust">
          Could not submit your information. Please try again.
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
      ) : state === 'loading' && token === null && template === null ? (
        // 初次会话 GET 还在飞、什么都还没拿到——demo 模板 / 真接分支都不能先渲染。
        // 真接分支拿到 token 后（还在等 idCheck.onReady）改由下面容器自己的浮层显示加载态。
        <div className="rounded-xl border border-fx-rule bg-fx-charcoal/40 px-4 py-4 text-sm text-fx-dust">
          Loading verification…
        </div>
      ) : template?.kind === 'CDD_FORM' ? (
        <div className="rounded-xl border border-fx-rule bg-fx-charcoal/40 px-6 py-8">
          <div className="mb-5 grid grid-cols-2 gap-4">
            <label className="text-sm text-fx-dust">
              First name
              <input
                name="firstName"
                className="mt-1 w-full rounded-lg border border-fx-rule bg-transparent px-3 py-2 text-sm text-fx-sand"
                value={form.firstName}
                onChange={setField('firstName')}
              />
            </label>
            <label className="text-sm text-fx-dust">
              Last name
              <input
                name="lastName"
                className="mt-1 w-full rounded-lg border border-fx-rule bg-transparent px-3 py-2 text-sm text-fx-sand"
                value={form.lastName}
                onChange={setField('lastName')}
              />
            </label>
          </div>
          <div className="mb-5 grid grid-cols-2 gap-4">
            <label className="text-sm text-fx-dust">
              Date of birth *
              <input
                name="dateOfBirth"
                type="date"
                className="mt-1 w-full rounded-lg border border-fx-rule bg-transparent px-3 py-2 text-sm text-fx-sand"
                value={form.dateOfBirth}
                onChange={setField('dateOfBirth')}
              />
            </label>
            <label className="text-sm text-fx-dust">
              Nationality *
              <input
                name="nationality"
                className="mt-1 w-full rounded-lg border border-fx-rule bg-transparent px-3 py-2 text-sm text-fx-sand"
                value={form.nationality}
                onChange={setField('nationality')}
              />
            </label>
          </div>
          <div className="mb-5 grid grid-cols-2 gap-4">
            <label className="text-sm text-fx-dust">
              ID document type *
              <input
                name="idDocType"
                className="mt-1 w-full rounded-lg border border-fx-rule bg-transparent px-3 py-2 text-sm text-fx-sand"
                value={form.idDocType}
                onChange={setField('idDocType')}
              />
            </label>
            <label className="text-sm text-fx-dust">
              ID document number *
              <input
                name="idDocNumber"
                className="mt-1 w-full rounded-lg border border-fx-rule bg-transparent px-3 py-2 text-sm text-fx-sand"
                value={form.idDocNumber}
                onChange={setField('idDocNumber')}
              />
            </label>
          </div>
          <label className="mb-6 block text-sm text-fx-dust">
            Residential address *
            <input
              name="residentialAddress"
              className="mt-1 w-full rounded-lg border border-fx-rule bg-transparent px-3 py-2 text-sm text-fx-sand"
              value={form.residentialAddress}
              onChange={setField('residentialAddress')}
            />
          </label>
          <button onClick={() => void submitCdd()} className="fx-btn-primary w-full">
            Submit
          </button>
        </div>
      ) : template?.kind === 'EDD_UPLOAD' ? (
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

      {user?.lifecycle === 'IN_VERIFICATION' && (
        <div className="mt-6 border-t border-fx-rule pt-6">
          <button onClick={() => void withdraw()} className="fx-btn-ghost">
            Withdraw application
          </button>
        </div>
      )}
    </div>
  );
};

export default OnboardingVerification;

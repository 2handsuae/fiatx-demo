import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { customerFetch } from '../utils/customerFetch';
import { useSimulationMode } from '../utils/simulationMode';

const DepositVerification = () => {
  const { depositNo, seq } = useParams();
  const navigate = useNavigate();
  // useSimulationMode 返回 { enabled }，不是布尔值本身——直接当布尔用会永远真值。
  const { enabled: simulation } = useSimulationMode();
  const [token, setToken] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setState('loading');
    try {
      const r = await customerFetch(
        `${import.meta.env.VITE_API_URL}/deposit-transactions/my/${depositNo}/verification-session/${seq}`,
      );
      if (!r.ok) throw new Error('session failed');
      const s = await r.json();
      setSubmitted(s.submitted);
      setToken(s.sdkToken);
      setState('ready');
    } catch {
      setState('error');
    }
  };

  useEffect(() => { void load(); }, [depositNo, seq]);

  // 真接 Sumsub：token 到手后由 SDK 自己往容器里塞 iframe。
  // demo 模式不走这条——见下方的假上传组件。
  useEffect(() => {
    if (simulation || !token || submitted || !containerRef.current) return;
    const sdk = (window as any).snsWebSdk;
    if (!sdk) { setState('error'); return; }
    const inst = sdk
      .init(token, () => Promise.resolve(token))
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
    try {
      await customerFetch(
        `${import.meta.env.VITE_API_URL}/deposit-transactions/my/${depositNo}/verification-session/${seq}/submit`,
        { method: 'POST' },
      );
      navigate(`/deposit/${depositNo}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl">
      <button onClick={() => navigate(`/deposit/${depositNo}`)} className="flex items-center gap-2 text-sm text-fx-dust hover:text-fx-brass mb-6">
        <ArrowLeft size={16} /> Deposit {depositNo}
      </button>

      <h1 className="text-xl font-bold text-fx-sand mb-1">Document request {seq}</h1>
      <p className="text-sm text-fx-dust mb-6">Provide the requested documents to continue.</p>

      {submitted ? (
        <div className="rounded-xl border border-fx-rule bg-fx-charcoal/40 px-4 py-4 text-sm text-fx-dust">
          We have received your information and it is being reviewed.
        </div>
      ) : state === 'error' ? (
        <div className="rounded-xl border border-fx-rust/30 bg-fx-rust/5 px-4 py-4">
          <p className="text-sm text-fx-rust mb-3">Verification failed to load.</p>
          <button onClick={() => void load()} className="fx-btn-ghost">Retry</button>
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

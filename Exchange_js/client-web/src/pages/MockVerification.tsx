import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { customerFetch } from '../utils/customerFetch';

/**
 * Mock 认证页——演示期占住真实 Sumsub WebSDK 将来要占的那块容器。
 * 不真收文件。提交后 postMessage 出真实 SDK 的事件名，父页面 handler
 * 换成真 SDK 时无需改动。
 */
export default function MockVerification() {
  const [params] = useSearchParams();
  const depositNo = params.get('deposit') ?? '';
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      // 用项目既有的 customerFetch（它读 localStorage 的 `customer_token`
      // 并统一挂 Authorization）。**不要**自己拼 token：本项目客户端 token
      // 的 key 是 `customer_token` 而非 `token`，手拼必 401。
      const r = await customerFetch(
        `${import.meta.env.VITE_API_URL}/deposit-transactions/my/${depositNo}/verification-session/submit`,
        { method: 'POST' },
      );
      if (!r.ok) throw new Error('submit failed');
      window.parent.postMessage(
        { type: 'idCheck.onApplicantSubmitted' },
        window.location.origin,
      );
    } catch {
      setErr('Submission failed. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-fx-obsidian px-8 py-10 text-fx-sand">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-fx-dust">
        Verification provider · demo
      </div>
      <h1 className="fx-display mt-3 text-[28px] font-light">Upload your documents</h1>
      <p className="fx-serif mt-3 max-w-[460px] text-[14px] leading-[1.7] text-fx-dune">
        Please upload the supporting documents requested for this transaction.
      </p>

      <div className="mt-8 grid place-items-center rounded-xl border border-dashed border-fx-rule py-14 text-fx-dust">
        Drag files here, or click to browse
      </div>

      <button
        onClick={() => void submit()}
        disabled={busy || !depositNo}
        className="mt-8 rounded-xl bg-fx-brass px-6 py-3 font-semibold text-fx-obsidian disabled:opacity-50"
      >
        {busy ? 'Submitting…' : 'Submit'}
      </button>
      {err ? <div className="mt-3 text-sm text-fx-rust">{err}</div> : null}
    </div>
  );
}

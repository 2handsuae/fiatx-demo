// admin-web/src/components/SimulationPanel.tsx
import { useState } from 'react';
import { useVerdictButtons, type VerdictButton } from '../hooks/useVerdictButtons';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from './common/adminButtonStyles';
import { DetailCard } from './compliance/DetailPageComponents';

type Domain = 'deposit' | 'withdraw' | 'swap';

const ID_FIELD: Record<Domain, string> = {
  deposit: 'depositId',
  withdraw: 'withdrawId',
  swap: 'swapId',
};

/* 置灰时的一句说明——原样保留自抽取前三页各自的手写文案。充值/提现这句
   逐字相同；兑换因业主 2026-08-24 改判换了判据（只有 COMPLIANCE_PENDING
   可投），文案本就不同，一并原样保留，不强行统一成一句话。 */
const DISABLED_REASON: Record<Domain, string> = {
  deposit: 'This order is in a terminal/dispositioned state — a submitted verdict will be recorded by the backend but will not change the status.',
  withdraw: 'This order is in a terminal/dispositioned state — a submitted verdict will be recorded by the backend but will not change the status.',
  swap: "This order isn't in Compliance Pending — verdict buttons ①-⑧ won't advance it, so they're disabled.",
};

const GROUPS: readonly (readonly [VerdictButton['source'], string])[] = [
  ['ENGINE', 'Automatically matched by the Sumsub rule engine'],
  ['OFFICER', 'Manually actioned by a compliance officer on the Sumsub console'],
];

/**
 * ⚡ Simulation 面板 —— 三域共用（2026-08-29 抽出，此前三份手写；充值/提现
 * 归一化后 diff 只差按钮数组名，见 PRODUCTION-NOTES 记的账）。
 *
 * 按 source 分两组渲染：Sumsub 规则引擎自动命中 vs 合规官在 Sumsub 台上手工
 * 处置 —— 这两件事在演示里是两个故事，运营该一眼看得出自己在模拟哪一种。
 */
export function SimulationPanel(props: {
  domain: Domain;
  orderId: string;
  disabled?: boolean;
  onDone: () => void;
}) {
  const { buttons } = useVerdictButtons(props.domain);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const run = async (key: string) => {
    setBusy(key);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/${props.domain}-sumsub/demo/run-verdict`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [ID_FIELD[props.domain]]: props.orderId, verdict: key }),
        },
      );
      if (!response.ok) {
        if (response.status === 404) {
          setError('Demo endpoint unavailable — backend SUMSUB_MOCK_MODE is off.');
        } else {
          setError(await getApiErrorMessage(response, 'Verdict run failed.'));
        }
        return;
      }
      props.onDone();
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Verdict run failed.');
    } finally {
      setBusy(null);
    }
  };

  const group = (source: VerdictButton['source']) =>
    buttons.filter((b) => b.source === source);

  return (
    <DetailCard title="⚡ Simulation" columns={1}>
      {props.disabled && (
        <p className="font-mono text-[11px] text-adm-amber">{DISABLED_REASON[props.domain]}</p>
      )}
      {error && <p className="text-[11px] text-adm-red">{error}</p>}
      {GROUPS.map(([source, caption]) => (
        <div key={source} className="mb-3 last:mb-0">
          <p className="mb-1.5 font-mono text-[9px] text-adm-t3">{caption}</p>
          <div className="flex flex-wrap gap-2">
            {group(source).map((b) => (
              <button
                key={b.key}
                disabled={props.disabled || busy !== null}
                onClick={() => void run(b.key)}
                className={adminButtonClass('simulationAction')}
              >
                {busy === b.key ? 'Running...' : b.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </DetailCard>
  );
}

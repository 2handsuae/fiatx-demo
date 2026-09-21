// admin-web/src/components/reconciliation/WriteOffPrereqPanel.tsx
//
// 平账处置改版 Task 10（M10–M12）：核销/认损锁定视图的前提清单区——第六幕清残留
// 波四 Task 6 从 ReconciliationAdjustmentCreateModal 外迁。账龄路四前提
// （v8-recon.md §核销/认损行）原样保留；事故路（spec §4 M12）换成三前提，说明
// 这张单为什么此刻能开、金额为什么锁定在这个数。纯展示，不参与提交体——闸真正
// 卡在后端（assertWriteOffAllowed / assertIncidentWriteOffAllowed），这里只是
// 让人看懂门是怎么开的。
import { formatAmount } from '../../utils/reconAmount';
import type { AdjustmentBook, AdjustmentLocked } from '../ReconciliationAdjustmentCreateModal';

interface WriteOffPrereqPanelProps {
  writeOff: NonNullable<AdjustmentLocked['writeOff']>;
  /** 事故路缺 assessedDisplay 时的兜底文案素材——同原实现读 prefill.amountMinor。 */
  amountMinor: string;
  decimals: number;
  assetCode: string;
  book: AdjustmentBook;
}

const WriteOffPrereqPanel = ({ writeOff, amountMinor, decimals, assetCode, book }: WriteOffPrereqPanelProps) => (
  <div className="mb-4 space-y-1 rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t2">
    <div className="mb-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3">
      {writeOff.source === 'INCIDENT' ? 'Unlocked by · Incident loss assessment' : 'Unlocked by · Aging'}
    </div>
    {writeOff.source === 'INCIDENT' ? (
      <>
        <div>✓ Incident {writeOff.incidentNo ?? '—'} · loss assessed (FIRM_LOSS)</div>
        <div>✓ Amount locked = {writeOff.assessedDisplay ?? `${formatAmount(amountMinor, decimals)} ${assetCode}`}</div>
        <div>✓ Small-amount threshold not applicable (incident process is the large-amount control)</div>
      </>
    ) : (
      <>
        <div>✓ Case overdue</div>
        <div>✓ Finding = Hold · Investigating</div>
        <div>✓ Amount ≤ small-amount threshold</div>
        <div>✓ {book === 'CLIENT' ? 'Client book' : 'Firm book'}</div>
      </>
    )}
  </div>
);

export default WriteOffPrereqPanel;

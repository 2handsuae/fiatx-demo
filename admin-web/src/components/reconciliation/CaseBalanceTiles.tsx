// admin-web/src/components/reconciliation/CaseBalanceTiles.tsx
//
// 第六幕波四（Task 4）：从 ReconciliationCasesDetailPage.tsx 剪切粘贴外迁——
// Balance Explained 区（五瓦 + 外层 DetailCard）成组件。逐字搬运，注释随行；不改
// JSX/className/文案。deltaZero / sign 是页面级派生值（sign 同一份还在 Sidebar
// 复用），不在组件内重新计算——按 props 收口，禁止把求和/派生算式搬进组件。
import { Check, AlertTriangle } from 'lucide-react';
import { DetailCard } from '../compliance/DetailPageComponents';
import type { ReconCaseDetail } from '../../utils/reconTypes';
import { formatAmount, isZeroAmount } from '../../utils/reconAmount';
import { buildInternalCheckLine } from '../../utils/caseInternalCheck';

export const CaseBalanceTiles = ({
  kase, deltaZero, sign,
}: { kase: ReconCaseDetail; deltaZero: boolean; sign: '+' | '-' | '' }) => (
  <>
    {/* 3. Balance Explained — five tiles. Replaces the old 3-cell
        Balance Comparison card (Internal/External/Δ were a subset of
        this same story) so there's a single balance-explanation surface,
        not two overlapping ones. Unexplained (residual) is the core
        investigation signal — zero means the delta is fully explained by
        in-transit funds orders; non-zero is what still needs digging. */}
    <DetailCard title={`Balance Explained (${kase.assetCode})`} columns={1}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
        {/* Internal */}
        <div className="rounded-lg border border-adm-border bg-adm-bg p-4">
          <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">
            Internal
          </div>
          <div className="mt-1 font-mono text-[18px] font-bold leading-tight text-adm-t1">
            {formatAmount(kase.explain?.internalTotal ?? kase.tbAmount, kase.decimals)}
          </div>
        </div>
        {/* External — actual closing balance from the external statement
            (post-injection in demo break mode). expectedExternal is the
            pre-injection mirror snapshot and would falsely equal internal
            whenever the break is on a single wallet's external balance. */}
        <div className="rounded-lg border border-adm-border bg-adm-bg p-4">
          <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">
            External
          </div>
          <div className="mt-1 font-mono text-[18px] font-bold leading-tight text-adm-t1">
            {formatAmount(kase.explain?.externalClosing ?? kase.actualExternal, kase.decimals)}
          </div>
        </div>
        {/* Difference (Δ) — muted green/check when balanced, bold red with sign when not. */}
        <div
          className={[
            'rounded-lg border p-4',
            deltaZero
              ? 'border-adm-green/30 bg-adm-green/5'
              : 'border-adm-red/30 bg-adm-red/5',
          ].join(' ')}
        >
          <div
            className={[
              'font-mono text-[9px] uppercase tracking-wider',
              deltaZero ? 'text-adm-green' : 'text-adm-red',
            ].join(' ')}
          >
            Difference
          </div>
          <div
            className={[
              'mt-1 font-mono text-[18px] font-bold leading-tight',
              deltaZero ? 'text-adm-t3' : 'text-adm-red',
            ].join(' ')}
          >
            {deltaZero
              ? `${formatAmount(kase.deltaAmount, kase.decimals)}`
              : `${sign}${formatAmount(kase.deltaAmount, kase.decimals).replace(/^-/, '')}`}
          </div>
        </div>
        {/* In-Transit explained — blue, the portion of Δ covered by
            non-terminal funds orders. */}
        <div className="rounded-lg border border-adm-blue/30 bg-adm-blue/5 p-4">
          <div className="font-mono text-[9px] uppercase tracking-wider text-adm-blue">
            In-Transit
          </div>
          <div className="mt-1 font-mono text-[18px] font-bold leading-tight text-adm-blue">
            {kase.explain ? formatAmount(kase.explain.inTransitSigned, kase.decimals) : '—'}
          </div>
        </div>
        {/* Unexplained (residual) — the core investigation signal. Red
            highlight when non-zero (still needs digging); muted green
            check when zero (delta fully explained by in-transit). */}
        <div
          className={[
            'rounded-lg border p-4',
            kase.explain && isZeroAmount(kase.explain.residual)
              ? 'border-adm-green/30 bg-adm-green/5'
              : 'border-adm-red/30 bg-adm-red/5',
          ].join(' ')}
        >
          <div
            className={[
              'font-mono text-[9px] uppercase tracking-wider',
              kase.explain && isZeroAmount(kase.explain.residual) ? 'text-adm-green' : 'text-adm-red',
            ].join(' ')}
          >
            Unexplained
          </div>
          <div
            className={[
              'mt-1 font-mono text-[18px] font-bold leading-tight',
              kase.explain && isZeroAmount(kase.explain.residual) ? 'text-adm-t3' : 'text-adm-red',
            ].join(' ')}
          >
            {kase.explain ? formatAmount(kase.explain.residual, kase.decimals) : '—'}
          </div>
          <div
            className={[
              'mt-1 inline-flex items-center gap-1 font-mono text-[10px]',
              kase.explain && isZeroAmount(kase.explain.residual) ? 'text-adm-green' : 'text-adm-red',
            ].join(' ')}
          >
            {!kase.explain ? null : isZeroAmount(kase.explain.residual)
              ? <><Check size={10} /> explained</>
              : <><AlertTriangle size={10} /> needs investigation</>}
          </div>
        </div>
      </div>
      {/* 戊波二 T10：Internal 格的副行（只有客户钱包案有）——钱包自己的两本账：现金 + 短缺待补 对 应付 + 暂扣。
          四个数与 Δ 都是后端检查器按案件截止点现算的（和跑批同一份算式），这里只排版；Δ ≠ 0 红。
          整行放在五格下面、从 Internal 格对齐处起，单格宽度放不下这一行。 */}
      {kase.explain?.internalBreakdown && (() => {
        const line = buildInternalCheckLine(kase.explain.internalBreakdown, (v) => formatAmount(v, kase.decimals));
        return (
          <div className="mt-2 font-mono text-[11px] text-adm-t2" title="Customer wallet's two books: wallet cash + shortfall receivable vs customer payable + held deposits">
            <span className="mr-2 text-[9px] uppercase tracking-wider text-adm-t3">Internal</span>
            {line.head} ｜ Δ{' '}
            <span className={line.deltaZero ? 'text-adm-t3' : 'font-bold text-adm-red'}>{line.delta}</span>
          </div>
        );
      })()}
    </DetailCard>
  </>
);

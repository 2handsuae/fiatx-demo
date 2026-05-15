import { RefreshCw } from 'lucide-react';
import { adminIconButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';

/* ── Types ───────────────────────────────────────────────────────── */

interface SodEntry {
  actionType: string;
  label: string;
  wave: string;
  status: 'ACTIVE' | 'PRE_REGISTERED';
  trigger: string;
  checkerRoles: string[];
  timeoutHours: number;
  sodRule: string;
  allowCancel: boolean;
  allowRetry: boolean;
}

/* ── Static SoD config — mirrors DEFAULT_APPROVAL_POLICIES ──────── */

const SOD_CONFIG: SodEntry[] = [
  // ─── Wave 1 Active ────────────────────────────────────────────
  {
    actionType: 'AUDIT_EVIDENCE_EXPORT_APPROVAL',
    label: 'Audit Evidence Export',
    wave: 'Wave 1',
    status: 'ACTIVE',
    trigger: 'Compliance Officer / MLRO / DPO',
    checkerRoles: ['MLRO'],
    timeoutHours: 24,
    sodRule: 'DENY_SAME_USER_MAKER_CHECKER',
    allowCancel: true,
    allowRetry: true,
  },
  {
    actionType: 'CASE_EVIDENCE_EXPORT_APPROVAL',
    label: 'Case Evidence Export',
    wave: 'Wave 1',
    status: 'ACTIVE',
    trigger: 'Compliance Officer / MLRO',
    checkerRoles: ['DPO', 'MLRO'],
    timeoutHours: 24,
    sodRule: 'DENY_SAME_USER_MAKER_CHECKER',
    allowCancel: true,
    allowRetry: true,
  },
  {
    actionType: 'CHANGE_TICKET_APPROVAL',
    label: 'Change Ticket',
    wave: 'Wave 1',
    status: 'ACTIVE',
    trigger: 'Tech Officer / Ops Officer / Compliance Officer',
    checkerRoles: ['CISO'],
    timeoutHours: 24,
    sodRule: 'DENY_SAME_USER_MAKER_CHECKER',
    allowCancel: true,
    allowRetry: true,
  },
  {
    actionType: 'ONBOARDING_FINAL_APPROVAL',
    label: 'Onboarding Final Approval',
    wave: 'Wave 1',
    status: 'ACTIVE',
    trigger: 'System — Sumsub Level 2 workflow complete',
    checkerRoles: ['MLRO', 'SENIOR_MANAGEMENT_OFFICER'],
    timeoutHours: 240,
    sodRule: 'DENY_SAME_USER_MAKER_CHECKER',
    allowCancel: true,
    allowRetry: true,
  },
  // ─── Wave 3 Active ────────────────────────────────────────────
  {
    actionType: 'RISK_RATING_MEDIUM_APPROVAL',
    label: 'Risk Rating — Medium',
    wave: 'Wave 3',
    status: 'ACTIVE',
    trigger: 'System — CRA engine',
    checkerRoles: ['COMPLIANCE_OFFICER'],
    timeoutHours: 168,
    sodRule: 'DENY_SAME_USER_MAKER_CHECKER',
    allowCancel: true,
    allowRetry: true,
  },
  {
    actionType: 'RISK_RATING_HIGH_APPROVAL',
    label: 'Risk Rating — High',
    wave: 'Wave 3',
    status: 'ACTIVE',
    trigger: 'System — CRA engine',
    checkerRoles: ['MLRO', 'SENIOR_MANAGEMENT_OFFICER'],
    timeoutHours: 240,
    sodRule: 'DENY_SAME_USER_MAKER_CHECKER',
    allowCancel: true,
    allowRetry: true,
  },
  {
    actionType: 'RISK_RATING_UPGRADE_PHASE1',
    label: 'Risk Rating Upgrade Phase 1',
    wave: 'Wave 3',
    status: 'ACTIVE',
    trigger: 'System — Tier upgrade CRA gate',
    checkerRoles: ['MLRO'],
    timeoutHours: 168,
    sodRule: 'DENY_SAME_USER_MAKER_CHECKER',
    allowCancel: true,
    allowRetry: true,
  },
  {
    actionType: 'RISK_RATING_MAINTENANCE_APPROVAL',
    label: 'Risk Rating Maintenance',
    wave: 'Wave 3',
    status: 'ACTIVE',
    trigger: 'System — periodic review sweep',
    checkerRoles: ['MLRO'],
    timeoutHours: 168,
    sodRule: 'DENY_SAME_USER_MAKER_CHECKER',
    allowCancel: true,
    allowRetry: true,
  },
  {
    actionType: 'PEP_RELATIONSHIP_APPROVAL',
    label: 'PEP Relationship',
    wave: 'Wave 3',
    status: 'ACTIVE',
    trigger: 'System — PEP detection',
    checkerRoles: ['MLRO', 'SENIOR_MANAGEMENT_OFFICER'],
    timeoutHours: 240,
    sodRule: 'DENY_SAME_USER_MAKER_CHECKER',
    allowCancel: true,
    allowRetry: true,
  },
  {
    actionType: 'RISK_RATING_MLRO_REVIEW',
    label: 'Risk Rating MLRO Review',
    wave: 'Wave 3',
    status: 'ACTIVE',
    trigger: 'System — Tier upgrade Phase 2',
    checkerRoles: ['MLRO'],
    timeoutHours: 168,
    sodRule: 'DENY_SAME_USER_MAKER_CHECKER',
    allowCancel: true,
    allowRetry: true,
  },
  {
    actionType: 'RISK_RATING_TIER_UPGRADE_APPROVAL',
    label: 'Risk Rating Tier Upgrade',
    wave: 'Wave 3',
    status: 'ACTIVE',
    trigger: 'System — Tier upgrade final gate',
    checkerRoles: ['MLRO', 'SENIOR_MANAGEMENT_OFFICER'],
    timeoutHours: 240,
    sodRule: 'DENY_SAME_USER_MAKER_CHECKER',
    allowCancel: true,
    allowRetry: true,
  },
  // ─── Wave 5+ Pre-registered ───────────────────────────────────
  {
    actionType: 'POOL_SETTLEMENT_BATCH_APPROVAL',
    label: 'Pool Settlement Batch',
    wave: 'Wave 5+',
    status: 'PRE_REGISTERED',
    trigger: 'Tech Officer / Ops Officer',
    checkerRoles: ['SENIOR_MANAGEMENT_OFFICER', 'TECH_OFFICER'],
    timeoutHours: 24,
    sodRule: 'DENY_SAME_USER_MAKER_CHECKER',
    allowCancel: true,
    allowRetry: true,
  },
  {
    actionType: 'TREASURY_CROSS_POOL_TRANSFER_APPROVAL',
    label: 'Treasury Cross-Pool Transfer',
    wave: 'Wave 5+',
    status: 'PRE_REGISTERED',
    trigger: 'TBD (Wave 5+)',
    checkerRoles: ['SENIOR_MANAGEMENT_OFFICER', 'TECH_OFFICER'],
    timeoutHours: 24,
    sodRule: 'DENY_SAME_USER_MAKER_CHECKER',
    allowCancel: true,
    allowRetry: true,
  },
];

/* ── Wave badge helper ───────────────────────────────────────────── */

const waveBadgeClass = (wave: string): string => {
  if (wave === 'Wave 1') return 'border-adm-green/30 bg-adm-green/10 text-adm-green';
  if (wave === 'Wave 3') return 'border-adm-blue/30 bg-adm-blue/10 text-adm-blue';
  return 'border-adm-border bg-adm-card text-adm-t3';
};

/* ── Component ───────────────────────────────────────────────────── */

const SodConfigPage = () => {
  const activeCount = SOD_CONFIG.filter((e) => e.status === 'ACTIVE').length;
  const totalCount = SOD_CONFIG.length;

  const columns: [string, string][] = [
    ['Action Type', '260px'],
    ['Wave', '80px'],
    ['Trigger / Maker', 'auto'],
    ['Checker Roles', '260px'],
    ['Timeout', '72px'],
    ['SoD Rule', '220px'],
    ['Status', '100px'],
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <PageTitleBar
        title="SoD Configuration"
        meta={`${activeCount} active · ${totalCount} total · Control Gates Center`}
      >
        <button
          className={adminIconButtonClass()}
          title="Static config — no refresh needed"
          disabled
        >
          <RefreshCw size={14} />
        </button>
      </PageTitleBar>

      {/* ── Info banner ── */}
      <div className="shrink-0 border-b border-adm-border bg-adm-bg/60 px-5 py-2">
        <p className="font-mono text-[10px] text-adm-t3">
          SoD rule{' '}
          <span className="font-semibold text-adm-amber">DENY_SAME_USER_MAKER_CHECKER</span>
          {' '}— the user who initiates a case may not be the same user who approves it.{' '}
          <span className="text-adm-t3">SUPER_ADMIN bypasses SoD (audit metadata includes superAdminBypass=true).</span>
        </p>
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {columns.map(([label, width]) => (
                <th
                  key={label}
                  style={{ width: width === 'auto' ? undefined : width }}
                  className="border-b border-adm-border bg-adm-panel px-4 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SOD_CONFIG.map((entry, idx) => {
              const isFirstOfWave =
                idx === 0 || SOD_CONFIG[idx - 1].wave !== entry.wave;

              return (
                <>
                  {isFirstOfWave && (
                    <tr key={`wave-sep-${entry.wave}`}>
                      <td
                        colSpan={columns.length}
                        className="border-b border-adm-border bg-adm-bg px-4 py-1.5 font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3"
                      >
                        {entry.wave}
                        {entry.wave === 'Wave 5+' && (
                          <span className="ml-2 font-normal normal-case tracking-normal">
                            (pre-registered, not yet active)
                          </span>
                        )}
                      </td>
                    </tr>
                  )}
                  <tr
                    key={entry.actionType}
                    className="border-b border-adm-border transition-colors hover:bg-adm-hover"
                  >
                    {/* Action Type */}
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-[11px] font-semibold text-adm-amber">
                        {entry.actionType}
                      </span>
                      <p className="mt-0.5 font-mono text-[9px] text-adm-t3">
                        {entry.label}
                      </p>
                    </td>

                    {/* Wave */}
                    <td className="px-4 py-2.5">
                      <span
                        className={[
                          'inline-flex items-center rounded border px-2 py-0.5 font-mono text-[9px] font-semibold',
                          waveBadgeClass(entry.wave),
                        ].join(' ')}
                      >
                        {entry.wave}
                      </span>
                    </td>

                    {/* Trigger / Maker */}
                    <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">
                      {entry.trigger}
                    </td>

                    {/* Checker Roles */}
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {entry.checkerRoles.map((role) => (
                          <span
                            key={role}
                            className="inline-flex items-center rounded border border-adm-blue/25 bg-adm-blue/10 px-2 py-0.5 font-mono text-[9px] text-adm-blue"
                          >
                            {role}
                          </span>
                        ))}
                      </div>
                    </td>

                    {/* Timeout */}
                    <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                      {entry.timeoutHours}h
                    </td>

                    {/* SoD Rule */}
                    <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">
                      {entry.sodRule}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-2.5">
                      <AdminBadge
                        value={entry.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING'}
                      />
                    </td>
                  </tr>
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Footer ── */}
      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
        <p className="font-mono text-[10px] text-adm-t3">
          {activeCount} active approval types · {totalCount - activeCount} pre-registered · source:{' '}
          <span className="text-adm-t2">
            DEFAULT_APPROVAL_POLICIES in approval.constants.ts
          </span>
        </p>
      </div>
    </div>
  );
};

export default SodConfigPage;

// src/components/ui/AdminBadge.tsx

type BadgeVariant = 'success' | 'failed' | 'rejected' | 'pending' | 'active' | 'deleted' | 'info';

const STATUS_MAP: Record<string, BadgeVariant> = {
  SUCCESS:          'success',
  DONE:             'success',
  APPROVED:         'success',
  ACTIVE:           'active',
  FAILED:           'failed',
  ERROR:            'failed',
  REJECTED:         'rejected',
  PENDING:          'pending',
  PENDING_APPROVAL: 'pending',
  DRAFT:            'info',
  READY:            'info',
  DELETED:          'deleted',
};

const BADGE_CLS: Record<BadgeVariant, string> = {
  success:  'bg-adm-green/10  text-adm-green  border-adm-green/25',
  failed:   'bg-adm-red/10    text-adm-red    border-adm-red/25',
  rejected: 'bg-adm-amber/10  text-adm-amber  border-adm-amber/25',
  pending:  'bg-adm-blue/10   text-adm-blue   border-adm-blue/25',
  active:   'bg-adm-green/10  text-adm-green  border-adm-green/25',
  deleted:  'bg-adm-red/10    text-adm-red    border-adm-red/25',
  info:     'bg-adm-t3/10     text-adm-t2     border-adm-t3/25',
};

/** Status badge — SUCCESS / FAILED / REJECTED / PENDING / ACTIVE / DELETED / etc. */
export const AdminBadge = ({
  value,
  dot = true,
}: {
  value: string;
  dot?: boolean;
}) => {
  const variant: BadgeVariant = STATUS_MAP[value] ?? 'info';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${BADGE_CLS[variant]}`}
    >
      {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
      {value}
    </span>
  );
};

const TRIGGER_CLS: Record<string, string> = {
  AUTH_EVENT:       'bg-purple-500/10 text-purple-500 border-purple-500/20',
  EVIDENCE_EXPORT:  'bg-sky-500/10    text-sky-500    border-sky-500/20',
  STATE_TRANSITION: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20',
  MANUAL_OVERRIDE:  'bg-orange-500/10 text-orange-500 border-orange-500/20',
  PERMISSION_CHANGE:'bg-violet-500/10 text-violet-500 border-violet-500/20',
  CONFIG_CHANGE:    'bg-teal-500/10   text-teal-500   border-teal-500/20',
};

/** Smaller tag for triggerType values */
export const TriggerTag = ({ value }: { value: string }) => {
  const cls =
    TRIGGER_CLS[value] ?? 'bg-adm-t3/10 text-adm-t3 border-adm-t3/20';
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-px font-mono text-[9px] font-medium ${cls}`}
    >
      {value}
    </span>
  );
};

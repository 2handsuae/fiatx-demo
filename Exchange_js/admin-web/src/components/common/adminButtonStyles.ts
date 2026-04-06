import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export type AdminButtonVariant =
  | 'listPrimary'
  | 'listSecondary'
  | 'rowKeyLink'
  | 'rowLink'
  | 'rowSecondaryUtility'
  | 'detailUtility'
  | 'workflowPrimary'
  | 'workflowSecondary'
  | 'workflowNegative'
  | 'repair'
  | 'simulationAction'
  | 'modalCancel'
  | 'modalConfirm';

const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

const blockBase =
  'inline-flex items-center justify-center gap-1.5 rounded px-3 py-1.5 font-mono text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40';

const variants: Record<AdminButtonVariant, string> = {
  // Amber-filled primary action
  listPrimary: `${blockBase} bg-adm-amber text-white hover:opacity-88 border border-adm-amber`,

  // Ghost secondary
  listSecondary: `${blockBase} border border-adm-border bg-transparent text-adm-t2 hover:border-adm-bhi hover:text-adm-t1 hover:bg-adm-hover`,

  // Amber mono link (audit no, ticket no, etc.)
  rowKeyLink:
    'inline-flex max-w-full items-center gap-1 truncate font-mono text-[11px] font-semibold text-adm-amber transition-colors hover:opacity-75 disabled:pointer-events-none disabled:opacity-40',

  // Standard text link (amber)
  rowLink:
    'inline-flex items-center justify-end font-mono text-[11px] font-medium text-adm-amber transition-colors hover:opacity-75 disabled:pointer-events-none disabled:opacity-40',

  // Muted secondary link
  rowSecondaryUtility:
    'inline-flex items-center justify-end font-mono text-[10px] font-medium text-adm-t3 transition-colors hover:text-adm-t2 disabled:pointer-events-none disabled:opacity-40',

  // Detail page utility ghost button
  detailUtility: `${blockBase} border border-adm-border bg-adm-panel text-adm-t2 hover:border-adm-bhi hover:text-adm-t1 hover:bg-adm-hover`,

  // Workflow actions
  workflowPrimary: `${blockBase} bg-adm-amber text-white hover:opacity-88 border border-adm-amber`,
  workflowSecondary: `${blockBase} border border-adm-border bg-transparent text-adm-t2 hover:border-adm-bhi hover:bg-adm-hover`,

  // Destructive
  workflowNegative:
    `${blockBase} border border-adm-red/35 bg-transparent text-adm-red hover:bg-adm-red/6`,

  // Repair / warning
  repair:
    `${blockBase} border border-adm-amber/35 bg-adm-amber/8 text-adm-amber hover:bg-adm-amber/12`,

  // Simulation
  simulationAction:
    `${blockBase} border border-adm-blue/25 bg-adm-blue/8 text-adm-blue hover:bg-adm-blue/12`,

  // Modal
  modalCancel: `${blockBase} border border-adm-border bg-transparent text-adm-t2 hover:border-adm-bhi hover:bg-adm-hover`,
  modalConfirm: `${blockBase} bg-adm-amber text-white hover:opacity-88 border border-adm-amber`,
};

export const adminButtonClass = (
  variant: AdminButtonVariant,
  className?: ClassValue,
) => cn(variants[variant], className);

export const adminIconButtonClass = (className?: ClassValue) =>
  cn(
    'inline-flex h-8 w-8 items-center justify-center rounded border border-adm-border bg-adm-panel text-adm-t2 transition-colors hover:bg-adm-hover hover:text-adm-t1 disabled:cursor-not-allowed disabled:opacity-40',
    className,
  );

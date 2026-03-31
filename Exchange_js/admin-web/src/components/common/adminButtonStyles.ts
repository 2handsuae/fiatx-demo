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
  'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';

const variants: Record<AdminButtonVariant, string> = {
  listPrimary: `${blockBase} bg-slate-900 text-white shadow-sm hover:bg-slate-800`,
  listSecondary: `${blockBase} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`,
  rowKeyLink:
    'inline-flex max-w-full items-center gap-1 truncate font-mono text-xs font-semibold text-brand-primary transition-colors hover:text-blue-700 hover:underline disabled:pointer-events-none disabled:text-slate-400 disabled:no-underline',
  rowLink:
    'inline-flex items-center justify-end text-sm font-medium text-brand-primary transition-colors hover:text-blue-700 hover:underline disabled:pointer-events-none disabled:text-slate-400 disabled:no-underline',
  rowSecondaryUtility:
    'inline-flex items-center justify-end text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 hover:underline disabled:pointer-events-none disabled:text-slate-400 disabled:no-underline',
  detailUtility: `${blockBase} border border-admin-border bg-white text-gray-700 hover:bg-gray-50`,
  workflowPrimary: `${blockBase} bg-slate-900 text-white shadow-sm hover:bg-slate-800`,
  workflowSecondary: `${blockBase} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`,
  workflowNegative:
    `${blockBase} border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100`,
  repair:
    `${blockBase} border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100`,
  simulationAction:
    `${blockBase} border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100`,
  modalCancel: `${blockBase} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`,
  modalConfirm: `${blockBase} bg-slate-900 text-white shadow-sm hover:bg-slate-800`,
};

export const adminButtonClass = (
  variant: AdminButtonVariant,
  className?: ClassValue,
) => cn(variants[variant], className);

export const adminIconButtonClass = (className?: ClassValue) =>
  cn(
    'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-brand-primary disabled:cursor-not-allowed disabled:opacity-50',
    className,
  );

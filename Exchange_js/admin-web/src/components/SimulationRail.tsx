import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export interface SimulationRailItem {
  id: string;
  label: string;
  icon: ReactNode;
  state?: 'completed' | 'current' | 'available' | 'readonly';
  tone?: 'default' | 'success' | 'warning' | 'danger';
  onClick?: () => void;
  disabled?: boolean;
  helperText?: string;
}

const stateStyles: Record<NonNullable<SimulationRailItem['state']>, string> = {
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  current: 'border-blue-200 bg-blue-50 text-blue-700 shadow-sm',
  available: 'border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:text-blue-700',
  readonly: 'border-slate-200 bg-slate-50 text-slate-500',
};

const toneStyles: Record<NonNullable<SimulationRailItem['tone']>, string> = {
  default: '',
  success: 'text-emerald-700',
  warning: 'text-amber-700',
  danger: 'text-rose-700',
};

export const SimulationRail = ({
  title,
  description,
  items,
}: {
  title: string;
  description?: string;
  items: SimulationRailItem[];
}) => (
  <section className="bg-white border border-admin-border rounded-xl p-4 space-y-4">
    <div className="space-y-1">
      <div className="text-sm font-semibold text-gray-900">{title}</div>
      {description ? <p className="text-xs text-gray-500">{description}</p> : null}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      {items.map((item, index) => {
        const baseState = stateStyles[item.state || 'readonly'];
        const tone = toneStyles[item.tone || 'default'];
        const className = [
          'min-w-[110px] rounded-xl border px-3 py-2 text-left transition-colors',
          baseState,
          tone,
          item.onClick && !item.disabled ? 'cursor-pointer' : 'cursor-default',
          item.disabled ? 'opacity-50' : '',
        ]
          .filter(Boolean)
          .join(' ');

        const content = (
          <>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </div>
            {item.helperText ? (
              <div className="mt-2 text-[11px] leading-4 text-current/80">
                {item.helperText}
              </div>
            ) : null}
          </>
        );

        return (
          <div key={item.id} className="flex items-center gap-2">
            {item.onClick ? (
              <button
                type="button"
                onClick={item.onClick}
                disabled={item.disabled}
                className={className}
              >
                {content}
              </button>
            ) : (
              <div className={className}>{content}</div>
            )}
            {index < items.length - 1 ? (
              <ChevronRight size={14} className="text-slate-300" />
            ) : null}
          </div>
        );
      })}
    </div>
  </section>
);

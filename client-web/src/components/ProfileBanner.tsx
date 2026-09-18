import { useNavigate } from 'react-router-dom';
import { AlertTriangle, AlertCircle, Info, ExternalLink } from 'lucide-react';

/* ────────────────────────────────────────────────────────────────
 *  ProfileBanner — severity-keyed compliance notice strip.
 *  Three variants: INFO (brass), WARNING (copper), BLOCKING (rust).
 *  Left-border-4 design with icon + title + description + optional CTA.
 * ──────────────────────────────────────────────────────────────── */

export type BannerSeverity = 'INFO' | 'WARNING' | 'BLOCKING';

export interface ProfileBannerData {
  id: string;
  severity: BannerSeverity;
  title: string;
  description: string;
  ctaLabel?: string | null;
  ctaPath?: string | null;
}

interface ProfileBannerProps {
  banner: ProfileBannerData;
}

const SEVERITY_STYLES: Record<
  BannerSeverity,
  { border: string; icon: string; bg: string; titleCls: string }
> = {
  INFO: {
    border: 'border-l-fx-brass',
    icon: 'text-fx-brass',
    bg: 'bg-fx-brass/[0.03]',
    titleCls: 'text-fx-brass',
  },
  WARNING: {
    border: 'border-l-fx-copper',
    icon: 'text-fx-copper',
    bg: 'bg-fx-copper/[0.03]',
    titleCls: 'text-fx-copper',
  },
  BLOCKING: {
    border: 'border-l-fx-rust',
    icon: 'text-fx-rust',
    bg: 'bg-fx-rust/[0.03]',
    titleCls: 'text-fx-rust',
  },
};

function SeverityIcon({ severity, className }: { severity: BannerSeverity; className?: string }) {
  if (severity === 'BLOCKING') return <AlertTriangle size={14} className={className} />;
  if (severity === 'WARNING') return <AlertCircle size={14} className={className} />;
  return <Info size={14} className={className} />;
}

export function ProfileBanner({ banner }: ProfileBannerProps) {
  const navigate = useNavigate();
  const s = SEVERITY_STYLES[banner.severity] ?? SEVERITY_STYLES.INFO;

  return (
    <div
      className={`border-l-4 ${s.border} ${s.bg} px-4 py-3 flex items-start justify-between gap-4`}
    >
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <div className={`shrink-0 mt-[1px] ${s.icon}`}>
          <SeverityIcon severity={banner.severity} />
        </div>
        <div className="min-w-0">
          <div
            className={`font-mono text-[9px] uppercase tracking-[0.18em] mb-1 ${s.titleCls}`}
          >
            {banner.title}
          </div>
          <p className="font-sans text-[12px] text-fx-dune leading-snug">
            {banner.description}
          </p>
        </div>
      </div>

      {banner.ctaLabel && banner.ctaPath && (
        <button
          onClick={() => navigate(banner.ctaPath!)}
          className="shrink-0 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-fx-brass hover:text-fx-ember transition-colors"
        >
          {banner.ctaLabel}
          <ExternalLink size={10} />
        </button>
      )}
    </div>
  );
}

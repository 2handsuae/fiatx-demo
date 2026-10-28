// admin-web/src/components/ui/PartnerStatusPill.tsx
// 甲波六 T5：LP / 服务商状态徽章——词与色全部来自 partnerStatusMap，页面不自己拼 className。
import { partnerStatusMeta } from '../../utils/partnerStatusMap';

export const PartnerStatusPill = ({
  status,
  size = 'sm',
}: {
  status: string | null | undefined;
  size?: 'sm' | 'md';
}) => {
  if (!status) return <span className="text-adm-t3">—</span>;
  const { label, badgeClass } = partnerStatusMeta(status);
  const sizeCls = size === 'md' ? 'px-3 py-0.5 text-xs font-medium' : 'px-2.5 py-0.5 text-[10px] font-semibold';
  return <span className={`inline-flex items-center rounded-full ${sizeCls} ${badgeClass}`}>{label}</span>;
};

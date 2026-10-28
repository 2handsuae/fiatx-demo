// admin-web/src/components/ui/PartnerStatusPill.tsx
// 甲波六 T5：LP / 服务商状态徽章——词与色全部来自 partnerStatusMap，页面不自己拼 className。
// T8：同文件加服务商「重大性」徽章（Material / Non-material），列表与详情同源。
import { VENDOR_CRITICALITY_META, humanizeCode, partnerStatusMeta } from '../../utils/partnerStatusMap';

type PillSize = 'sm' | 'md';

const sizeClass = (size: PillSize) =>
  size === 'md' ? 'px-3 py-0.5 text-xs font-medium' : 'px-2.5 py-0.5 text-[10px] font-semibold';

export const PartnerStatusPill = ({
  status,
  size = 'sm',
}: {
  status: string | null | undefined;
  size?: PillSize;
}) => {
  if (!status) return <span className="text-adm-t3">—</span>;
  const { label, badgeClass } = partnerStatusMeta(status);
  return <span className={`inline-flex items-center rounded-full ${sizeClass(size)} ${badgeClass}`}>{label}</span>;
};

export const MaterialityPill = ({
  criticality,
  size = 'sm',
}: {
  criticality: string | null | undefined;
  size?: PillSize;
}) => {
  if (!criticality) return <span className="text-adm-t3">—</span>;
  const meta = VENDOR_CRITICALITY_META[criticality] ?? { label: humanizeCode(criticality), badgeClass: 'bg-gray-100 text-gray-800' };
  return <span className={`inline-flex items-center rounded-full ${sizeClass(size)} ${meta.badgeClass}`}>{meta.label}</span>;
};

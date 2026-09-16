import { useNavigate } from 'react-router-dom';
import { ScrollText } from 'lucide-react';
import { adminButtonClass } from './adminButtonStyles';

/** 实体详情页 → 审计页深链（第七幕波三，判据3：零人肉抄号切页）。
 *  params 直接拼进审计列表页 URL 契约（AuditLogsPage 进页自动查询）。 */
export const ViewAuditTrailButton = ({ params }: { params: Record<string, string> }) => {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(`/admin/audit/logs?${new URLSearchParams(params).toString()}`)}
      className={adminButtonClass('detailUtility')}
    >
      <ScrollText size={13} />
      View audit trail
    </button>
  );
};

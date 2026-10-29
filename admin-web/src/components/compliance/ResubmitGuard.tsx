// admin-web/src/components/compliance/ResubmitGuard.tsx
// 甲波六 T8：LP / 服务商申请页共用——重提只对「已退回」态开放（后端同样拒）；其他状态给一句说明和回路。
import { PageTitleBar } from '../ui/PageTitleBar';
import { PartnerStatusPill } from '../ui/PartnerStatusPill';
import { adminButtonClass } from '../common/adminButtonStyles';

export const ResubmitGuard = ({
  title,
  subtitle,
  status,
  error,
  onBack,
}: {
  title: string;
  subtitle: string | undefined;
  /** 申请当前的状态（取不到时为 null）。 */
  status: string | null;
  /** 预填取数失败的后端文案；有它就只显示它。 */
  error: string;
  onBack: () => void;
}) => (
  <div className="flex h-full flex-col">
    <PageTitleBar title={title} subtitle={subtitle}>
      <button type="button" onClick={onBack} className={adminButtonClass('listSecondary')}>Back</button>
    </PageTitleBar>
    <div className="p-6 text-sm text-adm-t2">
      {error || (
        <span className="inline-flex items-center gap-2">
          Only an application that was returned for documents can be edited and resubmitted. Current status:
          <PartnerStatusPill status={status} />
        </span>
      )}
    </div>
  </div>
);

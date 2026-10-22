// admin-web/src/components/compliance/VaspProfileFields.tsx
//
// 对手方 VASP 名录档案三行（EEC 状态 / 风险评分 / 牌照）——充值与提现两域详情页共用。
// 档案是 Sumsub 侧数据，后端 findOneForAdmin 按单上 counterpartyVaspDid 现拼成 `vaspProfile`，
// 不落库；名录里查无或没有对手方 VASP 时为 null，调用方不渲染本组。
import { InfoField, InfoSlot } from './DetailPageComponents';
import { AdminBadge } from '../ui/AdminBadge';

export interface VaspProfile {
  name: string;
  eecStatus: 'COMPLETED' | 'PENDING';
  riskScore: number;
  licensed: boolean;
}

/** ⚡V12「对手方 VASP 不合格」把单子带进人工复核台时落的 `manualReason` 原码（后端小写字面量）。 */
export const VASP_UNQUALIFIED_REASON = 'vasp_unqualified';

/** 复核态单子的「不合格依据」——白话标签，不显示原始码。 */
export const VaspUnqualifiedBasis = () => (
  <InfoSlot label="Review Basis">
    <AdminBadge value="Counterparty VASP unqualified" variant="failed" />
  </InfoSlot>
);

export const VaspProfileFields = ({ profile }: { profile: VaspProfile }) => (
  <>
    <InfoSlot label="VASP EEC Status">
      <AdminBadge
        value={profile.eecStatus}
        variant={profile.eecStatus === 'COMPLETED' ? 'success' : 'pending'}
      />
    </InfoSlot>
    <InfoField label="VASP Risk Score" value={profile.riskScore} mono />
    <InfoSlot label="VASP Licence">
      <AdminBadge
        value={profile.licensed ? 'LICENSED' : 'UNLICENSED'}
        variant={profile.licensed ? 'success' : 'rejected'}
      />
    </InfoSlot>
  </>
);

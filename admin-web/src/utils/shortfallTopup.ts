// admin-web/src/utils/shortfallTopup.ts
// 戊波二 T8：认损补缺（划转单用途 SHORTFALL_TOPUP）在管理台的两处纯展示逻辑——
//   1. 案件页差异行 Status 标签：按行上回挂的划转单 { status, recognized } 打四态（spec §4.1「处置记录」）。
//      唯一真相在后端（reconciliation.dto.ts 的 transfer.recognized = 批准那一步已记短缺）；这里只是展示词。
//   2. 弹层「Top up from」下拉的候选钱包：GET /admin/tb/accounts?ownerType=WALLET&code=50 的行里只留
//      运营户 F_OPS 与手续费户 F_FEE（与付款单 Pay From、公司调拨单 From/To 同数据源同选项形状），运营户排前做默认。
import { INTERNAL_TRANSFER_STATUS_LABEL } from './internalTransferStatusMap';

export interface ShortfallTransferRef {
  transferNo: string;
  status: string;
  recognized: boolean;
}

export type ShortfallChipTone = 'blue' | 'amber' | 'green' | 'red' | 'gray';

export interface ShortfallChip {
  tone: ShortfallChipTone;
  label: string;
  check?: boolean;
}

/** 行 Status 标签：认损补缺单的四态。FAILED 且 recognized = 短缺已记在账上、补款腿失败——入口不回来（裁定 15）。 */
export const shortfallTopupChip = (t: ShortfallTransferRef): ShortfallChip => {
  switch (t.status) {
    case 'PENDING_APPROVAL':
      return { tone: 'blue', label: `Pending CFO · ${t.transferNo}` };
    case 'EXECUTING':
      return { tone: 'amber', label: `Shortfall recognised · topping up ${t.transferNo}` };
    case 'SUCCESS':
      return { tone: 'green', label: `Explained · ${t.transferNo}`, check: true };
    case 'FAILED':
      if (t.recognized) return { tone: 'red', label: `Shortfall recognised · top-up failed ${t.transferNo}` };
      break;
    default:
      break;
  }
  // 其余状态（驳回 / 撤回 / 记短缺失败）后端已把行解锁、不再回挂；兜底只为不让未知态裸奔。
  return { tone: 'gray', label: `${INTERNAL_TRANSFER_STATUS_LABEL[t.status] ?? t.status} · ${t.transferNo}` };
};

/** 事故页「Recognize loss & top up」入口的显示条件（纯函数，页面只传事实）。
 *  入口只是导航：案件页要找到 `disposition.incidentNo === 事故号` 的那一行才会自动开弹层，而这个值只有登记事故时带了
 *  sourceDispositionNo（挂接定性行，后端 attachIncident）才会写上——所以「有行锚」是必要条件：
 *  案件页菜单「Register shortfall」登记的 CLIENT_SHORTFALL 事故不带它，即使定损为 FIRM_LOSS 也不该给一个点了没反应的按钮。
 *  customerNo 是客户池判别（公司池事故没有客户）；已挂 TRANSFER 善后说明这张单已经在了，按钮收敛。 */
export interface IncidentShortfallEntryFacts {
  canTopUp: boolean; // 金库划转写权（真正提交的是那个端点）
  status: string;
  assessmentBasis: string | null;
  sourceCaseNo: string | null;
  sourceDispositionNo: string | null;
  customerNo: string | null;
  hasTransferRemediation: boolean;
}

export const canRecognizeLossAndTopUpFromIncident = (f: IncidentShortfallEntryFacts): boolean =>
  f.canTopUp
  && (f.status === 'ASSESSED' || f.status === 'RESOLVING')
  && f.assessmentBasis === 'FIRM_LOSS'
  && !!f.sourceCaseNo && !!f.sourceDispositionNo && !!f.customerNo
  && !f.hasTransferRemediation;

/** `GET /admin/tb/accounts?ownerType=WALLET&code=50` 的行（公司现金户）：ownerUuid = 钱包 id（提交用，页面不渲染，铁律⑥），
 *  walletNo / walletRole / balance（最小单位）显示用。 */
export interface FromWalletOption {
  ownerUuid: string;
  walletNo: string;
  walletRole: string;
  balance: string;
}

/** 认损补缺只能从运营户或手续费户出（结算户的钱正往客户走、LP 前厅的钱还没验收）；运营户排前、做默认。 */
export const SHORTFALL_FROM_ROLES = ['F_OPS', 'F_FEE'];

export const pickFromWallets = (rows: FromWalletOption[]): FromWalletOption[] =>
  rows
    .filter((r) => SHORTFALL_FROM_ROLES.includes(r.walletRole) && !!r.ownerUuid)
    .sort((a, b) => SHORTFALL_FROM_ROLES.indexOf(a.walletRole) - SHORTFALL_FROM_ROLES.indexOf(b.walletRole));

/** 默认选中：运营户；没有运营户行则不替人选。 */
export const defaultFromWalletId = (options: FromWalletOption[]): string =>
  options.find((r) => r.walletRole === 'F_OPS')?.ownerUuid ?? '';

import { ConflictException } from '@nestjs/common';

/** 六态（LP 两步准入 spec §3.2）：出生即待批（RED 登记即拒除外，见下）；REJECTED / CANCELLED / DEACTIVATED 是终态。 */
export enum LpPayoutAddressStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DEACTIVATED = 'DEACTIVATED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export enum LpPayoutAddressAction {
  APPROVE = 'APPROVE',       // CFO 批准
  REJECT = 'REJECT',         // CFO 拒绝 / 待批时 ⚡喂 RED
  CANCEL = 'CANCEL',         // 金库在待批时撤回
  SUSPEND = 'SUSPEND',       // 金库收紧（留痕不批）
  REACTIVATE = 'REACTIVATE', // 金库放松（留痕不批）
  DEACTIVATE = 'DEACTIVATE', // 金库永久退役（换地址 = 登新生效后停旧）
}

const S = LpPayoutAddressStatus;
const A = LpPayoutAddressAction;

/**
 * LP 打款地址状态迁移表：6 态 / 6 边 / 6 动作。
 * 「RED 登记即拒」是登记时的落点计算（直接插成 REJECTED），不是边——同客户提现地址簿尾号 3333 先例；
 * 所以 REJECTED 只有「待批时被拒」这一条入边，出边为空（不可复活，要换坐标就是新登记）。
 */
export const LP_PAYOUT_ADDRESS_TRANSITIONS: Record<string, Partial<Record<LpPayoutAddressAction, string>>> = {
  [S.PENDING_APPROVAL]: { [A.APPROVE]: S.ACTIVE, [A.REJECT]: S.REJECTED, [A.CANCEL]: S.CANCELLED },
  [S.ACTIVE]: { [A.SUSPEND]: S.SUSPENDED, [A.DEACTIVATE]: S.DEACTIVATED },
  [S.SUSPENDED]: { [A.REACTIVATE]: S.ACTIVE },
  [S.DEACTIVATED]: {},
  [S.REJECTED]: {},
  [S.CANCELLED]: {},
};

/** 终态 = 迁移表里没有出边的态（单一来源：重复登记守卫据此判「非终态」，不另抄一份名单）。 */
export const LP_PAYOUT_ADDRESS_TERMINAL_STATUSES: readonly string[] = Object.keys(LP_PAYOUT_ADDRESS_TRANSITIONS)
  .filter((s) => Object.keys(LP_PAYOUT_ADDRESS_TRANSITIONS[s]).length === 0);

export function assertLpPayoutAddressTransition(from: string, action: LpPayoutAddressAction): string {
  const to = LP_PAYOUT_ADDRESS_TRANSITIONS[from]?.[action];
  if (!to) throw new ConflictException(`Invalid transition: LP payout address in ${from} cannot ${action}`);
  return to;
}

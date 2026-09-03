import { ConflictException } from '@nestjs/common';

export enum WithdrawalAddressAction {
  ACTIVATE = 'ACTIVATE',     // 冷却到期扫描 / 查询前懒激活 / 管理员跳过冷却（⚡）
  CANCEL = 'CANCEL',         // 客户在冷却期内取消
  SUSPEND = 'SUSPEND',       // 管理员强制暂停
  UNSUSPEND = 'UNSUSPEND',   // 管理员恢复（D5 补的出边）
  DEACTIVATE = 'DEACTIVATE', // 客户自助停用
}

/** 提现地址状态迁移表（法二，spec §5）。CANCELLED / DEACTIVATED 是终态。 */
export const WITHDRAWAL_ADDRESS_TRANSITIONS: Record<string, Partial<Record<WithdrawalAddressAction, string>>> = {
  PENDING_ACTIVATION: { [WithdrawalAddressAction.ACTIVATE]: 'ACTIVE', [WithdrawalAddressAction.CANCEL]: 'CANCELLED' },
  ACTIVE:             { [WithdrawalAddressAction.SUSPEND]: 'SUSPENDED', [WithdrawalAddressAction.DEACTIVATE]: 'DEACTIVATED' },
  SUSPENDED:          { [WithdrawalAddressAction.UNSUSPEND]: 'ACTIVE' },
  CANCELLED:          {},
  DEACTIVATED:        {},
};

export function assertWithdrawalAddressTransition(from: string, action: WithdrawalAddressAction): string {
  const to = WITHDRAWAL_ADDRESS_TRANSITIONS[from]?.[action];
  if (!to) throw new ConflictException(`Invalid transition: withdrawal address in ${from} cannot ${action}`);
  return to;
}

import { ConflictException } from '@nestjs/common';

export enum UserStatusAction {
  INVITE_APPROVE = 'INVITE_APPROVE',
  ACCEPT = 'ACCEPT',
  SUSPEND = 'SUSPEND',
  REACTIVATE = 'REACTIVATE',
  LOCK = 'LOCK',
  UNLOCK = 'UNLOCK',
}
export enum FirstLoginAction { CONFIRM = 'CONFIRM', BIND = 'BIND', RESET = 'RESET' }

/**
 * 管理员状态迁移表(2026-09-01 法二)。此前 updateStatus 收任意目标态零校验,
 * 合法性全靠调用方自律(铁律④要求显式表+非法拒绝)。
 * INACTIVE 全仓零写入方,不进表、随重铺自然消亡。邀请被拒=物理删除,无状态边。
 */
export const USER_STATUS_TRANSITIONS: Record<string, Partial<Record<UserStatusAction, string>>> = {
  PENDING_INVITE_APPROVAL: { [UserStatusAction.INVITE_APPROVE]: 'INVITE_SENT' },
  INVITE_SENT:             { [UserStatusAction.ACCEPT]: 'ACTIVE' },
  ACTIVE:                  { [UserStatusAction.SUSPEND]: 'SUSPENDED', [UserStatusAction.LOCK]: 'LOCKED' },
  SUSPENDED:               { [UserStatusAction.REACTIVATE]: 'ACTIVE' },
  LOCKED:                  { [UserStatusAction.UNLOCK]: 'ACTIVE' },
};
export const FIRST_LOGIN_TRANSITIONS: Record<string, Partial<Record<FirstLoginAction, string>>> = {
  PENDING_IDENTITY_CONFIRM: { [FirstLoginAction.CONFIRM]: 'MFA_BINDING' },
  MFA_BINDING:              { [FirstLoginAction.BIND]: 'COMPLETED' },
  COMPLETED:                { [FirstLoginAction.RESET]: 'PENDING_IDENTITY_CONFIRM' },
};

export function assertUserTransition(from: string, action: UserStatusAction): string {
  const to = USER_STATUS_TRANSITIONS[from]?.[action];
  if (!to) throw new ConflictException(`Invalid transition: user in ${from} cannot ${action}`);
  return to;
}
export function assertFirstLoginTransition(from: string, action: FirstLoginAction): string {
  const to = FIRST_LOGIN_TRANSITIONS[from]?.[action];
  if (!to) throw new ConflictException(`Invalid transition: firstLogin in ${from} cannot ${action}`);
  return to;
}

import { ConflictException } from '@nestjs/common';

export enum RoleRequestAction {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  CANCEL = 'CANCEL',
  EXPIRE = 'EXPIRE',
  FAIL = 'FAIL',
}

/**
 * 角色申请单迁移表(2026-09-01 法二)。三张申请单(角色定义创建/修改、管理员角色绑定变更)
 * 共用同一套终态语义。此前 modify 流的 executeCancellation 拿审批 handler 从不会发的
 * 'REJECTED' 字面量去比对 decision(实际只会是 'DECLINED'/'CANCELLED'/'EXPIRED'),
 * 导致 REJECTED 态从建成起不可达——三个原因全落 CANCELLED 一个桶;落地失败又借用
 * APPROVED+failureReason 表达"失败",与"真通过"同态无法区分。铁律④要求显式表+
 * 非法跃迁拒绝,不许绕表直写。
 */
export const ROLE_REQUEST_TRANSITIONS: Record<string, Partial<Record<RoleRequestAction, string>>> = {
  PENDING_APPROVAL: {
    [RoleRequestAction.APPROVE]: 'APPROVED',
    [RoleRequestAction.REJECT]: 'REJECTED',
    [RoleRequestAction.CANCEL]: 'CANCELLED',
    [RoleRequestAction.EXPIRE]: 'EXPIRED',
    [RoleRequestAction.FAIL]: 'FAILED',
  },
};

export function assertRoleRequestTransition(from: string, action: RoleRequestAction): string {
  const to = ROLE_REQUEST_TRANSITIONS[from]?.[action];
  if (!to) throw new ConflictException(`Invalid transition: request in ${from} cannot ${action}`);
  return to;
}

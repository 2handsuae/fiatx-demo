import { BadRequestException } from '@nestjs/common';

/**
 * 客户关系生命周期 —— 唯一一根状态轴。
 *
 * 取代 CustomerMain 上原来的三根轴：onboardingStatus（准入旅程）、adminStatus（行政）、
 * complianceStatus（合规冻结）。前两根是同一件事的两种写法，第三根是「摁住客户」——
 * 摁住不是状态，是限制账（customer_restrictions）上的一行，不占轴上的位置。
 *
 * 设计稿：doc-final/superpowers/specs/2026-08-15-customer-lifecycle-restrictions-design.md §3.1
 */
export type CustomerLifecycle =
  | 'PROSPECT' // 已注册，未开始认证
  | 'IN_VERIFICATION' // 认证进行中
  | 'PENDING_APPROVAL' // 材料齐备，等 MLRO 终审
  | 'ACTIVE' // 正式客户
  | 'REJECTED' // 未通过（可重新申请，非终态）
  | 'WITHDRAWN' // 客户主动撤回（可重新申请，非终态）
  | 'OFFBOARDED'; // 关系已终止（终态，零出边）

export type CustomerLifecycleAction =
  | 'START_VERIFICATION'
  | 'VERIFICATION_PASSED'
  | 'VERIFICATION_REJECTED'
  | 'WITHDRAW_APPLICATION'
  | 'CDD_CLEARED'
  | 'FINAL_APPROVED'
  | 'FINAL_REJECTED'
  | 'REAPPLY'
  | 'OFFBOARD';

/**
 * 迁移表 —— 10 条边（波二 +CDD_CLEARED：低风险直通，Sumsub GREEN 即终点；
 * EDD 路径仍走 VERIFICATION_PASSED → FINAL_APPROVED 两段），唯一真相源。
 *
 * INV-1：ACTIVE 的唯一出口是 OFFBOARDED。表里不存在 ACTIVE → REJECTED|WITHDRAWN 的边。
 * 「Sumsub 复评判拒 / 升级审批被拒 / 客户长期不补材料」都不是关系终止，一律落到限制账上，
 * 不许把 ACTIVE 客户退回申请态。要真正终止关系必须走销户（OFFBOARD，本轮只留边不实现流程）。
 */
export const CUSTOMER_LIFECYCLE_TRANSITIONS: Record<
  CustomerLifecycle,
  Partial<Record<CustomerLifecycleAction, CustomerLifecycle>>
> = {
  PROSPECT: {
    START_VERIFICATION: 'IN_VERIFICATION',
  },
  IN_VERIFICATION: {
    VERIFICATION_PASSED: 'PENDING_APPROVAL',
    VERIFICATION_REJECTED: 'REJECTED',
    WITHDRAW_APPLICATION: 'WITHDRAWN',
    CDD_CLEARED: 'ACTIVE',
  },
  PENDING_APPROVAL: {
    FINAL_APPROVED: 'ACTIVE',
    FINAL_REJECTED: 'REJECTED',
  },
  ACTIVE: {
    OFFBOARD: 'OFFBOARDED',
  },
  REJECTED: {
    REAPPLY: 'IN_VERIFICATION',
  },
  WITHDRAWN: {
    REAPPLY: 'IN_VERIFICATION',
  },
  OFFBOARDED: {},
};

/** 终态集合。REJECTED / WITHDRAWN 不在内——他们要能重新申请。 */
export const CUSTOMER_LIFECYCLE_TERMINAL: ReadonlySet<CustomerLifecycle> =
  new Set<CustomerLifecycle>(['OFFBOARDED']);

/** 迁移表的唯一执行入口。非法边一律抛，不返回 null、不静默留在原态。 */
export function nextLifecycle(
  from: CustomerLifecycle,
  action: CustomerLifecycleAction,
): CustomerLifecycle {
  const to = CUSTOMER_LIFECYCLE_TRANSITIONS[from][action];
  if (!to) {
    throw new BadRequestException(`Invalid lifecycle action ${action} from ${from}`);
  }
  return to;
}

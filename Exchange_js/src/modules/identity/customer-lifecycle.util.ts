import { BadRequestException } from '@nestjs/common';
import {
  nextLifecycle,
  type CustomerLifecycle,
  type CustomerLifecycleAction,
} from './constants/customer-lifecycle.constant';

export type CustomerNextStepActionType =
  | 'START_VERIFICATION'
  | 'CONTINUE_VERIFICATION'
  | 'WAIT_VERIFICATION'
  | 'WAIT_FINAL_APPROVAL'
  | 'REINITIATE_VERIFICATION'
  | 'NONE';

export type CustomerReviewStage = 'REVIEW_CDD' | 'REVIEW_EDD';

export interface CustomerLifecycleSource {
  lifecycle?: string | null;
  verificationCanContinue?: boolean | null;
  eddRequired?: boolean | null;
  cddDocumentExpiresAt?: Date | string | null;
}

const CUSTOMER_LIFECYCLE_VALUES = [
  'PROSPECT',
  'IN_VERIFICATION',
  'PENDING_APPROVAL',
  'ACTIVE',
  'REJECTED',
  'WITHDRAWN',
  'OFFBOARDED',
] as const satisfies readonly CustomerLifecycle[];

/**
 * 九边迁移表的右列去重：每个动作恰有一个目标态（REJECTED 有两条入边
 * VERIFICATION_REJECTED / FINAL_REJECTED，但每个动作各自只指向一个态）。
 * 与 nextLifecycle 的一致性由 customer-lifecycle.util.spec.ts 逐边断言，
 * 表漂移会立刻红。用途只有一个：判断"已在目标态"的幂等重放。
 */
const LIFECYCLE_ACTION_TARGET: Record<CustomerLifecycleAction, CustomerLifecycle> = {
  START_VERIFICATION: 'IN_VERIFICATION',
  VERIFICATION_PASSED: 'PENDING_APPROVAL',
  VERIFICATION_REJECTED: 'REJECTED',
  WITHDRAW_APPLICATION: 'WITHDRAWN',
  FINAL_APPROVED: 'ACTIVE',
  FINAL_REJECTED: 'REJECTED',
  REAPPLY: 'IN_VERIFICATION',
  OFFBOARD: 'OFFBOARDED',
};

export function isCustomerLifecycle(value: unknown): value is CustomerLifecycle {
  return (CUSTOMER_LIFECYCLE_VALUES as readonly string[]).includes(String(value));
}

/** 把 Prisma 的 string 列收窄成 CustomerLifecycle；未知值 fail-closed。 */
export function readLifecycle(source: CustomerLifecycleSource): CustomerLifecycle {
  const raw = String(source.lifecycle ?? '').trim().toUpperCase();
  if (!isCustomerLifecycle(raw)) {
    throw new BadRequestException(`Unknown customer lifecycle ${raw || '(empty)'}`);
  }
  return raw;
}

/**
 * 唯一的边校验入口。
 * - 当前态已等于该动作的目标态 → 返回 null（幂等重放，比如 Sumsub 连发两条
 *   applicantPending），调用方不写 lifecycle
 * - 其余一律交给 nextLifecycle，非法边抛 BadRequestException
 */
export function resolveLifecycleTransition(
  from: CustomerLifecycle,
  action: CustomerLifecycleAction,
): CustomerLifecycle | null {
  if (from === LIFECYCLE_ACTION_TARGET[action]) {
    return null;
  }
  return nextLifecycle(from, action);
}

export function buildLifecycleTransitionPatch(
  from: CustomerLifecycle,
  action: CustomerLifecycleAction,
): { lifecycle?: CustomerLifecycle } {
  const to = resolveLifecycleTransition(from, action);
  return to ? { lifecycle: to } : {};
}

function isExpiredCdd(source: CustomerLifecycleSource): boolean {
  if (!source.cddDocumentExpiresAt) {
    return false;
  }

  const expiresAt =
    source.cddDocumentExpiresAt instanceof Date
      ? source.cddDocumentExpiresAt
      : new Date(source.cddDocumentExpiresAt);

  return !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= Date.now();
}

export function getCustomerNextStepActionTypes(
  source: CustomerLifecycleSource,
): CustomerNextStepActionType[] {
  switch (readLifecycle(source)) {
    case 'PROSPECT':
      return ['START_VERIFICATION'];
    case 'IN_VERIFICATION':
      return source.verificationCanContinue ? ['CONTINUE_VERIFICATION'] : ['WAIT_VERIFICATION'];
    case 'PENDING_APPROVAL':
      return ['WAIT_FINAL_APPROVAL'];
    case 'ACTIVE':
      return ['NONE'];
    case 'REJECTED':
    case 'WITHDRAWN':
      return ['REINITIATE_VERIFICATION'];
    case 'OFFBOARDED':
      return ['NONE'];
  }
}

export function getCustomerBlockedReason(source: CustomerLifecycleSource): string | null {
  switch (readLifecycle(source)) {
    case 'PROSPECT':
    case 'IN_VERIFICATION':
      return null;
    case 'PENDING_APPROVAL':
      return 'Waiting final onboarding decision.';
    case 'ACTIVE':
      return 'Onboarding completed.';
    case 'REJECTED':
      return 'Onboarding is rejected. Re-initiate required.';
    case 'WITHDRAWN':
      return 'Onboarding is withdrawn.';
    case 'OFFBOARDED':
      return 'Customer relationship is closed.';
  }
}

export function canStartCdd(source: CustomerLifecycleSource): boolean {
  return readLifecycle(source) === 'PROSPECT';
}

export function canReinitiateCdd(source: CustomerLifecycleSource): boolean {
  const lifecycle = readLifecycle(source);
  return lifecycle === 'REJECTED' || lifecycle === 'WITHDRAWN' || isExpiredCdd(source);
}

/** EDD 是认证流程内的加深环节：认证在途 + 已判定需要 EDD。 */
export function canStartEdd(source: CustomerLifecycleSource): boolean {
  return readLifecycle(source) === 'IN_VERIFICATION' && Boolean(source.eddRequired);
}

/** 材料已齐、等终审期间，MLRO 可以要求重跑 EDD。 */
export function canReinitiateEdd(source: CustomerLifecycleSource): boolean {
  return readLifecycle(source) === 'PENDING_APPROVAL' && Boolean(source.eddRequired);
}

export function getExpectedReviewStageFromCustomerState(
  source: CustomerLifecycleSource,
): CustomerReviewStage | null {
  if (readLifecycle(source) !== 'IN_VERIFICATION') {
    return null;
  }
  return source.eddRequired ? 'REVIEW_EDD' : 'REVIEW_CDD';
}

export function canFinalReview(source: CustomerLifecycleSource): boolean {
  return readLifecycle(source) === 'PENDING_APPROVAL';
}

export function isCustomerApprovedAndActive(source: CustomerLifecycleSource): boolean {
  return readLifecycle(source) === 'ACTIVE';
}

/**
 * 客户生命周期读取器 —— 唯一状态轴是 lifecycle
 * （后端 src/modules/identity/constants/customer-lifecycle.constant.ts）。
 * 旧的 onboardingStatus + adminStatus 双轴已删；"被合规摁住"不在这根轴上，
 * 走限制便签（见 restrictedCapabilities.ts）。
 */
export type CustomerLifecycle =
  | 'PROSPECT'
  | 'IN_VERIFICATION'
  | 'PENDING_APPROVAL'
  | 'ACTIVE'
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'OFFBOARDED';

export interface CustomerLifecycleSnapshot {
  lifecycle?: string | null;
}

const CUSTOMER_LIFECYCLES: CustomerLifecycle[] = [
  'PROSPECT',
  'IN_VERIFICATION',
  'PENDING_APPROVAL',
  'ACTIVE',
  'REJECTED',
  'WITHDRAWN',
  'OFFBOARDED',
];

export const normalizeLifecycle = (value?: string | null): CustomerLifecycle | null => {
  const current = String(value || '').trim().toUpperCase();
  if (CUSTOMER_LIFECYCLES.includes(current as CustomerLifecycle)) {
    return current as CustomerLifecycle;
  }
  return null;
};

export const isCustomerApprovedForAccess = (source: CustomerLifecycleSnapshot): boolean =>
  normalizeLifecycle(source.lifecycle) === 'ACTIVE';

export const isCustomerRejected = (source: CustomerLifecycleSnapshot): boolean =>
  normalizeLifecycle(source.lifecycle) === 'REJECTED';

export const isCustomerWithdrawn = (source: CustomerLifecycleSnapshot): boolean =>
  normalizeLifecycle(source.lifecycle) === 'WITHDRAWN';

export const isCustomerFinalApprovalPending = (source: CustomerLifecycleSnapshot): boolean =>
  normalizeLifecycle(source.lifecycle) === 'PENDING_APPROVAL';

export const isCustomerInProgress = (source: CustomerLifecycleSnapshot): boolean => {
  const lifecycle = normalizeLifecycle(source.lifecycle);
  if (!lifecycle) return false;
  return ['PROSPECT', 'IN_VERIFICATION', 'PENDING_APPROVAL'].includes(lifecycle);
};

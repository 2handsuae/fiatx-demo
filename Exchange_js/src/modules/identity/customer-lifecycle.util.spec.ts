import { BadRequestException } from '@nestjs/common';
import {
  nextLifecycle,
  type CustomerLifecycle,
  type CustomerLifecycleAction,
} from './constants/customer-lifecycle.constant';
import {
  buildLifecycleTransitionPatch,
  canFinalReview,
  canReinitiateCdd,
  canReinitiateEdd,
  canStartCdd,
  canStartEdd,
  getCustomerBlockedReason,
  getCustomerNextStepActionTypes,
  getExpectedReviewStageFromCustomerState,
  isCustomerApprovedAndActive,
  readLifecycle,
  resolveLifecycleTransition,
} from './customer-lifecycle.util';

const ALL_LIFECYCLES: CustomerLifecycle[] = [
  'PROSPECT',
  'IN_VERIFICATION',
  'PENDING_APPROVAL',
  'ACTIVE',
  'REJECTED',
  'WITHDRAWN',
  'OFFBOARDED',
];

const ALL_ACTIONS: CustomerLifecycleAction[] = [
  'START_VERIFICATION',
  'VERIFICATION_PASSED',
  'VERIFICATION_REJECTED',
  'WITHDRAW_APPLICATION',
  'FINAL_APPROVED',
  'FINAL_REJECTED',
  'REAPPLY',
  'OFFBOARD',
];

describe('customer-lifecycle.util', () => {
  describe('转移表一致性（防漂移）', () => {
    it('全量枚举恰好九条合法边，且每个动作只有一个目标态', () => {
      const legal: Array<[CustomerLifecycle, CustomerLifecycleAction, CustomerLifecycle]> = [];
      for (const from of ALL_LIFECYCLES) {
        for (const action of ALL_ACTIONS) {
          try {
            legal.push([from, action, nextLifecycle(from, action)]);
          } catch {
            // 非法边，跳过
          }
        }
      }

      expect(legal).toHaveLength(9);

      const targets = new Map<CustomerLifecycleAction, Set<CustomerLifecycle>>();
      for (const [, action, to] of legal) {
        const bucket = targets.get(action) ?? new Set<CustomerLifecycle>();
        bucket.add(to);
        targets.set(action, bucket);
      }
      for (const [action, bucket] of targets) {
        expect([action, bucket.size]).toEqual([action, 1]);
      }
    });

    it('resolveLifecycleTransition 在每条合法边上与 nextLifecycle 逐字一致', () => {
      for (const from of ALL_LIFECYCLES) {
        for (const action of ALL_ACTIONS) {
          let expected: CustomerLifecycle;
          try {
            expected = nextLifecycle(from, action);
          } catch {
            continue;
          }
          expect(resolveLifecycleTransition(from, action)).toBe(expected);
        }
      }
    });

    it('已在目标态时是幂等 no-op，返回 null 而不抛', () => {
      expect(resolveLifecycleTransition('IN_VERIFICATION', 'START_VERIFICATION')).toBeNull();
      expect(resolveLifecycleTransition('IN_VERIFICATION', 'REAPPLY')).toBeNull();
      expect(resolveLifecycleTransition('REJECTED', 'VERIFICATION_REJECTED')).toBeNull();
    });

    it('非法边抛 BadRequestException', () => {
      expect(() => resolveLifecycleTransition('PROSPECT', 'FINAL_APPROVED')).toThrow(
        BadRequestException,
      );
      expect(() => resolveLifecycleTransition('OFFBOARDED', 'REAPPLY')).toThrow(
        'Invalid lifecycle action REAPPLY from OFFBOARDED',
      );
    });

    it('buildLifecycleTransitionPatch：合法边给 patch，no-op 给空对象', () => {
      expect(buildLifecycleTransitionPatch('PENDING_APPROVAL', 'FINAL_APPROVED')).toEqual({
        lifecycle: 'ACTIVE',
      });
      expect(buildLifecycleTransitionPatch('ACTIVE', 'FINAL_APPROVED')).toEqual({});
    });
  });

  describe('readLifecycle', () => {
    it('大小写归一，未知值 fail-closed', () => {
      expect(readLifecycle({ lifecycle: 'active' })).toBe('ACTIVE');
      expect(() => readLifecycle({ lifecycle: 'PENDING_CDD_INPUT' })).toThrow(BadRequestException);
      expect(() => readLifecycle({ lifecycle: null })).toThrow(BadRequestException);
    });
  });

  describe('判据函数（全部只读 lifecycle）', () => {
    it('getCustomerNextStepActionTypes 逐态', () => {
      expect(getCustomerNextStepActionTypes({ lifecycle: 'PROSPECT' })).toEqual([
        'START_VERIFICATION',
      ]);
      expect(
        getCustomerNextStepActionTypes({ lifecycle: 'IN_VERIFICATION', verificationCanContinue: true }),
      ).toEqual(['CONTINUE_VERIFICATION']);
      expect(getCustomerNextStepActionTypes({ lifecycle: 'IN_VERIFICATION' })).toEqual([
        'WAIT_VERIFICATION',
      ]);
      expect(getCustomerNextStepActionTypes({ lifecycle: 'PENDING_APPROVAL' })).toEqual([
        'WAIT_FINAL_APPROVAL',
      ]);
      expect(getCustomerNextStepActionTypes({ lifecycle: 'ACTIVE' })).toEqual(['NONE']);
      expect(getCustomerNextStepActionTypes({ lifecycle: 'REJECTED' })).toEqual([
        'REINITIATE_VERIFICATION',
      ]);
      expect(getCustomerNextStepActionTypes({ lifecycle: 'WITHDRAWN' })).toEqual([
        'REINITIATE_VERIFICATION',
      ]);
      expect(getCustomerNextStepActionTypes({ lifecycle: 'OFFBOARDED' })).toEqual(['NONE']);
    });

    it('getCustomerBlockedReason 逐态', () => {
      expect(getCustomerBlockedReason({ lifecycle: 'PROSPECT' })).toBeNull();
      expect(getCustomerBlockedReason({ lifecycle: 'IN_VERIFICATION' })).toBeNull();
      expect(getCustomerBlockedReason({ lifecycle: 'PENDING_APPROVAL' })).toBe(
        'Waiting final onboarding decision.',
      );
      expect(getCustomerBlockedReason({ lifecycle: 'ACTIVE' })).toBe('Onboarding completed.');
      expect(getCustomerBlockedReason({ lifecycle: 'REJECTED' })).toBe(
        'Onboarding is rejected. Re-initiate required.',
      );
      expect(getCustomerBlockedReason({ lifecycle: 'WITHDRAWN' })).toBe('Onboarding is withdrawn.');
      expect(getCustomerBlockedReason({ lifecycle: 'OFFBOARDED' })).toBe(
        'Customer relationship is closed.',
      );
    });

    it('CDD / EDD / 终审 / 活跃 判据', () => {
      expect(canStartCdd({ lifecycle: 'PROSPECT' })).toBe(true);
      expect(canStartCdd({ lifecycle: 'IN_VERIFICATION' })).toBe(false);

      expect(canReinitiateCdd({ lifecycle: 'REJECTED' })).toBe(true);
      expect(canReinitiateCdd({ lifecycle: 'WITHDRAWN' })).toBe(true);
      expect(
        canReinitiateCdd({ lifecycle: 'ACTIVE', cddDocumentExpiresAt: new Date(Date.now() - 1000) }),
      ).toBe(true);
      expect(canReinitiateCdd({ lifecycle: 'ACTIVE' })).toBe(false);

      expect(canStartEdd({ lifecycle: 'IN_VERIFICATION', eddRequired: true })).toBe(true);
      expect(canStartEdd({ lifecycle: 'IN_VERIFICATION' })).toBe(false);

      expect(canReinitiateEdd({ lifecycle: 'PENDING_APPROVAL', eddRequired: true })).toBe(true);
      expect(canReinitiateEdd({ lifecycle: 'IN_VERIFICATION', eddRequired: true })).toBe(false);

      expect(getExpectedReviewStageFromCustomerState({ lifecycle: 'IN_VERIFICATION' })).toBe(
        'REVIEW_CDD',
      );
      expect(
        getExpectedReviewStageFromCustomerState({ lifecycle: 'IN_VERIFICATION', eddRequired: true }),
      ).toBe('REVIEW_EDD');
      expect(getExpectedReviewStageFromCustomerState({ lifecycle: 'ACTIVE' })).toBeNull();

      expect(canFinalReview({ lifecycle: 'PENDING_APPROVAL' })).toBe(true);
      expect(canFinalReview({ lifecycle: 'ACTIVE' })).toBe(false);

      expect(isCustomerApprovedAndActive({ lifecycle: 'ACTIVE' })).toBe(true);
      expect(isCustomerApprovedAndActive({ lifecycle: 'PENDING_APPROVAL' })).toBe(false);
    });
  });
});

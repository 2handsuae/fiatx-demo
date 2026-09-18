import { BadRequestException } from '@nestjs/common';
import { RESTRICTION_CAUSE_POLICY } from '../../customers/constants/restriction-cause.constant';
import {
  MATERIAL_REQUEST_TRANSITIONS,
  MATERIAL_REQUEST_LIVE_STATUSES,
  MATERIAL_REQUEST_TERMINAL,
  ISSUABLE_RESTRICTION_CAUSES,
  nextMaterialRequestStatus,
  type MaterialRequestStatus,
  type MaterialRequestAction,
} from './material-request.constant';

const ALL_STATUSES: MaterialRequestStatus[] = [
  'PENDING_SUBMISSION', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED',
];
const ALL_ACTIONS: MaterialRequestAction[] = [
  'SUBMIT', 'REVIEW_GREEN', 'REVIEW_RED_RETRY', 'REVIEW_RED_FINAL', 'CANCEL',
];

describe('material request state machine', () => {
  it('有且只有 6 条边 —— 多一条少一条都要在这里红', () => {
    const edges: string[] = [];
    for (const from of ALL_STATUSES) {
      for (const action of ALL_ACTIONS) {
        const to = MATERIAL_REQUEST_TRANSITIONS[from][action];
        if (to) edges.push(`${from} --${action}--> ${to}`);
      }
    }
    expect(edges.sort()).toEqual([
      'PENDING_SUBMISSION --CANCEL--> CANCELLED',
      'PENDING_SUBMISSION --SUBMIT--> SUBMITTED',
      'SUBMITTED --CANCEL--> CANCELLED',
      'SUBMITTED --REVIEW_GREEN--> APPROVED',
      'SUBMITTED --REVIEW_RED_FINAL--> REJECTED',
      'SUBMITTED --REVIEW_RED_RETRY--> PENDING_SUBMISSION',
    ]);
  });

  it('RETRY 回到 PENDING_SUBMISSION 而不是新状态 —— 同一个 action 重交', () => {
    expect(nextMaterialRequestStatus('SUBMITTED', 'REVIEW_RED_RETRY')).toBe('PENDING_SUBMISSION');
  });

  it('三个终态零出边', () => {
    for (const terminal of ['APPROVED', 'REJECTED', 'CANCELLED'] as MaterialRequestStatus[]) {
      expect(MATERIAL_REQUEST_TERMINAL.has(terminal)).toBe(true);
      expect(Object.keys(MATERIAL_REQUEST_TRANSITIONS[terminal])).toHaveLength(0);
    }
  });

  it('活行集合恰是两个非终态', () => {
    expect([...MATERIAL_REQUEST_LIVE_STATUSES].sort()).toEqual(['PENDING_SUBMISSION', 'SUBMITTED']);
    for (const s of MATERIAL_REQUEST_LIVE_STATUSES) {
      expect(MATERIAL_REQUEST_TERMINAL.has(s)).toBe(false);
    }
  });

  it('穷举 5×5 组合，非法边一律抛 BadRequestException 且不返回 null', () => {
    const legal = new Set([
      'PENDING_SUBMISSION|SUBMIT', 'PENDING_SUBMISSION|CANCEL',
      'SUBMITTED|REVIEW_GREEN', 'SUBMITTED|REVIEW_RED_RETRY',
      'SUBMITTED|REVIEW_RED_FINAL', 'SUBMITTED|CANCEL',
    ]);
    for (const from of ALL_STATUSES) {
      for (const action of ALL_ACTIONS) {
        if (legal.has(`${from}|${action}`)) continue;
        expect(() => nextMaterialRequestStatus(from, action)).toThrow(BadRequestException);
      }
    }
  });

  it('G4：白名单里每一个 cause 回查注册表都必须是 DISCLOSED', () => {
    // 不手写名字清单 —— 那样将来加 cause 时这条守则不会跟着响。
    // 直接回查限制账的注册表：只要有人往白名单里塞了 SILENT 类，这里立刻红。
    for (const cause of ISSUABLE_RESTRICTION_CAUSES) {
      expect(RESTRICTION_CAUSE_POLICY[cause].visibility).toBe('DISCLOSED');
    }
    expect(ISSUABLE_RESTRICTION_CAUSES).not.toContain('SANCTION');
    expect(ISSUABLE_RESTRICTION_CAUSES).not.toContain('KYT_REJECTED_HARD');
  });
});

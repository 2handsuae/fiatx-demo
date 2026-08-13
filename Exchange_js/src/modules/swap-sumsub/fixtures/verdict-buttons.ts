import { KYT_ONHOLD_TYPE } from '../../deposit-sumsub/kyt-webhook-types';
import { ApplicantAction, TypedTag } from '../../deposit-sumsub/fixtures/txn-report.builder';

/**
 * 8 个**单步**裁决按钮 —— mirror of 充值/提现的 fixtures/verdict-buttons.ts
 * (deliberate fork,不抽公共常量)。
 *
 * 与充值/提现的按钮形状不同:这里的 verdict 只有 reviewAnswer/score/
 * applicantActions/typedTags 四个字段,没有 reviewStatus/action/matchedRules ——
 * 后两者只用来给官方报文里的 review.reviewStatus / scoringResult.action 上色
 * (纯展示字段,SwapKytVerdictHandler 不读,只读 payload.type 本身),
 * demo-scenario.service.ts 按 webhookType 派生,不必让每个按钮重复填一遍。
 *
 * V1-V6 是 Sumsub 官方 KYT 交易裁决 webhook(与充值/提现同族)。V7/V8 是
 * applicantActionReviewed —— 作用对象是**人**(客户补料动作的复核结果),不是
 * 这笔已经终态的兑换单本身。⚠️ 这两个按钮目前投得出真实形状的 webhook、也真的
 * 走了 ingest() 链路,但现有路由/handler 并不认得 swap 拒绝留下的
 * pendingActionExternalId ——见 demo-scenario.service.ts 类注释顶部的已知缺口
 * 说明,这里不重复。
 */
export interface SwapVerdictVerdict {
  reviewAnswer: 'GREEN' | 'RED' | null;
  score?: number;
  applicantActions?: ApplicantAction[];
  typedTags?: TypedTag[];
}

export interface SwapVerdictButton {
  key: string;
  label: string;
  webhookType: string;
  verdict: SwapVerdictVerdict;
}

const TAG = (label: string) => ({ label, type: 'userDefined' as const });

export const SWAP_VERDICT_BUTTONS: Record<string, SwapVerdictButton> = {
  V1_APPROVED: {
    key: 'V1_APPROVED',
    label: '① Approved',
    webhookType: 'applicantKytTxnApproved',
    verdict: { reviewAnswer: 'GREEN', score: 10 },
  },
  V2_REJECTED_HARD: {
    key: 'V2_REJECTED_HARD',
    label: '② Rejected · 硬线（无 action）',
    webhookType: 'applicantKytTxnRejected',
    verdict: { reviewAnswer: 'RED', score: 90, applicantActions: [] },
  },
  V3_REJECTED_ACTION: {
    key: 'V3_REJECTED_ACTION',
    label: '③ Rejected · 软线（下发认证）',
    webhookType: 'applicantKytTxnRejected',
    verdict: {
      reviewAnswer: 'RED',
      score: 60,
      applicantActions: [{ applicantActionId: 'demo-action-1', externalActionId: 'demo-ext-1' }],
    },
  },
  V4_REJECTED_SANCTION: {
    key: 'V4_REJECTED_SANCTION',
    label: '④ Rejected · Sanctions',
    webhookType: 'applicantKytTxnRejected',
    verdict: {
      reviewAnswer: 'RED',
      score: 100,
      typedTags: [TAG('SANCTION')],
      applicantActions: [{ applicantActionId: 'demo-action-2', externalActionId: 'demo-ext-2' }],
    },
  },
  // 官方 on-hold 类型没有 `Txn`(applicantKytOnHold),复用 kyt-webhook-types.ts
  // 的常量而不是手打字面量 —— 避免重蹈此前 5 处一致写错成
  // applicantKytTxnOnHold 的覆辙(见该常量的注释)。
  V5_ONHOLD: {
    key: 'V5_ONHOLD',
    label: '⑤ On hold（我方等同拒绝）',
    webhookType: KYT_ONHOLD_TYPE,
    verdict: { reviewAnswer: null, score: 50 },
  },
  V6_AWAIT_USER: {
    key: 'V6_AWAIT_USER',
    label: '⑥ Awaiting user（我方等同拒绝）',
    webhookType: 'applicantKytTxnAwaitingUser',
    verdict: {
      reviewAnswer: null,
      score: 40,
      applicantActions: [{ applicantActionId: 'demo-action-3', externalActionId: 'demo-ext-3' }],
    },
  },
  V7_ACTION_GREEN: {
    key: 'V7_ACTION_GREEN',
    label: '⑦ 认证通过（清限制）',
    webhookType: 'applicantActionReviewed',
    verdict: { reviewAnswer: 'GREEN' },
  },
  V8_ACTION_RED: {
    key: 'V8_ACTION_RED',
    label: '⑧ 认证不通过（升级）',
    webhookType: 'applicantActionReviewed',
    verdict: { reviewAnswer: 'RED' },
  },
};

import { randomUUID } from 'crypto';
import { KYT_ONHOLD_TYPE } from '../../deposit-sumsub/kyt-webhook-types';
import { TxnReportVerdict } from '../../deposit-sumsub/fixtures/txn-report.builder';

/**
 * 9 个**单步**裁决按钮 —— mirror of
 * deposit-sumsub/fixtures/verdict-buttons.ts(deliberate fork, Task 10)。
 *
 * 与充值版唯一不同的是 ⑥:提现没有"退回发件人"语义(没有 RETURNING/RETURNED 中间
 * 弧那种"打回原路"概念),官方处置改叫"退款"——处置 tag 相应改用 REJECT_REFUND
 * (见 WithdrawKytVerdictHandler 的 DISPO_TAGS = {FROZEN_BY_MLRO, REJECT_REFUND})。
 * 其余 8 个按钮逐字同源充值版。
 *
 * 语义:一个按钮 = 投递一次 Sumsub webhook + 一份配套报文,状态流转完全交给现有
 * WithdrawKytVerdictHandler / WithdrawWorkflowService。operator 自由串联,贴近真实。
 */
export interface WithdrawVerdictButton {
  key: string;
  label: string;
  webhookType: string;
  verdict: TxnReportVerdict;
}

const RULE = (id: string, name: string, score: number, action: string, title: string) => ({
  id, name, revision: 1, title, score, dryRun: false, action,
});

const TAG = (label: string) => ({ label, type: 'userDefined' as const });

export const WITHDRAW_VERDICT_BUTTONS: Record<string, WithdrawVerdictButton> = {
  V1_APPROVED: {
    key: 'V1_APPROVED',
    label: '① Approved',
    webhookType: 'applicantKytTxnApproved',
    verdict: {
      reviewStatus: 'completed',
      reviewAnswer: 'GREEN',
      action: 'score',
      score: 5,
    },
  },

  V2_AWAIT_USER: {
    key: 'V2_AWAIT_USER',
    label: '② Awaiting user',
    webhookType: 'applicantKytTxnAwaitingUser',
    verdict: {
      reviewStatus: 'awaitingUser',
      reviewAnswer: null,
      action: 'awaitUser',
      score: 40,
      matchedRules: [
        RULE('KYC7', 'Source of funds unclear', 40, 'awaitUser', 'Additional information required from the applicant.'),
      ],
      // 材料请求账的 externalActionId 是全表 @unique（不像旧子表按
      // (订单id, seq) 分段去重）—— 固定字面量会在两笔不同订单先后点这个按钮时
      // P2002（终审 Important #4）。getter 按调用现铸,贴近真实 Sumsub 每次建
      // action 都发新 id 的行为；同一次 buildTxnReport() 调用只读一次
      // （见 deposit-sumsub/fixtures/txn-report.builder.ts:99）,单次投递内不会
      // 前后矛盾。
      get applicantActions() {
        return [
          { applicantActionId: `aa-sof-${randomUUID()}`, externalActionId: `EXT-SOF-${randomUUID()}` },
        ];
      },
    },
  },

  V3_AWAIT_USER_PEP: {
    key: 'V3_AWAIT_USER_PEP',
    label: '③ Awaiting user · PEP',
    webhookType: 'applicantKytTxnAwaitingUser',
    verdict: {
      reviewStatus: 'awaitingUser',
      reviewAnswer: null,
      action: 'awaitUser',
      score: 62,
      matchedRules: [
        RULE('AML4', 'PEP match', 62, 'awaitUser', 'Politically exposed person — enhanced due diligence documents required.'),
      ],
      // 同 V2_AWAIT_USER 的 getter 注记：现铸而非固定字面量。
      get applicantActions() {
        return [
          { applicantActionId: `aa-edd-${randomUUID()}`, externalActionId: `EXT-EDD-${randomUUID()}` },
        ];
      },
      typedTags: [TAG('PEP')],
    },
  },

  V4_REJECTED_SANCTION: {
    key: 'V4_REJECTED_SANCTION',
    label: '④ Rejected · Sanctions',
    webhookType: 'applicantKytTxnRejected',
    verdict: {
      reviewStatus: 'completed',
      reviewAnswer: 'RED',
      action: 'reject',
      score: 98,
      reviewRejectType: 'FINAL',
      matchedRules: [
        RULE('AML1', 'Sanctions match', 98, 'reject', 'Counterparty address matches an OFAC SDN sanctions list entry.'),
      ],
      typedTags: [TAG('SANCTION')],
    },
  },

  V5_REJECTED_FROZEN_MLRO: {
    key: 'V5_REJECTED_FROZEN_MLRO',
    label: '⑤ Rejected · MLRO freeze',
    webhookType: 'applicantKytTxnRejected',
    verdict: {
      reviewStatus: 'completed',
      reviewAnswer: 'RED',
      action: 'reject',
      score: 84,
      reviewRejectType: 'FINAL',
      matchedRules: [
        RULE('AML9', 'High-risk transaction pattern', 84, 'reject', 'MLRO disposition: freeze pending investigation.'),
      ],
      typedTags: [TAG('FROZEN_BY_MLRO')],
    },
  },

  // ⑥ 提现独有:官方处置叫"退款"(REJECT_REFUND),不是充值那边的
  // "退回发件人"(RETURN_TO_SENDER) —— 提现没有 RETURNING 中间弧。
  V6_REJECTED_REFUND_TAG: {
    key: 'V6_REJECTED_REFUND_TAG',
    label: '⑥ Rejected · Refund tag',
    webhookType: 'applicantKytTxnRejected',
    verdict: {
      reviewStatus: 'completed',
      reviewAnswer: 'RED',
      action: 'reject',
      score: 79,
      reviewRejectType: 'FINAL',
      matchedRules: [
        RULE('AML9', 'High-risk transaction pattern', 79, 'reject', 'Officer disposition: refund to sender.'),
      ],
      typedTags: [TAG('REJECT_REFUND')],
    },
  },

  V7_REJECTED_NO_TAG: {
    key: 'V7_REJECTED_NO_TAG',
    label: '⑦ Rejected · no disposition tag',
    webhookType: 'applicantKytTxnRejected',
    verdict: {
      reviewStatus: 'completed',
      reviewAnswer: 'RED',
      action: 'reject',
      score: 71,
      reviewRejectType: 'FINAL',
      matchedRules: [
        RULE('AML9', 'High-risk transaction pattern', 71, 'reject', 'Risk threshold exceeded — awaiting officer disposition.'),
      ],
    },
  },

  V8_ONHOLD: {
    key: 'V8_ONHOLD',
    label: '⑧ On hold',
    webhookType: KYT_ONHOLD_TYPE,
    verdict: {
      reviewStatus: 'onHold',
      reviewAnswer: null,
      action: 'onHold',
      score: 55,
      matchedRules: [
        RULE('AML12', 'Manual review threshold', 55, 'onHold', 'Queued for manual officer review.'),
      ],
    },
  },

  V9_REJECTED_SLA: {
    key: 'V9_REJECTED_SLA',
    label: '⑨ Rejected · SLA breach',
    webhookType: 'applicantKytTxnRejected',
    verdict: {
      reviewStatus: 'completed',
      reviewAnswer: 'RED',
      action: 'reject',
      score: 55,
      reviewRejectType: 'FINAL',
      matchedRules: [
        RULE('AML12', 'Manual review threshold', 55, 'reject', 'Review SLA elapsed without officer disposition.'),
      ],
      typedTags: [TAG('SLA_BREACH')],
    },
  },

  V10_AWAIT_USER_MULTI: {
    key: 'V10_AWAIT_USER_MULTI',
    label: '⑩ Awaiting user · 多条',
    webhookType: 'applicantKytTxnAwaitingUser',
    verdict: {
      reviewStatus: 'awaitingUser',
      reviewAnswer: null,
      action: 'awaitUser',
      score: 45,
      matchedRules: [
        RULE('KYC9', 'Multiple documents required', 45, 'awaitUser', 'Several items required from the applicant.'),
      ],
      // 三条一次性下发,用于验证"点哪条看哪条"以及"交完前两条徽章仍是
      // ACTION REQUIRED、交完第三条才切已收到"(逐字同源充值版)。同
      // V2_AWAIT_USER 的 getter 注记：现铸而非固定字面量,前缀留着方便日志里
      // 认出"这是第几条"。
      get applicantActions() {
        return [
          { applicantActionId: `aa-multi-0001-${randomUUID()}`, externalActionId: `EXT-MULTI-0001-${randomUUID()}` },
          { applicantActionId: `aa-multi-0002-${randomUUID()}`, externalActionId: `EXT-MULTI-0002-${randomUUID()}` },
          { applicantActionId: `aa-multi-0003-${randomUUID()}`, externalActionId: `EXT-MULTI-0003-${randomUUID()}` },
        ];
      },
    },
  },
};

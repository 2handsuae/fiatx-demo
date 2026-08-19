import { randomUUID } from 'crypto';
import { KYT_ONHOLD_TYPE } from '../kyt-webhook-types';
import { TxnReportVerdict } from './txn-report.builder';

/**
 * 9 个**单步**裁决按钮,取代此前的 8 个多步场景剧本。
 *
 * 语义:一个按钮 = 投递一次 Sumsub webhook + 一份配套报文,状态流转完全交给现有
 * DepositKytVerdictHandler / DepositWorkflowService。operator 自由串联,贴近真实
 * (真实世界就是一次次 webhook 进来):
 *   ② → ①  补料后通过
 *   ⑦ → ⑤  人工复核后 MLRO 冻结
 *   ⑧ → ⑨  挂起后超时转人工
 *
 * 报文由 buildTxnReport() 按该 deposit 实际的 sumsubTxnType 现生成,不写死。
 *
 * ⚠️ 没有 `moderationComment` 字段:两次独立核对官方文档确认,交易的
 * `review.reviewResult` 只有 `reviewAnswer` 和 `reviewRejectType` 两个字段,
 * `moderationComment` 属 applicant 审核 schema,不在交易报文里。人类可读的叙述
 * 改放进 `matchedRules[].title`(官方真字段,raw payload 里可见度与原先等同);
 * ① Approved 与 ⑧ On hold 这类无叙述可挂的,直接不传 —— 真实 Sumsub 的干净交易
 * 本来就没有散文解释,这更贴近实际。
 */
export interface DepositVerdictButton {
  key: string;
  label: string;
  webhookType: string;
  verdict: TxnReportVerdict;
}

const RULE = (id: string, name: string, score: number, action: string, title: string) => ({
  id, name, revision: 1, title, score, dryRun: false, action,
});

const TAG = (label: string) => ({ label, type: 'userDefined' as const });

export const DEPOSIT_VERDICT_BUTTONS: Record<string, DepositVerdictButton> = {
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
      // P2002（终审 Important #4）。getter 按调用现铸，贴近真实 Sumsub 每次建
      // action 都发新 id 的行为；同一次 buildTxnReport() 调用只读一次
      // （见 txn-report.builder.ts:99），单次投递内不会前后矛盾。
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

  V6_REJECTED_RETURN: {
    key: 'V6_REJECTED_RETURN',
    label: '⑥ Rejected · MLRO return',
    webhookType: 'applicantKytTxnRejected',
    verdict: {
      reviewStatus: 'completed',
      reviewAnswer: 'RED',
      action: 'reject',
      score: 79,
      reviewRejectType: 'FINAL',
      matchedRules: [
        RULE('AML9', 'High-risk transaction pattern', 79, 'reject', 'MLRO disposition: return funds to the originating account.'),
      ],
      typedTags: [TAG('RETURN_TO_SENDER')],
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
      // ACTION REQUIRED、交完第三条才切已收到"。同 V2_AWAIT_USER 的 getter
      // 注记：现铸而非固定字面量,前缀留着方便日志里认出"这是第几条"。
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

import { randomUUID } from 'crypto';
import { KYT_ONHOLD_TYPE } from './kyt-webhook-types';
import type { TxnReportVerdict } from './txn-report.builder';

export type ButtonSource = 'ENGINE' | 'OFFICER';
export type OrderDomain = 'DEPOSIT' | 'WITHDRAW';

export interface OrderVerdictButton {
  key: string;
  label: string;
  webhookType: string;
  /** ENGINE = Sumsub 规则引擎自动命中；OFFICER = 合规官在 Sumsub 台上手工处置。面板据此分两组。 */
  source: ButtonSource;
  /** awaitUser 档专用：true = 开客户级便签；false = 只挂订单（提醒型材料请求）。 */
  restrictCustomer?: boolean;
  verdict: TxnReportVerdict;
}

const RULE = (id: string, name: string, score: number, action: string, title: string) => ({
  id, name, revision: 1, title, score, dryRun: false, action,
});
const TAG = (label: string) => ({ label, type: 'userDefined' as const });

/**
 * getter 而非固定字面量：材料请求账的 externalActionId 是全表 @unique
 * （不像旧子表按 (订单id, seq) 分段去重），固定字面量会在两笔不同订单先后
 * 点同一个按钮时 P2002。现铸也更贴近真实 Sumsub —— 每次建 action 都发新 id。
 */
const action = (prefix: string) => ({
  applicantActionId: `aa-${prefix}-${randomUUID()}`,
  externalActionId: `EXT-${prefix.toUpperCase()}-${randomUUID()}`,
});

/** ⑩ 处置标签在两域的取值：充值退回原发款方，提现最终拒付。 */
const DISPOSITION_TAG: Record<OrderDomain, string> = {
  DEPOSIT: 'RETURN_TO_SENDER',
  WITHDRAW: 'FINAL_REJECTED',
};
const DISPOSITION_TITLE: Record<OrderDomain, string> = {
  DEPOSIT: 'MLRO disposition: return funds to the originating account.',
  WITHDRAW: 'Officer disposition: final rejection, funds released back to the customer balance.',
};

export function buildOrderVerdictButtons(
  domain: OrderDomain,
): Record<string, OrderVerdictButton> {
  return {
    V1_APPROVED: {
      key: 'V1_APPROVED', label: '① Approved',
      webhookType: 'applicantKytTxnApproved', source: 'ENGINE',
      verdict: { reviewStatus: 'completed', reviewAnswer: 'GREEN', action: 'score', score: 5 },
    },

    V2_AWAIT_USER: {
      key: 'V2_AWAIT_USER', label: '② Awaiting user',
      webhookType: 'applicantKytTxnAwaitingUser', source: 'ENGINE',
      restrictCustomer: false,
      verdict: {
        reviewStatus: 'awaitingUser', reviewAnswer: null, action: 'awaitUser', score: 40,
        matchedRules: [RULE('KYC7', 'Source of funds unclear', 40, 'awaitUser',
          'Additional information required from the applicant.')],
        get applicantActions() { return [action('sof')]; },
      },
    },

    V3_AWAIT_USER_PEP_APPLICANT: {
      key: 'V3_AWAIT_USER_PEP_APPLICANT', label: '③ Awaiting user · PEP（客户本人）',
      webhookType: 'applicantKytTxnAwaitingUser', source: 'ENGINE',
      restrictCustomer: true,
      verdict: {
        reviewStatus: 'awaitingUser', reviewAnswer: null, action: 'awaitUser', score: 62,
        matchedRules: [RULE('AML4', 'PEP match (applicant)', 62, 'awaitUser',
          'The customer themselves is a politically exposed person — enhanced due diligence documents required.')],
        typedTags: [TAG('PEP_APPLICANT')],
        get applicantActions() { return [action('edd')]; },
      },
    },

    V4_AWAIT_USER_PEP_COUNTERPARTY: {
      key: 'V4_AWAIT_USER_PEP_COUNTERPARTY', label: '④ Awaiting user · PEP（对手方）',
      webhookType: 'applicantKytTxnAwaitingUser', source: 'ENGINE',
      restrictCustomer: true,
      verdict: {
        reviewStatus: 'awaitingUser', reviewAnswer: null, action: 'awaitUser', score: 58,
        matchedRules: [RULE('AML4', 'PEP match (counterparty)', 58, 'awaitUser',
          'The counterparty is a politically exposed person — enhanced due diligence documents required.')],
        typedTags: [TAG('PEP_COUNTERPARTY')],
        get applicantActions() { return [action('edd-cp')]; },
      },
    },

    V5_AWAIT_USER_MULTI: {
      key: 'V5_AWAIT_USER_MULTI', label: '⑤ Awaiting user · 多条',
      webhookType: 'applicantKytTxnAwaitingUser', source: 'ENGINE',
      restrictCustomer: false,
      verdict: {
        reviewStatus: 'awaitingUser', reviewAnswer: null, action: 'awaitUser', score: 45,
        matchedRules: [RULE('KYC9', 'Multiple documents required', 45, 'awaitUser',
          'Several items required from the applicant.')],
        get applicantActions() { return [action('multi-1'), action('multi-2'), action('multi-3')]; },
      },
    },

    V6_ONHOLD: {
      key: 'V6_ONHOLD', label: '⑥ On hold',
      webhookType: KYT_ONHOLD_TYPE, source: 'ENGINE',
      verdict: {
        reviewStatus: 'onHold', reviewAnswer: null, action: 'onHold', score: 55,
        matchedRules: [RULE('AML12', 'Manual review threshold', 55, 'onHold',
          'Queued for manual officer review.')],
      },
    },

    V7_REJECTED_SANCTION_APPLICANT: {
      key: 'V7_REJECTED_SANCTION_APPLICANT', label: '⑦ Rejected · Sanctions（客户本人）',
      webhookType: 'applicantKytTxnRejected', source: 'ENGINE',
      verdict: {
        reviewStatus: 'completed', reviewAnswer: 'RED', action: 'reject', score: 98,
        reviewRejectType: 'FINAL',
        matchedRules: [RULE('AML1', 'Sanctions match (applicant)', 98, 'reject',
          'The customer themselves matches an OFAC SDN sanctions list entry.')],
        typedTags: [TAG('SANCTION_APPLICANT')],
      },
    },

    V8_REJECTED_SANCTION_COUNTERPARTY: {
      key: 'V8_REJECTED_SANCTION_COUNTERPARTY', label: '⑧ Rejected · Sanctions（对手方）',
      webhookType: 'applicantKytTxnRejected', source: 'ENGINE',
      verdict: {
        reviewStatus: 'completed', reviewAnswer: 'RED', action: 'reject', score: 98,
        reviewRejectType: 'FINAL',
        matchedRules: [RULE('AML1', 'Sanctions match (counterparty)', 98, 'reject',
          'Counterparty address matches an OFAC SDN sanctions list entry.')],
        typedTags: [TAG('SANCTION_COUNTERPARTY')],
      },
    },

    V9_REJECTED_MLRO_FREEZE: {
      key: 'V9_REJECTED_MLRO_FREEZE', label: '⑨ Rejected · MLRO freeze',
      webhookType: 'applicantKytTxnRejected', source: 'OFFICER',
      verdict: {
        reviewStatus: 'completed', reviewAnswer: 'RED', action: 'reject', score: 84,
        reviewRejectType: 'FINAL',
        matchedRules: [RULE('AML9', 'High-risk transaction pattern', 84, 'reject',
          'MLRO disposition: freeze pending investigation.')],
        typedTags: [TAG('FROZEN_BY_MLRO')],
      },
    },

    V10_REJECTED_DISPOSITION: {
      key: 'V10_REJECTED_DISPOSITION',
      label: domain === 'DEPOSIT' ? '⑩ Rejected · MLRO return' : '⑩ Rejected · Final rejected',
      webhookType: 'applicantKytTxnRejected', source: 'OFFICER',
      verdict: {
        reviewStatus: 'completed', reviewAnswer: 'RED', action: 'reject', score: 79,
        reviewRejectType: 'FINAL',
        matchedRules: [RULE('AML9', 'High-risk transaction pattern', 79, 'reject',
          DISPOSITION_TITLE[domain])],
        typedTags: [TAG(DISPOSITION_TAG[domain])],
      },
    },

    V11_REJECTED_NO_TAG: {
      key: 'V11_REJECTED_NO_TAG', label: '⑪ Rejected · no disposition tag',
      webhookType: 'applicantKytTxnRejected', source: 'ENGINE',
      verdict: {
        reviewStatus: 'completed', reviewAnswer: 'RED', action: 'reject', score: 71,
        reviewRejectType: 'FINAL',
        matchedRules: [RULE('AML9', 'High-risk transaction pattern', 71, 'reject',
          'Risk threshold exceeded — awaiting officer disposition.')],
      },
    },
  };
}

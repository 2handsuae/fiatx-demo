import { randomUUID } from 'crypto';
import { KYT_ONHOLD_TYPE } from '../../sumsub-shared/kyt-webhook-types';
import { ApplicantAction, TypedTag } from '../../sumsub-shared/txn-report.builder';

/**
 * 7 个**单步**裁决按钮 —— mirror of 充值/提现的 fixtures/verdict-buttons.ts
 * (deliberate fork,不抽公共常量)。
 *
 * ⚠️ 没有 `V4B_REJECTED_SANCTION_COUNTERPARTY`（业主 2026-08-20 终审裁定）：
 * 兑换是平台内 crypto↔fiat 余额交换，钱在我方账户体系内部动，没有第三方
 * 对手方，Sumsub 不可能对一笔 swap 回传"对手方被制裁"——充值/提现两个姊妹
 * fixtures 保留这个键是因为那两域有真实外部对手方（链上打款方/收款地址），
 * 场景成立；这里不成立，删掉，不是漏拆。
 *
 * 与充值/提现的按钮形状不同:这里的 verdict 只有 reviewAnswer/score/
 * applicantActions/typedTags 四个字段,没有 reviewStatus/action/matchedRules ——
 * 后两者只用来给官方报文里的 review.reviewStatus / scoringResult.action 上色
 * (纯展示字段,SwapKytVerdictHandler 不读,只读 payload.type 本身),
 * demo-scenario.service.ts 按 webhookType 派生,不必让每个按钮重复填一遍。
 *
 * V1-V6 是 Sumsub 官方 KYT 交易裁决 webhook(与充值/提现同族)。V7/V8 是
 * applicantActionReviewed —— 作用对象是**人**(客户补料动作的复核结果),不是
 * 这笔已经终态的兑换单本身。这两个按钮投出真实形状的 webhook、走真实的
 * ingest() 链路,并且(Task 13 起)真实闭环:GREEN 清客户的 SWAP/WITHDRAW 限制
 * (硬线/制裁客户除外),RED 保持限制并升级审计——见 demo-scenario.service.ts
 * 类注释与 SwapApplicantActionHandler 的类注释,这里不重复。
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
      // 材料请求账的 externalActionId 是全表 @unique（不像旧子表按
      // (订单id, seq) 分段去重）—— 固定字面量会在两笔不同订单先后点这个按钮时
      // P2002（终审 Important #4）。getter 按调用现铸,贴近真实 Sumsub 每次建
      // action 都发新 id 的行为。
      get applicantActions() {
        return [{ applicantActionId: `demo-action-${randomUUID()}`, externalActionId: `demo-ext-${randomUUID()}` }];
      },
    },
  },
  V4_REJECTED_SANCTION_APPLICANT: {
    key: 'V4_REJECTED_SANCTION_APPLICANT',
    label: '④ Rejected · Sanctions（客户本人）',
    webhookType: 'applicantKytTxnRejected',
    verdict: {
      reviewAnswer: 'RED',
      score: 100,
      typedTags: [TAG('SANCTION_APPLICANT')],
      // 同 V3_REJECTED_ACTION 的 getter 注记：现铸而非固定字面量。
      get applicantActions() {
        return [{ applicantActionId: `demo-action-${randomUUID()}`, externalActionId: `demo-ext-${randomUUID()}` }];
      },
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
      // 同 V3_REJECTED_ACTION 的 getter 注记：现铸而非固定字面量。
      get applicantActions() {
        return [{ applicantActionId: `demo-action-${randomUUID()}`, externalActionId: `demo-ext-${randomUUID()}` }];
      },
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

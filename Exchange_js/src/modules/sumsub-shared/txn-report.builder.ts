/**
 * 按 Sumsub 官方 getTxn 报文 schema 生成仿真报文（2026-07-31 查证
 * docs.sumsub.com/reference/get-transaction）。
 *
 * 为什么不再手拼字面量:旧 `buildRawDetail()` 塞了若干真实 Sumsub **不存在**的字段：
 * - 顶层 `verdict`（applicant 审核字段）
 * - `review.reviewResult.moderationComment`（applicant 审核字段，不在交易 getTxn 里）
 * 又缺 `data.type`/`review.reviewStatus`/`scoringResult.action` —— 导致
 * ① 详情页 "Review Status" 行恒空;② `parseDetail` 的生产回退分支(读 scoringResult.action)
 * 在演示里一次都跑不到;③ 报文里看不出这笔是 finance 还是 travelRule。
 */

export interface MatchedRule {
  id: string;
  name: string;
  revision: number;
  title: string;
  score: number;
  dryRun: boolean;
  action: string;
}

export interface ApplicantAction {
  applicantActionId: string;
  externalActionId: string;
}

export interface TypedTag {
  label: string;
  type: 'system' | 'userDefined';
}

export interface TxnReportContext {
  /** 现铸的 24-hex Sumsub txnId */
  txnId: string;
  /** 决定 data.type 与 travelRuleInfo 是否出现 */
  txnType: 'finance' | 'travelRule';
  applicantId: string;
  /** 我方 customerNo */
  externalUserId: string;
  /** 我方 depositNo（提交时的 clientTxnId） */
  clientTxnId: string;
  amount: number;
  currency: string;
  /** 决定 cryptoTxnInfo 是否出现 */
  isCrypto: boolean;
  createdAtIso: string;
  /** data.info.direction —— 充值='in'(默认,向后兼容)，提现(Task 10 复用)='out' */
  direction?: 'in' | 'out';
}

export interface TxnReportVerdict {
  reviewStatus: 'completed' | 'onHold' | 'awaitingUser';
  reviewAnswer: 'GREEN' | 'RED' | null;
  /** 官方 scoringResult.action —— parseDetail 在生产环境读的就是它 */
  action: 'score' | 'onHold' | 'awaitUser' | 'reject';
  score: number;
  /** 官方 review.reviewResult 的合法字段之一：决定是否重新审核或最终拒绝 */
  reviewRejectType?: 'FINAL' | 'RETRY';
  matchedRules?: MatchedRule[];
  applicantActions?: ApplicantAction[];
  typedTags?: TypedTag[];
}

export function buildTxnReport(
  ctx: TxnReportContext,
  verdict: TxnReportVerdict,
): Record<string, unknown> {
  const report: Record<string, unknown> = {
    id: ctx.txnId,
    applicantId: ctx.applicantId,
    externalUserId: ctx.externalUserId,
    clientId: 'fiatx',
    createdAt: ctx.createdAtIso,
    score: verdict.score,
    data: {
      txnId: ctx.clientTxnId,
      txnDate: ctx.createdAtIso,
      type: ctx.txnType,
      info: {
        amount: ctx.amount,
        currencyCode: ctx.currency,
        currencyType: ctx.isCrypto ? 'crypto' : 'fiat',
        direction: ctx.direction ?? 'in',
      },
    },
    review: {
      reviewId: `rev-${ctx.txnId.slice(0, 12)}`,
      reviewStatus: verdict.reviewStatus,
      reviewResult: {
        reviewAnswer: verdict.reviewAnswer,
        ...(verdict.reviewRejectType && { reviewRejectType: verdict.reviewRejectType }),
      },
    },
    scoringResult: {
      score: verdict.score,
      action: verdict.action,
      matchedRules: verdict.matchedRules ?? [],
      applicantActions: verdict.applicantActions ?? [],
      failedRules: [],
    },
    typedTags: verdict.typedTags ?? [],
  };

  // 官方:cryptoTxnInfo 承载链上筛查商的应答,仅虚拟币交易才有。
  if (ctx.isCrypto) {
    report.cryptoTxnInfo = {
      crystalMonitorData: {
        answer: verdict.reviewAnswer === 'RED' ? 'RED' : 'GREEN',
        riskScore: verdict.score,
      },
    };
  }

  // 官方:travelRuleInfo 只在 data.type === 'travelRule' 时出现。
  if (ctx.txnType === 'travelRule') {
    report.travelRuleInfo = {
      protocolName: 'trp',
      status: 'completed',
      applicantVaspId: 'vasp-fiatx-ae',
      counterpartyVaspId: 'vasp-counterparty-01',
      expiredAt: null,
      needApplicantOwnershipConfirmation: false,
    };
  }

  return report;
}

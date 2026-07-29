import { SumsubTxnDetail } from '../sumsub-txn.types';

/**
 * Task 11:8 场景 fixture(计划1 引擎)。场景清单以 Task 11 dispatch 为准,非 brief 原稿的 9 个:
 * S8(below-min)挪计划2;S4 改为 KYT 重评驱动(补料后 Sumsub 自动重评发 approved,不走专门的
 * DepositActionHandler);S6 原止于 RETURNING,计划2·A2 接入退回 maker-checker 审批后改止于
 * MANUAL_CHECKING(RETURN_TO_SENDER 只开 DEPOSIT_RETURN 审批,不再直推状态——两腿回款结算/
 * RETURNING→RETURNED 留 A3)。
 *
 * ⚠️ **T1/TF/TT/T3… 是槽位名,不是 txnId。** 真实的 Sumsub KYT txnId 是 24 位小写 hex
 * (ObjectId 形态),由 `DepositDemoScenarioService.mintTxnId()` 按 (depositNo, 槽位) 现铸,
 * 本文件只负责"哪几步引用同一笔交易"。**不要把这里的字面量当真 id 直接查库/发 webhook** ——
 * 那正是 2026-07-29 实测踩到的坑:两笔单跑同一场景时 `findBySumsubTxnId('T3')` 匹到上一笔单,
 * 端点返回 201、事件全 PROCESSED、零报错,驱动的却是错误的单。
 *
 * 每个场景 = submit 预置(clientTxnId→槽位 的映射)+ 有序 steps。steps 里:
 *   - primeTxn:本步喂 webhook 前,先(重)设 MockSumsubTxnClient 对该 txnId 的 getTxn 应答。
 *     S5/S6 需要在两次 applicantKytTxnRejected 之间重设 tag(先无处置tag,后 FROZEN_BY_MLRO /
 *     RETURN_TO_SENDER),所以 primeTxn 挂在 step 上而不是挂在 scenario 顶层。
 *   - webhook:要喂进真实入口的 payload 片段,字段严格对齐 DepositKytVerdictHandler.handle()
 *     实际读取的字段(type、kytTxnId)——payload 其余字段(applicantId 等)对本场景的状态流转
 *     无影响,故不填。
 *   - needsSlaTimer:本步不投 webhook,而是触发 SLA 定时器扫描(S9);runner 会先把
 *     deposit.slaDeadline 拨到过去(免得真等 7 天),再调用一次扫描方法。
 */

export interface DepositScenarioStep {
  /** 本步喂 webhook 前,先(重)设该 txnId 的 getTxn 应答 */
  primeTxn?: { txnId: string; detail: SumsubTxnDetail };
  /** 要喂进 ingestion 入口的 webhook payload(type + kytTxnId) */
  webhook?: { type: string; kytTxnId: string };
  /** 本步触发 SLA 定时器扫描,而非投 webhook */
  needsSlaTimer?: boolean;
}

/** submitTxn 预置:对应 DepositWorkflowService.submitSumsubTxns() 提交时用的 clientTxnId → txnId */
export interface DepositScenarioSubmit {
  /** finance 腿:clientTxnId = deposit.depositNo */
  financeTxnId: string;
  /** travelRule 腿(仅 crypto 场景才有):clientTxnId = `${deposit.depositNo}-TR` */
  travelRuleTxnId?: string;
}

export interface DepositScenario {
  key: string;
  description: string;
  submit: DepositScenarioSubmit;
  steps: DepositScenarioStep[];
  /** DepositTransactionStatus 的字符串值,e.g. 'SUCCESS' / 'FROZEN' / 'RETURNING' / 'MANUAL_CHECKING' */
  expectedFinalStatus: string;
}

function userTag(label: string): { label: string; type: 'userDefined' } {
  return { label, type: 'userDefined' };
}

export const DEPOSIT_SCENARIOS: Record<string, DepositScenario> = {
  S1_HAPPY_FIAT: {
    key: 'S1_HAPPY_FIAT',
    description: 'fiat 充值全绿:Created→Approved,approved 不读 tag,直接 SUCCESS',
    submit: { financeTxnId: 'T1' },
    steps: [
      { webhook: { type: 'applicantKytTxnCreated', kytTxnId: 'T1' } },
      { webhook: { type: 'applicantKytTxnApproved', kytTxnId: 'T1' } },
    ],
    expectedFinalStatus: 'SUCCESS',
  },

  S2_HAPPY_CRYPTO: {
    key: 'S2_HAPPY_CRYPTO',
    description: 'crypto 充值全绿:finance + travelRule 两腿各自 Created→Approved → SUCCESS',
    submit: { financeTxnId: 'TF', travelRuleTxnId: 'TT' },
    steps: [
      { webhook: { type: 'applicantKytTxnCreated', kytTxnId: 'TF' } },
      { webhook: { type: 'applicantKytTxnCreated', kytTxnId: 'TT' } },
      { webhook: { type: 'applicantKytTxnApproved', kytTxnId: 'TF' } },
      { webhook: { type: 'applicantKytTxnApproved', kytTxnId: 'TT' } },
    ],
    expectedFinalStatus: 'SUCCESS',
  },

  S3_SANCTIONS: {
    key: 'S3_SANCTIONS',
    description: '制裁命中:Created→Rejected(SANCTION tag) → FROZEN(零记账)',
    submit: { financeTxnId: 'T3' },
    steps: [
      { webhook: { type: 'applicantKytTxnCreated', kytTxnId: 'T3' } },
      {
        primeTxn: {
          txnId: 'T3',
          detail: { txnId: 'T3', verdict: 'rejected', reviewAnswer: 'RED', riskScore: 98, typedTags: [userTag('SANCTION')] },
        },
        webhook: { type: 'applicantKytTxnRejected', kytTxnId: 'T3' },
      },
    ],
    expectedFinalStatus: 'FROZEN',
  },

  S4_PEP_EDD_PASS: {
    key: 'S4_PEP_EDD_PASS',
    description:
      'PEP EDD:Created→AwaitingUser(PEP tag)→ACTION_PENDING;客户补料后 Sumsub 自动重评发 Approved(不读tag) → SUCCESS',
    submit: { financeTxnId: 'T4' },
    steps: [
      { webhook: { type: 'applicantKytTxnCreated', kytTxnId: 'T4' } },
      {
        primeTxn: {
          txnId: 'T4',
          detail: { txnId: 'T4', verdict: 'awaitUser', reviewAnswer: null, riskScore: 71, typedTags: [userTag('PEP')] },
        },
        webhook: { type: 'applicantKytTxnAwaitingUser', kytTxnId: 'T4' },
      },
      { webhook: { type: 'applicantKytTxnApproved', kytTxnId: 'T4' } },
    ],
    expectedFinalStatus: 'SUCCESS',
  },

  S5_DIRTY_MANUAL_FROZEN: {
    key: 'S5_DIRTY_MANUAL_FROZEN',
    description:
      '脏钱→人工复核(第一次 Rejected 无处置tag→MANUAL_CHECKING)→第二次 Rejected 重设为 FROZEN_BY_MLRO → FROZEN',
    submit: { financeTxnId: 'T5' },
    steps: [
      { webhook: { type: 'applicantKytTxnCreated', kytTxnId: 'T5' } },
      {
        primeTxn: {
          txnId: 'T5',
          detail: { txnId: 'T5', verdict: 'rejected', reviewAnswer: 'RED', riskScore: 84, typedTags: [] },
        },
        webhook: { type: 'applicantKytTxnRejected', kytTxnId: 'T5' },
      },
      {
        primeTxn: {
          txnId: 'T5',
          detail: {
            txnId: 'T5',
            verdict: 'rejected',
            reviewAnswer: 'RED',
            riskScore: 84,
            typedTags: [userTag('FROZEN_BY_MLRO')],
          },
        },
        webhook: { type: 'applicantKytTxnRejected', kytTxnId: 'T5' },
      },
    ],
    expectedFinalStatus: 'FROZEN',
  },

  S6_DIRTY_MANUAL_RETURN: {
    key: 'S6_DIRTY_MANUAL_RETURN',
    description:
      '脏钱→人工复核(第一次 Rejected 无处置tag→MANUAL_CHECKING)→第二次 Rejected 重设为 RETURN_TO_SENDER → ' +
      '开 DEPOSIT_RETURN maker-checker 审批,止于 MANUAL_CHECKING(计划2·A2 改:不再直推 RETURNING —— ' +
      '审批通过后的两腿回款结算/RETURNING→RETURNED 留 A3)',
    submit: { financeTxnId: 'T6' },
    steps: [
      { webhook: { type: 'applicantKytTxnCreated', kytTxnId: 'T6' } },
      {
        primeTxn: {
          txnId: 'T6',
          detail: { txnId: 'T6', verdict: 'rejected', reviewAnswer: 'RED', riskScore: 79, typedTags: [] },
        },
        webhook: { type: 'applicantKytTxnRejected', kytTxnId: 'T6' },
      },
      {
        primeTxn: {
          txnId: 'T6',
          detail: {
            txnId: 'T6',
            verdict: 'rejected',
            reviewAnswer: 'RED',
            riskScore: 79,
            typedTags: [userTag('RETURN_TO_SENDER')],
          },
        },
        webhook: { type: 'applicantKytTxnRejected', kytTxnId: 'T6' },
      },
    ],
    expectedFinalStatus: 'MANUAL_CHECKING',
  },

  S7_DIRTY_MANUAL_OVERTURNED: {
    key: 'S7_DIRTY_MANUAL_OVERTURNED',
    description:
      '脏钱→人工复核(Rejected 无处置tag→MANUAL_CHECKING)→误报翻案,官方裁决翻回 Approved(不读tag) → SUCCESS',
    submit: { financeTxnId: 'T7' },
    steps: [
      { webhook: { type: 'applicantKytTxnCreated', kytTxnId: 'T7' } },
      {
        primeTxn: {
          txnId: 'T7',
          detail: { txnId: 'T7', verdict: 'rejected', reviewAnswer: 'RED', riskScore: 62, typedTags: [] },
        },
        webhook: { type: 'applicantKytTxnRejected', kytTxnId: 'T7' },
      },
      { webhook: { type: 'applicantKytTxnApproved', kytTxnId: 'T7' } },
    ],
    expectedFinalStatus: 'SUCCESS',
  },

  S9_ONHOLD_SLA: {
    key: 'S9_ONHOLD_SLA',
    description:
      'Created→OnHold(不读tag)挂起等 officer;SLA 定时器扫到 slaDeadline 已过 → MANUAL_CHECKING',
    submit: { financeTxnId: 'T9' },
    steps: [
      { webhook: { type: 'applicantKytTxnCreated', kytTxnId: 'T9' } },
      { webhook: { type: 'applicantKytTxnOnHold', kytTxnId: 'T9' } },
      { needsSlaTimer: true },
    ],
    expectedFinalStatus: 'MANUAL_CHECKING',
  },
};

/**
 * KYT 交易 webhook 类型的单一真相源，ingestion 前置分流 / router / handler 共用。
 *
 * ⚠️ `applicantKytOnHold` **没有 `Txn`** —— 这是 Sumsub 官方的命名不一致（其文档自己
 * 注明了）。此前我方五处一致写成 `applicantKytTxnOnHold`，且 ingestion 用
 * `startsWith('applicantKytTxn')` 前缀匹配，导致真实 on-hold 事件在最外层就被丢弃、
 * 挂起复核整条路失效；因为 fixture 也一样错，演示与单测全绿、掩盖了缺陷。
 *
 * 前缀匹配已改为显式集合匹配：`applicantKyt` 前缀下还有 AML 等其它族事件，
 * 放宽前缀会把它们误吞进 deposit 路由。
 */
export const KYT_ONHOLD_TYPE = 'applicantKytOnHold';

export const KYT_VERDICT_TYPES: ReadonlySet<string> = new Set([
  'applicantKytTxnApproved',
  'applicantKytTxnRejected',
  'applicantKytTxnAwaitingUser',
  KYT_ONHOLD_TYPE,
  'applicantKytTxnReviewed',
  'applicantKytTxnCreated',
]);

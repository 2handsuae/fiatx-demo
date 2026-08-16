/**
 * Internal Domain Events Registry
 *
 * Rules:
 * - All internal domain events must be declared here before use
 * - Emitters: Domain Services or Ingestion/Adapter layers only
 * - Subscribers: Workflow Services only
 */
export const DOMAIN_EVENTS = {
  // ── Deposit ──
  DEPOSIT_STATUS_CHANGED: {
    name: 'deposit.status.changed',
    emitter: 'DepositTransactionsService',
    subscribers: ['DepositWorkflowService'],
    payload: '{ depositId: string, oldStatus: string, newStatus: string, ownerType: string, ownerId: string, assetId: string, amount: string, payinId?: string }',
  },

  // ── Withdrawal ──
  WITHDRAWAL_CREATED: {
    name: 'withdrawal.created',
    emitter: 'WithdrawTransactionsService',
    subscribers: ['WithdrawWorkflowService'],
    payload: '{ withdrawId: string, withdrawNo: string, status: string, ownerType: string, ownerId: string, assetId: string, amount: string, traceId: string }',
  },
  WITHDRAWAL_STATUS_CHANGED: {
    name: 'withdrawal.status.changed',
    emitter: 'WithdrawTransactionsService',
    subscribers: ['WithdrawWorkflowService'],
    payload: '{ withdrawId: string, oldStatus: string, newStatus: string, ownerType: string, ownerId: string, assetId: string }',
  },
  // ── Funds Order (unified — Round 2) ──
  FUNDS_ORDER_STATUS_CHANGED: {
    name: 'funds_order.status.changed',
    emitter: 'FundsOrderService',
    subscribers: ['DepositWorkflowService', 'WithdrawWorkflowService', 'SwapWorkflowService'],
    payload:
      '{ fundsOrderId, fundsOrderNo, parent: {depositTransactionId?, withdrawTransactionId?, swapTransactionId?}, legSeq, attempt, oldStatus, newStatus, traceId? }',
  },

  // ── Customer Restriction (2026-08-16) ──
  // 只在「卡住全部能力」的便签落库时发（scope=ALL：制裁 / 行政暂停）。
  // scope < ALL 的便签（材料过期等）刻意不发 —— 设计稿 §3.5：材料过期不该把
  // 已经在路上的提现拽回来。
  CUSTOMER_RESTRICTION_OPENED: {
    name: 'customer.restriction.opened',
    emitter: 'CustomerRestrictionsService',
    subscribers: ['DepositWorkflowService', 'WithdrawWorkflowService', 'SwapWorkflowService'],
    payload:
      '{ customerId: string, restrictionNo: string, cause: string, blocksAllCapabilities: true, traceId: string }',
  },
} as const;

/** Type-safe event name accessor */
export const DomainEventNames = {
  // Deposit
  DEPOSIT_STATUS_CHANGED: DOMAIN_EVENTS.DEPOSIT_STATUS_CHANGED.name,
  // Withdrawal
  WITHDRAWAL_CREATED: DOMAIN_EVENTS.WITHDRAWAL_CREATED.name,
  WITHDRAWAL_STATUS_CHANGED: DOMAIN_EVENTS.WITHDRAWAL_STATUS_CHANGED.name,
  // Funds Order (unified — Round 2)
  FUNDS_ORDER_STATUS_CHANGED: DOMAIN_EVENTS.FUNDS_ORDER_STATUS_CHANGED.name,
  // Customer Restriction
  CUSTOMER_RESTRICTION_OPENED: DOMAIN_EVENTS.CUSTOMER_RESTRICTION_OPENED.name,
} as const;

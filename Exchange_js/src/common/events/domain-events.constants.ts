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
  // 2026-08-17 修：此前这条注册表条目是空文档——事件全仓零 emit 点，下面这份
  // payload 描述从未被满足过。现由 WithdrawTransactionsService#updateStatus 补发，
  // 字段形状对齐 SWAP_STATUS_CHANGED（三域对称），故与旧文档不同。
  WITHDRAWAL_STATUS_CHANGED: {
    name: 'withdrawal.status.changed',
    emitter: 'WithdrawTransactionsService',
    subscribers: ['MaterialRequestOrderCancelListener'],
    payload: '{ withdrawId: string, withdrawNo: string, ownerId: string, previousStatus: string, status: string, traceId: string | null }',
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

  // ── Material Request (2026-08-17) ──
  MATERIAL_REQUEST_REVIEWED: {
    name: 'material-request.reviewed',
    description:
      '一次材料下发拿到了 Sumsub 复核结果。订单域据此推进自己的合规闸门 —— ' +
      '材料账只广播事实，不替订单域做状态决定。',
  },

  // ── Swap (2026-08-17) ──
  SWAP_STATUS_CHANGED: {
    name: 'swap.status.changed',
    description:
      '兑换单状态变更。补于 2026-08-17 —— 此前三域只有充值/提现有单据级状态事件，' +
      '兑换只有资金单粒度的 FUNDS_ORDER_STATUS_CHANGED，材料账的作废监听器接不上。',
  },

  // ── Admin Login Lockout（审计上收 Task 9，2026-08-26）──
  // auth.service.ts#validateUser 在本地判定"连续失败达阈值"后 emit，不直接写审计——
  // 审计要写 actor/旅程/权限依据等编排层才拿得到的信息，实体层不该攒这些参数。
  // 由 MfaBindingWorkflowService 接住写 ADMIN_ACCOUNT_LOCK_APPLIED（Task 7 已实装该码）。
  ADMIN_LOGIN_CONSECUTIVE_FAILURE: {
    name: 'admin.login.consecutive_failure',
    emitter: 'AuthService',
    subscribers: ['MfaBindingWorkflowService'],
    payload: '{ userId: string, userNo: string, failedLoginAttempts: number }',
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
  // Material Request
  MATERIAL_REQUEST_REVIEWED: DOMAIN_EVENTS.MATERIAL_REQUEST_REVIEWED.name,
  // Swap
  SWAP_STATUS_CHANGED: DOMAIN_EVENTS.SWAP_STATUS_CHANGED.name,
  // Admin Login Lockout
  ADMIN_LOGIN_CONSECUTIVE_FAILURE: DOMAIN_EVENTS.ADMIN_LOGIN_CONSECUTIVE_FAILURE.name,
} as const;

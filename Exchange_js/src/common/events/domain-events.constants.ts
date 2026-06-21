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
  PAYIN_CREATED: {
    name: 'payin.created',
    emitter: 'PayinsService',
    subscribers: ['DepositWorkflowService'],
    payload: '{ payinId: string, status: string }',
  },
  PAYIN_STATUS_CHANGED: {
    name: 'payin.status.changed',
    emitter: 'PayinsService',
    subscribers: ['DepositWorkflowService'],
    payload: '{ payinId: string, oldStatus: string, newStatus: string, simulationMode?: string }',
  },
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
  WITHDRAWAL_KYT_UPDATED: {
    name: 'withdrawal.kyt.updated',
    emitter: 'WithdrawTransactionsService',
    subscribers: ['WithdrawWorkflowService'],
    payload: '{ withdrawId: string, kytStatus: string, phase: number }',
  },
  WITHDRAWAL_TRAVELRULE_UPDATED: {
    name: 'withdrawal.travelrule.updated',
    emitter: 'WithdrawTransactionsService',
    subscribers: ['WithdrawWorkflowService'],
    payload: '{ withdrawId: string, travelRuleStatus: string }',
  },
  PAYOUT_CREATED: {
    name: 'payout.created',
    emitter: 'PayoutsService',
    subscribers: ['WithdrawWorkflowService'],
    payload: '{ payoutId: string, withdrawId: string, type: string, status: string }',
  },
  PAYOUT_STATUS_CONFIRMED: {
    name: 'payout.status.confirmed',
    emitter: 'PayoutsService',
    subscribers: ['WithdrawWorkflowService'],
    payload: '{ payoutId: string, withdrawId: string, txHash: string }',
  },

  // ── Funds Layer (V7) ──
  FUNDSFLOW_STATUS_CHANGED: {
    name: 'fundsflow.status.changed',
    emitter: 'FundsFlowService',
    subscribers: ['InternalTransferWorkflowService', 'EodSettlementWorkflowService', 'FiatSettlementWorkflowService'],
    payload: '{ fundsFlowId: string, internalTransferId: string, oldStatus: string, newStatus: string, operatorId?: string }',
  },
  INTERNALTRANSFER_COMPLETED: {
    name: 'internaltransfer.completed',
    emitter: 'InternalTransferService',
    subscribers: [],
    payload: '{ internalTransferId: string, pathLabel: string }',
  },

  // ── Swap ──
  SWAP_SUCCEEDED: {
    name: 'swap.succeeded',
    emitter: 'SwapWorkflowService',
    subscribers: ['FiatSettlementWorkflowService'],
    payload: '{ swapId: string, swapNo: string, ownerId: string }',
  },
} as const;

/** Type-safe event name accessor */
export const DomainEventNames = {
  // Deposit
  PAYIN_CREATED: DOMAIN_EVENTS.PAYIN_CREATED.name,
  PAYIN_STATUS_CHANGED: DOMAIN_EVENTS.PAYIN_STATUS_CHANGED.name,
  DEPOSIT_STATUS_CHANGED: DOMAIN_EVENTS.DEPOSIT_STATUS_CHANGED.name,
  // Withdrawal
  WITHDRAWAL_CREATED: DOMAIN_EVENTS.WITHDRAWAL_CREATED.name,
  WITHDRAWAL_STATUS_CHANGED: DOMAIN_EVENTS.WITHDRAWAL_STATUS_CHANGED.name,
  WITHDRAWAL_KYT_UPDATED: DOMAIN_EVENTS.WITHDRAWAL_KYT_UPDATED.name,
  WITHDRAWAL_TRAVELRULE_UPDATED: DOMAIN_EVENTS.WITHDRAWAL_TRAVELRULE_UPDATED.name,
  PAYOUT_CREATED: DOMAIN_EVENTS.PAYOUT_CREATED.name,
  PAYOUT_STATUS_CONFIRMED: DOMAIN_EVENTS.PAYOUT_STATUS_CONFIRMED.name,
  // Funds Layer (V7)
  FUNDSFLOW_STATUS_CHANGED: DOMAIN_EVENTS.FUNDSFLOW_STATUS_CHANGED.name,
  INTERNALTRANSFER_COMPLETED: DOMAIN_EVENTS.INTERNALTRANSFER_COMPLETED.name,
  // Swap
  SWAP_SUCCEEDED: DOMAIN_EVENTS.SWAP_SUCCEEDED.name,
} as const;

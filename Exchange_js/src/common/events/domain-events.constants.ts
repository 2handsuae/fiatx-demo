/**
 * Internal Domain Events Registry
 *
 * Rules:
 * - All internal domain events must be declared here before use
 * - Emitters: Domain Services or Ingestion/Adapter layers only
 * - Subscribers: Workflow Services only
 */
export const DOMAIN_EVENTS = {
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
} as const;

/** Type-safe event name accessor */
export const DomainEventNames = {
  PAYIN_CREATED: DOMAIN_EVENTS.PAYIN_CREATED.name,
  PAYIN_STATUS_CHANGED: DOMAIN_EVENTS.PAYIN_STATUS_CHANGED.name,
  DEPOSIT_STATUS_CHANGED: DOMAIN_EVENTS.DEPOSIT_STATUS_CHANGED.name,
} as const;

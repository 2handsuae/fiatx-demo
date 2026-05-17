/**
 * Internal Domain Events Registry
 *
 * Rules:
 * - All internal domain events must be declared here before use
 * - Emitters: Domain Services or Ingestion/Adapter layers only
 * - Subscribers: Workflow Services only
 */
export const DOMAIN_EVENTS = {
  ASSET_PROVISIONED: {
    name: 'asset.provisioned',
    emitter: 'AssetListingWorkflowService',
    subscribers: ['TbAccountBatchService (to be refactored to workflow in Batch 2)'],
    payload: '{ assetId: string, assetNo: string, assetCode: string, tbLedgerId: number }',
  },
} as const;

/** Type-safe event name accessor */
export const DomainEventNames = {
  ASSET_PROVISIONED: DOMAIN_EVENTS.ASSET_PROVISIONED.name,
} as const;

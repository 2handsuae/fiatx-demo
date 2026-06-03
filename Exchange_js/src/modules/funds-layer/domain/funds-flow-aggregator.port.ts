import { Prisma } from '@prisma/client';

/**
 * Injection seam decoupling FundsFlowService from the aggregate-level
 * InternalTransferService (built in Task 1.2). FundsFlowService depends on this
 * abstract port; the funds-layer module binds it to the concrete
 * InternalTransferService. This avoids a circular dependency without forwardRef
 * (InternalTransferService implements the port and does NOT depend on
 * FundsFlowService).
 */
export abstract class FundsFlowAggregatorPort {
  abstract syncStatusFromFunds(
    internalTransactionId: string,
    operatorId?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ status: string }>;
}

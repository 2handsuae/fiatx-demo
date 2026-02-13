import { DepositTransactionStatus } from '../dto/deposit-transaction.dto';

export class DepositStatusChangedEvent {
  constructor(
    public readonly depositId: string,
    public readonly oldStatus: DepositTransactionStatus,
    public readonly newStatus: DepositTransactionStatus,
    public readonly ownerType: string,
    public readonly ownerId: string,
    public readonly assetId: string,
    public readonly amount: string,
    public readonly payinId?: string | null,
  ) {}
}

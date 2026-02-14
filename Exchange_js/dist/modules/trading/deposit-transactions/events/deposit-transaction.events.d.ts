import { DepositTransactionStatus } from '../dto/deposit-transaction.dto';
export declare class DepositStatusChangedEvent {
    readonly depositId: string;
    readonly oldStatus: DepositTransactionStatus;
    readonly newStatus: DepositTransactionStatus;
    readonly ownerType: string;
    readonly ownerId: string;
    readonly assetId: string;
    readonly amount: string;
    readonly payinId?: string | null | undefined;
    constructor(depositId: string, oldStatus: DepositTransactionStatus, newStatus: DepositTransactionStatus, ownerType: string, ownerId: string, assetId: string, amount: string, payinId?: string | null | undefined);
}

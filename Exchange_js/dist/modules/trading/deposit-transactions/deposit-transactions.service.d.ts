import { PrismaService } from '../../../core/prisma/prisma.service';
import { DepositTransactionQueryDto, UpdateDepositTransactionStatusDto } from './dto/deposit-transaction.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
export declare class DepositTransactionsService {
    private prisma;
    private eventEmitter;
    private readonly logger;
    constructor(prisma: PrismaService, eventEmitter: EventEmitter2);
    private assertComplianceBeforeSuccess;
    findAll(query: DepositTransactionQueryDto): Promise<{
        items: any;
        total: any;
    }>;
    findOne(id: string): Promise<any>;
    updateStatus(id: string, dto: UpdateDepositTransactionStatusDto): Promise<any>;
    private getNextStatus;
    createFromPayin(amount: string, assetId: string, toWalletId: string, txHash?: string, fromAddress?: string, payinId?: string): Promise<any>;
    createRandom(): Promise<any>;
}

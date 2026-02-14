import { PrismaService } from '../../../core/prisma/prisma.service';
import { SwapTransactionQueryDto, SwapTransactionStatus } from './dto/swap-transaction.dto';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
export declare class SwapTransactionsService {
    private prisma;
    private eventEmitter;
    private readonly logger;
    private readonly AED_USD_RATE;
    constructor(prisma: PrismaService, eventEmitter: EventEmitter2);
    create(dto: {
        ownerType: string;
        ownerId: string;
        fromAssetId: string;
        fromAmount: number;
        toAssetId: string;
        toAmount: number;
        exchangeRate: number;
    }): Promise<any>;
    updateStatus(id: string, newStatus: SwapTransactionStatus, operatorId?: string, reason?: string): Promise<any>;
    fetchMarketRate(fromCode: string, toCode: string): Promise<Prisma.Decimal>;
    preview(dto: {
        fromAssetId: string;
        fromAmount: number;
        toAssetId: string;
    }): Promise<{
        fromAssetId: any;
        fromAssetCode: any;
        fromAmount: number;
        toAssetId: any;
        toAssetCode: any;
        toAmount: number;
        exchangeRate: number;
    }>;
    findAll(query: SwapTransactionQueryDto): Promise<{
        items: any;
        total: any;
    }>;
    findOne(id: string): Promise<any>;
}

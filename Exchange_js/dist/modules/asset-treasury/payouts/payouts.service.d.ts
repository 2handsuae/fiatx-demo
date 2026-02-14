import { PrismaService } from '../../../core/prisma/prisma.service';
import { PayoutQueryDto, UpdatePayoutStatusDto, CreatePayoutDto } from './dto/payout.dto';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
export declare class PayoutsService {
    private prisma;
    private eventEmitter;
    private readonly logger;
    constructor(prisma: PrismaService, eventEmitter: EventEmitter2);
    private generatePayoutId;
    findAll(query: PayoutQueryDto): Promise<{
        items: any;
        total: any;
    }>;
    findOne(id: string): Promise<any>;
    create(dto: CreatePayoutDto, operatorId: string, tx?: Prisma.TransactionClient): Promise<any>;
    updateStatus(id: string, dto: UpdatePayoutStatusDto, operatorId: string, tx?: Prisma.TransactionClient): Promise<any>;
    createMock(operatorId: string): Promise<any[]>;
}

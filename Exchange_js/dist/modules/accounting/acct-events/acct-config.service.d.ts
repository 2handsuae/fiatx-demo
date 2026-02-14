import { OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
export declare class AcctConfigService implements OnModuleInit {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    onModuleInit(): Promise<void>;
    private cleanupRejectedDepositEvents;
    private validateDepositEventContract;
    syncDefaults(): Promise<{
        success: boolean;
        message: string;
    }>;
}

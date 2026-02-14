import { PrismaService } from '../../../core/prisma/prisma.service';
export declare class AcctConfigService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    syncDefaults(): Promise<{
        success: boolean;
        message: string;
    }>;
}

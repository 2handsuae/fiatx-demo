import { PrismaService } from '../../../core/prisma/prisma.service';
export declare class TreasuryService {
    private prisma;
    constructor(prisma: PrismaService);
    getCustomerAssets(customerId: string): Promise<{
        assetId: unknown;
        assetCode: any;
        assetType: any;
        clientCredit: number;
        lockedBalance: number;
        walletId: any;
        walletBalance: any;
    }[]>;
}

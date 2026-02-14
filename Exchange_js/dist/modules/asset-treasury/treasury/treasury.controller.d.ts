import { TreasuryService } from './treasury.service';
export declare class TreasuryController {
    private readonly treasuryService;
    constructor(treasuryService: TreasuryService);
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

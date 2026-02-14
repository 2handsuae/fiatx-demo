export declare enum RateSourceType {
    API = "API",
    MANUAL = "MANUAL"
}
export declare enum LiquidityConfigStatus {
    ACTIVE = "ACTIVE",
    INACTIVE = "INACTIVE"
}
export declare class CreateLiquidityConfigDto {
    lpId: string;
    fromAssetId: string;
    toAssetId: string;
    rateSourceType: RateSourceType;
    feePercent: number;
    feeFixedAmount: number;
    feeAssetId?: string;
    minFromAmount?: number;
    maxFromAmount?: number;
}
export declare class UpdateLiquidityConfigDto {
    rateSourceType?: RateSourceType;
    feePercent?: number;
    feeFixedAmount?: number;
    feeAssetId?: string;
    minFromAmount?: number;
    maxFromAmount?: number;
}
export declare class UpdateLiquidityConfigStatusDto {
    status: LiquidityConfigStatus;
}

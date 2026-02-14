export declare enum LiquidityProviderStatus {
    ACTIVE = "ACTIVE",
    INACTIVE = "INACTIVE"
}
export declare class CreateLiquidityProviderDto {
    name: string;
    email: string;
    phone?: string;
}
export declare class UpdateLiquidityProviderStatusDto {
    status: LiquidityProviderStatus;
}

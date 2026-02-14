export declare enum AssetType {
    FIAT = "FIAT",
    CRYPTO = "CRYPTO"
}
export declare enum AssetStatus {
    ACTIVE = "ACTIVE",
    DISABLED = "DISABLED"
}
export declare class CreateAssetDto {
    type: AssetType;
    code: string;
    network?: string;
    decimals: number;
    description?: string;
}
export declare class UpdateAssetStatusDto {
    status: AssetStatus;
}

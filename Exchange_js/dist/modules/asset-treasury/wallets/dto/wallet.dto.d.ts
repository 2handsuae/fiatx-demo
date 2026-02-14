export declare enum OwnerType {
    PLATFORM = "PLATFORM",
    CUSTOMER = "CUSTOMER",
    LIQUIDITY_PROVIDER = "LIQUIDITY_PROVIDER"
}
export declare enum WalletType {
    FIAT_BANK = "FIAT_BANK",
    CRYPTO_ADDRESS = "CRYPTO_ADDRESS"
}
export declare enum WalletDirection {
    INBOUND = "INBOUND",
    OUTBOUND = "OUTBOUND",
    BIDIRECTIONAL = "BIDIRECTIONAL"
}
export declare enum WalletStatus {
    ACTIVE = "ACTIVE",
    FROZEN = "FROZEN",
    DISABLED = "DISABLED"
}
export declare class CreateWalletDto {
    ownerType: OwnerType;
    ownerId?: string;
    type: WalletType;
    direction: WalletDirection;
    assetId: string;
    address?: string;
    memo?: string;
    beneficiaryName?: string;
    counterpartyVasp?: string;
    bankName?: string;
    bankAccount?: string;
    bankCode?: string;
    accountName?: string;
    iban?: string;
}
export declare class UpdateWalletStatusDto {
    status: WalletStatus;
}

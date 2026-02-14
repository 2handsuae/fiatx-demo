export declare enum PayinStatus {
    DETECTED = "DETECTED",
    CONFIRMING = "CONFIRMING",
    CONFIRMED = "CONFIRMED",
    CLEARED = "CLEARED",
    FAILED = "FAILED"
}
export declare enum PayinAction {
    CONFIRM = "confirm",
    FAIL = "fail",
    CLEAR = "clear",
    BLOCK = "block"
}
export declare enum PayinType {
    CRYPTO = "crypto",
    FIAT = "fiat"
}
export declare class UpdatePayinStatusDto {
    action: PayinAction;
}
export declare class SimulatePayinDto {
    assetId: string;
    toWalletId: string;
    type: PayinType;
}
export declare class PayinQueryDto {
    skip?: string;
    take?: string;
    type?: PayinType;
    status?: PayinStatus;
    assetId?: string;
    txHash?: string;
    depositId?: string;
}

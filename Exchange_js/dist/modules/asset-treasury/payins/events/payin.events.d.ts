import { PayinStatus, PayinType } from '../dto/payin.dto';
export declare class PayinStatusChangedEvent {
    readonly payinId: string;
    readonly oldStatus: PayinStatus;
    readonly newStatus: PayinStatus;
    readonly type: PayinType;
    readonly depositId?: string | null | undefined;
    readonly assetId?: string | undefined;
    readonly amount?: string | undefined;
    constructor(payinId: string, oldStatus: PayinStatus, newStatus: PayinStatus, type: PayinType, depositId?: string | null | undefined, assetId?: string | undefined, amount?: string | undefined);
}
export declare class PayinCreatedEvent {
    readonly payinId: string;
    readonly status: PayinStatus;
    readonly type: PayinType;
    readonly depositId?: string | null | undefined;
    readonly assetId?: string | undefined;
    readonly amount?: string | undefined;
    constructor(payinId: string, status: PayinStatus, type: PayinType, depositId?: string | null | undefined, assetId?: string | undefined, amount?: string | undefined);
}

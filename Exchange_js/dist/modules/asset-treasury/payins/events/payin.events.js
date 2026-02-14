"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PayinCreatedEvent = exports.PayinStatusChangedEvent = void 0;
class PayinStatusChangedEvent {
    constructor(payinId, oldStatus, newStatus, type, depositId, assetId, amount) {
        this.payinId = payinId;
        this.oldStatus = oldStatus;
        this.newStatus = newStatus;
        this.type = type;
        this.depositId = depositId;
        this.assetId = assetId;
        this.amount = amount;
    }
}
exports.PayinStatusChangedEvent = PayinStatusChangedEvent;
class PayinCreatedEvent {
    constructor(payinId, status, type, depositId, assetId, amount) {
        this.payinId = payinId;
        this.status = status;
        this.type = type;
        this.depositId = depositId;
        this.assetId = assetId;
        this.amount = amount;
    }
}
exports.PayinCreatedEvent = PayinCreatedEvent;
//# sourceMappingURL=payin.events.js.map
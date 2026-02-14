"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DepositStatusChangedEvent = void 0;
class DepositStatusChangedEvent {
    constructor(depositId, oldStatus, newStatus, ownerType, ownerId, assetId, amount, payinId) {
        this.depositId = depositId;
        this.oldStatus = oldStatus;
        this.newStatus = newStatus;
        this.ownerType = ownerType;
        this.ownerId = ownerId;
        this.assetId = assetId;
        this.amount = amount;
        this.payinId = payinId;
    }
}
exports.DepositStatusChangedEvent = DepositStatusChangedEvent;
//# sourceMappingURL=deposit-transaction.events.js.map
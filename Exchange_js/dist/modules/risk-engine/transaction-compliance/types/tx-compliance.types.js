"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KytScreeningStage = exports.TxSourceType = void 0;
var TxSourceType;
(function (TxSourceType) {
    TxSourceType["DEPOSIT"] = "DEPOSIT";
    TxSourceType["WITHDRAW"] = "WITHDRAW";
    TxSourceType["PAYIN"] = "PAYIN";
    TxSourceType["SWAP"] = "SWAP";
    TxSourceType["PAYOUT"] = "PAYOUT";
})(TxSourceType || (exports.TxSourceType = TxSourceType = {}));
var KytScreeningStage;
(function (KytScreeningStage) {
    KytScreeningStage["PRE_TXN"] = "PRE_TXN";
    KytScreeningStage["MAIN"] = "MAIN";
})(KytScreeningStage || (exports.KytScreeningStage = KytScreeningStage = {}));
//# sourceMappingURL=tx-compliance.types.js.map
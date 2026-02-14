"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_COA = void 0;
exports.DEFAULT_COA = [
    { code: 'A.BANK', name: 'Bank Account (Fiat)', type: 'ASSET', status: 'ACTIVE' },
    { code: 'A.BANK_RESTRICTED', name: 'Bank Account Restricted (Fiat)', type: 'ASSET', status: 'ACTIVE' },
    { code: 'A.BANK_IN_TRANSIT', name: 'Bank Account In Transit (Fiat)', type: 'ASSET', status: 'ACTIVE' },
    { code: 'A.CUSTODY', name: 'Custody Wallet (Crypto)', type: 'ASSET', status: 'ACTIVE' },
    { code: 'A.CUSTODY_RESTRICTED', name: 'Custody Wallet Restricted (Crypto)', type: 'ASSET', status: 'ACTIVE' },
    { code: 'A.CUSTODY_IN_TRANSIT', name: 'Custody Wallet In Transit (Crypto)', type: 'ASSET', status: 'ACTIVE' },
    { code: 'L.CLIENT_CREDIT', name: 'Client Available Balance', type: 'LIABILITY', status: 'ACTIVE' },
    { code: 'L.CLIENT_HELD', name: 'Client Frozen Balance', type: 'LIABILITY', status: 'ACTIVE' },
    { code: 'L.CLIENT_AUDIT', name: 'Client Audit Pending Balance', type: 'LIABILITY', status: 'ACTIVE' },
    { code: 'L.PLATFORM_PAYABLE', name: 'Platform Payable (Revenue)', type: 'LIABILITY', status: 'ACTIVE' },
    { code: 'L.LP_PAYABLE', name: 'Liquidity Provider Payable', type: 'LIABILITY', status: 'ACTIVE' },
    { code: 'Q.RETAINED_EARNINGS', name: 'Retained Earnings', type: 'EQUITY', status: 'ACTIVE' },
    { code: 'R.SWAP_FEE', name: 'Swap Fee Revenue', type: 'REVENUE', status: 'ACTIVE' },
    { code: 'R.WITHDRAW_FEE', name: 'Withdrawal Fee Revenue', type: 'REVENUE', status: 'ACTIVE' },
    { code: 'E.LP_COST', name: 'Liquidity Provider Cost', type: 'EXPENSE', status: 'ACTIVE' },
    { code: 'E.BANK_FEE', name: 'Bank Transfer Fee', type: 'EXPENSE', status: 'ACTIVE' },
];
//# sourceMappingURL=coa.manifest.js.map
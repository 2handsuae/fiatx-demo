"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("@nestjs/common");
const transaction_compliance_admin_controller_1 = require("./transaction-compliance-admin.controller");
const tx_compliance_types_1 = require("./types/tx-compliance.types");
describe('TransactionComplianceAdminController', () => {
    const serviceMock = {
        mockCompleteKytCase: jest.fn(),
        mockCompleteTravelRuleCase: jest.fn(),
        mockBackfill: jest.fn(),
        listKytCases: jest.fn(),
        listTravelRuleCases: jest.fn(),
    };
    let controller;
    beforeEach(() => {
        jest.clearAllMocks();
        controller = new transaction_compliance_admin_controller_1.TransactionComplianceAdminController(serviceMock);
    });
    it('should reject customer token for mockCompleteKytCase', async () => {
        expect(() => controller.mockCompleteKytCase({ user: { type: 'CUSTOMER' } }, {
            sourceType: tx_compliance_types_1.TxSourceType.DEPOSIT,
            sourceId: 'dep-1',
            screeningStage: tx_compliance_types_1.KytScreeningStage.MAIN,
        })).toThrow(common_1.ForbiddenException);
    });
    it('should allow admin token for mockCompleteKytCase', async () => {
        serviceMock.mockCompleteKytCase.mockResolvedValue({ ok: true });
        const result = await controller.mockCompleteKytCase({ user: { type: 'ADMIN' } }, {
            sourceType: tx_compliance_types_1.TxSourceType.DEPOSIT,
            sourceId: 'dep-1',
            screeningStage: tx_compliance_types_1.KytScreeningStage.MAIN,
        });
        expect(serviceMock.mockCompleteKytCase).toHaveBeenCalledWith({
            sourceType: tx_compliance_types_1.TxSourceType.DEPOSIT,
            sourceId: 'dep-1',
            screeningStage: tx_compliance_types_1.KytScreeningStage.MAIN,
        });
        expect(result).toEqual({ ok: true });
    });
    it('should reject customer token for mock backfill', async () => {
        expect(() => controller.mockBackfill({ user: { type: 'CUSTOMER' } }, {})).toThrow(common_1.ForbiddenException);
    });
    it('should allow admin to list travel rule cases', async () => {
        serviceMock.listTravelRuleCases.mockResolvedValue({ items: [], total: 0 });
        const result = await controller.listTravelRuleCases({ user: { type: 'ADMIN' } }, {
            sourceType: tx_compliance_types_1.TxSourceType.WITHDRAW,
        });
        expect(serviceMock.listTravelRuleCases).toHaveBeenCalledWith({
            sourceType: tx_compliance_types_1.TxSourceType.WITHDRAW,
        });
        expect(result.total).toBe(0);
    });
});
//# sourceMappingURL=transaction-compliance-admin.controller.spec.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const transaction_compliance_service_1 = require("./transaction-compliance.service");
const tx_compliance_types_1 = require("./types/tx-compliance.types");
describe('TransactionComplianceService', () => {
    const prismaMock = {
        kytCase: {
            upsert: jest.fn(),
            findUnique: jest.fn(),
        },
        kytCaseReport: {
            create: jest.fn(),
        },
        travelRuleCase: {
            upsert: jest.fn(),
            findUnique: jest.fn(),
        },
        travelRuleCaseReport: {
            create: jest.fn(),
        },
        depositTransaction: {
            findUnique: jest.fn(),
            update: jest.fn(),
            findMany: jest.fn(),
        },
        withdrawTransaction: {
            findUnique: jest.fn(),
            update: jest.fn(),
            findMany: jest.fn(),
        },
    };
    let service;
    beforeEach(() => {
        jest.clearAllMocks();
        service = new transaction_compliance_service_1.TransactionComplianceService(prismaMock);
    });
    it('should upsert KYT case idempotently and append reports', async () => {
        prismaMock.kytCase.upsert
            .mockResolvedValueOnce({
            id: 'kyt-1',
            sourceType: tx_compliance_types_1.TxSourceType.DEPOSIT,
            sourceId: 'dep-1',
            screeningStage: tx_compliance_types_1.KytScreeningStage.MAIN,
        })
            .mockResolvedValueOnce({
            id: 'kyt-1',
            sourceType: tx_compliance_types_1.TxSourceType.DEPOSIT,
            sourceId: 'dep-1',
            screeningStage: tx_compliance_types_1.KytScreeningStage.MAIN,
        });
        prismaMock.kytCaseReport.create
            .mockResolvedValueOnce({ id: 'r-1' })
            .mockResolvedValueOnce({ id: 'r-2' });
        await service.upsertKytCaseAndAppendReport({
            sourceType: tx_compliance_types_1.TxSourceType.DEPOSIT,
            sourceId: 'dep-1',
            screeningStage: tx_compliance_types_1.KytScreeningStage.MAIN,
            ownerType: 'CUSTOMER',
            ownerId: 'c-1',
            assetId: 'asset-1',
            status: 'PASS',
            riskScore: 12,
        });
        await service.upsertKytCaseAndAppendReport({
            sourceType: tx_compliance_types_1.TxSourceType.DEPOSIT,
            sourceId: 'dep-1',
            screeningStage: tx_compliance_types_1.KytScreeningStage.MAIN,
            ownerType: 'CUSTOMER',
            ownerId: 'c-1',
            assetId: 'asset-1',
            status: 'PASS',
            riskScore: 15,
        });
        expect(prismaMock.kytCase.upsert).toHaveBeenCalledTimes(2);
        expect(prismaMock.kytCaseReport.create).toHaveBeenCalledTimes(2);
        expect(prismaMock.kytCase.upsert.mock.calls[0][0].where).toEqual({
            sourceType_sourceId_screeningStage: {
                sourceType: tx_compliance_types_1.TxSourceType.DEPOSIT,
                sourceId: 'dep-1',
                screeningStage: tx_compliance_types_1.KytScreeningStage.MAIN,
            },
        });
    });
    it('should setup withdraw PRE+MAIN KYT and Travel in MOCK mode', async () => {
        prismaMock.withdrawTransaction.findUnique.mockResolvedValue({
            id: 'wd-1',
            ownerType: 'CUSTOMER',
            ownerId: 'c-1',
            assetId: 'asset-1',
            travelRuleRequired: false,
        });
        const modeSpy = jest
            .spyOn(service, 'getProviderMode')
            .mockReturnValue('MOCK');
        const upsertKytSpy = jest
            .spyOn(service, 'upsertKytCaseAndAppendReport')
            .mockResolvedValue({});
        const upsertTravelSpy = jest
            .spyOn(service, 'upsertTravelRuleCaseAndAppendReport')
            .mockResolvedValue({});
        const syncSpy = jest
            .spyOn(service, 'syncWithdrawSnapshotFromCases')
            .mockResolvedValue({});
        await service.ensureWithdrawComplianceCases('wd-1');
        expect(upsertKytSpy).toHaveBeenCalledTimes(2);
        expect(upsertTravelSpy).toHaveBeenCalledTimes(1);
        expect(syncSpy).toHaveBeenCalledWith('wd-1', undefined);
        const preCall = upsertKytSpy.mock.calls.find(([arg]) => arg.screeningStage === tx_compliance_types_1.KytScreeningStage.PRE_TXN);
        const mainCall = upsertKytSpy.mock.calls.find(([arg]) => arg.screeningStage === tx_compliance_types_1.KytScreeningStage.MAIN);
        expect(preCall?.[0].status).toBe('PASS');
        expect(mainCall?.[0].status).toBe('PASS');
        expect(upsertTravelSpy.mock.calls[0][0].status).toBe('NOT_REQUIRED');
        modeSpy.mockRestore();
    });
    it('should derive withdraw compliance status CLEAR when all case checks pass', async () => {
        prismaMock.kytCase.findUnique
            .mockResolvedValueOnce({
            status: 'PASS',
            providerCaseId: 'pre-1',
            riskScore: 10,
            checkedAt: new Date('2026-02-14T10:00:00.000Z'),
        })
            .mockResolvedValueOnce({
            status: 'PASS',
            providerCaseId: 'main-1',
            riskScore: 20,
            checkedAt: new Date('2026-02-14T10:01:00.000Z'),
        });
        prismaMock.travelRuleCase.findUnique.mockResolvedValue({
            status: 'NOT_REQUIRED',
            required: false,
            providerTransferId: 'trv-1',
            counterpartyVasp: null,
            checkedAt: new Date('2026-02-14T10:02:00.000Z'),
        });
        prismaMock.withdrawTransaction.update.mockResolvedValue({ id: 'wd-2' });
        await service.syncWithdrawSnapshotFromCases('wd-2');
        expect(prismaMock.withdrawTransaction.update).toHaveBeenCalledWith({
            where: { id: 'wd-2' },
            data: expect.objectContaining({
                preKytStatus: 'PASS',
                kytStatus: 'PASS',
                travelRuleRequired: false,
                travelRuleStatus: 'NOT_REQUIRED',
                complianceStatus: 'CLEAR',
            }),
        });
    });
});
//# sourceMappingURL=transaction-compliance.service.spec.js.map
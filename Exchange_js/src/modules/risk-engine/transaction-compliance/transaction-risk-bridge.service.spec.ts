import { ModuleRef } from '@nestjs/core';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ComplianceAlertsService } from '../compliance-alerts/compliance-alerts.service';
import { ComplianceIncidentsService } from '../compliance-incidents/compliance-incidents.service';
import { TransactionRiskBridgeService } from './transaction-risk-bridge.service';
import { TxSourceType } from './types/tx-compliance.types';
import { TransactionDepositWorkflowService } from '../../trading/deposit-transactions/transaction-deposit-workflow.service';
import { SwapTransactionWorkflowService } from '../../trading/swap-transactions/swap-transaction-workflow.service';

describe('TransactionRiskBridgeService', () => {
  const prismaMock: any = {
    depositTransaction: {
      findUnique: jest.fn(),
    },
    swapTransaction: {
      findUnique: jest.fn(),
    },
    workflowDecisionRecord: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    complianceIncidentAlert: {
      findUnique: jest.fn(),
    },
    complianceIncident: {
      findUnique: jest.fn(),
    },
  };
  const riskEngineServiceMock: any = {
    buildInputHash: jest.fn(),
    evaluate: jest.fn(),
    createPendingDecisionRecord: jest.fn(),
    completeDecisionRecord: jest.fn(),
  };
  const complianceAlertsServiceMock: any = {
    triggerSystemAlert: jest.fn(),
  };
  const complianceIncidentsServiceMock: any = {
    createFromAlert: jest.fn(),
    createFromAlertInTransaction: jest.fn(),
  };
  const transactionDepositWorkflowServiceMock: any = {
    execute: jest.fn(),
  };
  const swapTransactionWorkflowServiceMock: any = {
    execute: jest.fn(),
  };
  const moduleRefMock = {
    get: jest.fn(),
  };

  let service: TransactionRiskBridgeService;
  let recordSystemSpy: jest.SpiedFunction<typeof AuditLogsService.prototype.recordSystem>;

  beforeEach(() => {
    jest.clearAllMocks();
    recordSystemSpy = jest
      .spyOn(AuditLogsService.prototype, 'recordSystem')
      .mockResolvedValue({} as any);
    prismaMock.workflowDecisionRecord.findFirst.mockResolvedValue(null);
    prismaMock.workflowDecisionRecord.findUnique.mockResolvedValue(null);
    prismaMock.complianceIncidentAlert.findUnique.mockResolvedValue(null);
    riskEngineServiceMock.buildInputHash.mockReturnValue('hash-1');
    moduleRefMock.get.mockImplementation((token: unknown) => {
      if (token === ComplianceAlertsService) {
        return complianceAlertsServiceMock;
      }
      if (token === ComplianceIncidentsService) {
        return complianceIncidentsServiceMock;
      }
      if (token === TransactionDepositWorkflowService) {
        return transactionDepositWorkflowServiceMock;
      }
      if (token === SwapTransactionWorkflowService) {
        return swapTransactionWorkflowServiceMock;
      }
      return null;
    });
    service = new TransactionRiskBridgeService(
      prismaMock as any,
      riskEngineServiceMock as any,
      moduleRefMock as unknown as ModuleRef,
    );
  });

  const buildSwap = (overrides: Record<string, unknown> = {}) => ({
    id: 'swap-1',
    swapNo: 'SWP0001',
    quoteId: 'quote-1',
    quoteNo: 'QTE0001',
    ownerType: 'CUSTOMER',
    ownerId: 'customer-1',
    ownerNo: 'CU0001',
    status: 'PENDING_COMPLIANCE',
    fromAssetId: 'asset-usdt',
    fromAssetCode: 'USDT',
    fromAmount: '1000.00',
    toAssetId: 'asset-btc',
    toAssetCode: 'BTC',
    toAmount: '0.01000000',
    netToAmount: '0.01000000',
    feeAmount: '0',
    feeCurrency: 'BTC',
    exchangeRate: '100000.00',
    customer: {
      id: 'customer-1',
      customerNo: 'CU0001',
      amlRiskTier: 'LOW',
      investorClassification: 'RETAIL',
    },
    ...overrides,
  });

  it('should flag deposit from alert when KYT REVIEW only upserts alert', async () => {
    prismaMock.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-1',
      depositNo: 'DEP0001',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-1',
      assetId: 'asset-1',
      kytStatus: 'REVIEW',
      travelRuleStatus: 'NOT_REQUIRED',
      travelRuleRequired: false,
    });
    riskEngineServiceMock.evaluate.mockResolvedValue({
      decisionRecordId: 'decision-1',
      decision: 'REVIEW',
      recommendedActions: [{ type: 'UPSERT_ALERT' }],
      reasonCodes: ['TX_KYT_REVIEW_REQUIRED'],
    });
    complianceAlertsServiceMock.triggerSystemAlert.mockResolvedValue({
      id: 'alert-1',
      alertNo: 'ALT0001',
    });
    transactionDepositWorkflowServiceMock.execute.mockResolvedValue({
      applied: true,
      transitionCode: 'TX_DEPOSIT_FLAG_TO_UNDER_REVIEW',
    });

    await service.handleDepositKytUpdate({
      depositId: 'dep-1',
      sourceType: TxSourceType.DEPOSIT,
      sourceId: 'dep-1',
      status: 'REVIEW',
      screeningStage: 'MAIN',
      aggregate: {
        derivedComplianceStatus: 'HOLD',
        mainKytCase: { id: 'kyt-1', caseNo: 'KYT0001', status: 'REVIEW' },
      },
    });

    expect(complianceAlertsServiceMock.triggerSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionRecommendation: 'REVIEW',
        decision: null,
      }),
      undefined,
    );
    expect(transactionDepositWorkflowServiceMock.execute).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        depositId: 'dep-1',
        source: 'ALERT',
        sourceId: 'alert-1',
        workflowAction: 'FLAG',
      }),
    );
  });

  it('should flag deposit from case when KYT FAIL auto-escalates case', async () => {
    prismaMock.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-1',
      depositNo: 'DEP0001',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-1',
      assetId: 'asset-1',
      kytStatus: 'FAIL',
      travelRuleStatus: 'NOT_REQUIRED',
      travelRuleRequired: false,
    });
    riskEngineServiceMock.evaluate.mockResolvedValue({
      decisionRecordId: 'decision-1',
      decision: 'REJECT',
      recommendedActions: [{ type: 'UPSERT_ALERT' }, { type: 'AUTO_ESCALATE_CASE' }],
      reasonCodes: ['TX_KYT_FAIL'],
    });
    complianceAlertsServiceMock.triggerSystemAlert.mockResolvedValue({
      id: 'alert-1',
      alertNo: 'ALT0001',
    });
    complianceIncidentsServiceMock.createFromAlert.mockResolvedValue({
      id: 'case-1',
      incidentNo: 'CAS0001',
    });
    transactionDepositWorkflowServiceMock.execute.mockResolvedValue({
      applied: true,
      transitionCode: 'TX_DEPOSIT_FLAG_TO_UNDER_REVIEW',
    });

    await service.handleDepositKytUpdate({
      depositId: 'dep-1',
      sourceType: TxSourceType.DEPOSIT,
      sourceId: 'dep-1',
      status: 'FAIL',
      screeningStage: 'MAIN',
      aggregate: {
        derivedComplianceStatus: 'REJECT',
        mainKytCase: { id: 'kyt-1', caseNo: 'KYT0001', status: 'FAIL' },
      },
    });

    expect(transactionDepositWorkflowServiceMock.execute).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        depositId: 'dep-1',
        source: 'CASE',
        sourceId: 'case-1',
        caseId: 'case-1',
        workflowAction: 'FLAG',
      }),
    );
  });

  it('should skip final review until both KYT and Travel Rule are terminal', async () => {
    prismaMock.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-1',
      depositNo: 'DEP0001',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-1',
      assetId: 'asset-1',
      kytStatus: 'REVIEW',
      travelRuleStatus: 'PENDING',
      travelRuleRequired: true,
    });

    const result = await service.handleDepositFinalReviewIfReady({
      depositId: 'dep-1',
      sourceType: TxSourceType.DEPOSIT,
      sourceId: 'dep-1',
      triggerSource: 'KYT',
      triggerStatus: 'REVIEW',
      aggregate: {
        derivedComplianceStatus: 'HOLD',
        mainKytCase: { id: 'kyt-1', caseNo: 'KYT0001', status: 'REVIEW' },
        travelRuleCase: {
          id: 'trv-1',
          caseNo: 'TRV0001',
          status: 'PENDING',
          required: true,
        },
      },
    });

    expect(result).toEqual({
      skipped: true,
      skipReason: 'FINAL_REVIEW_NOT_READY',
    });
    expect(riskEngineServiceMock.evaluate).not.toHaveBeenCalled();
    expect(complianceAlertsServiceMock.triggerSystemAlert).not.toHaveBeenCalled();
  });

  it('should skip final review when travel rule evidence container is missing', async () => {
    prismaMock.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-1',
      depositNo: 'DEP0001',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-1',
      assetId: 'asset-1',
      kytStatus: 'REVIEW',
      travelRuleStatus: 'NOT_REQUIRED',
      travelRuleRequired: false,
    });

    const result = await service.handleDepositFinalReviewIfReady({
      depositId: 'dep-1',
      sourceType: TxSourceType.DEPOSIT,
      sourceId: 'dep-1',
      triggerSource: 'KYT',
      triggerStatus: 'REVIEW',
      aggregate: {
        derivedComplianceStatus: 'HOLD',
        mainKytCase: { id: 'kyt-1', caseNo: 'KYT0001', status: 'REVIEW' },
        travelRuleCase: null,
      },
    });

    expect(result).toEqual({
      skipped: true,
      skipReason: 'FINAL_REVIEW_NOT_READY',
    });
    expect(riskEngineServiceMock.evaluate).not.toHaveBeenCalled();
    expect(complianceAlertsServiceMock.triggerSystemAlert).not.toHaveBeenCalled();
  });

  it('should create one pending final deposit decision record when both responses are terminal', async () => {
    prismaMock.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-1',
      depositNo: 'DEP0001',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-1',
      assetId: 'asset-1',
      kytStatus: 'PASS',
      travelRuleStatus: 'REJECTED',
      travelRuleRequired: true,
    });
    riskEngineServiceMock.createPendingDecisionRecord.mockResolvedValue({
      decisionRecordId: 'decision-final-1',
      status: 'CREATED',
      decision: null,
    });

    const result = await service.handleDepositFinalReviewIfReady({
      depositId: 'dep-1',
      sourceType: TxSourceType.DEPOSIT,
      sourceId: 'dep-1',
      triggerSource: 'TRAVEL_RULE',
      triggerStatus: 'REJECTED',
      aggregate: {
        derivedComplianceStatus: 'REJECT',
        mainKytCase: { id: 'kyt-1', caseNo: 'KYT0001', status: 'PASS' },
        travelRuleCase: {
          id: 'trv-1',
          caseNo: 'TRV0001',
          status: 'REJECTED',
          required: true,
        },
      },
    });

    expect(riskEngineServiceMock.createPendingDecisionRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        contextType: 'TX_DEPOSIT_FINAL',
        subjectId: 'dep-1',
      }),
      undefined,
    );
    expect(complianceAlertsServiceMock.triggerSystemAlert).not.toHaveBeenCalled();
    expect(transactionDepositWorkflowServiceMock.execute).not.toHaveBeenCalled();
    expect(result).toEqual({
      skipped: false,
      decisionRecordId: 'decision-final-1',
      decision: null,
    });
  });

  it('should create one pending direct final deposit decision record after payin confirmed', async () => {
    prismaMock.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-fiat-low-1',
      depositNo: 'DEP-FIAT-LOW-1',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-fiat-1',
      assetId: 'asset-fiat-1',
      kytStatus: 'PASS',
      travelRuleStatus: 'NOT_REQUIRED',
      travelRuleRequired: false,
    });
    riskEngineServiceMock.createPendingDecisionRecord.mockResolvedValue({
      decisionRecordId: 'decision-fiat-low-1',
      status: 'CREATED',
      decision: null,
    });

    const result = await service.handleDirectDepositFinalReview({
      depositId: 'dep-fiat-low-1',
      sourceType: TxSourceType.DEPOSIT,
      sourceId: 'dep-fiat-low-1',
      triggerStatus: 'PAYIN_CONFIRMED',
      kytStatus: 'PASS',
      travelRuleRequired: false,
      travelRuleStatus: 'NOT_REQUIRED',
    });

    expect(riskEngineServiceMock.createPendingDecisionRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        contextType: 'TX_DEPOSIT_FINAL',
        subjectId: 'dep-fiat-low-1',
      }),
      undefined,
    );
    expect(result).toEqual({
      skipped: false,
      decisionRecordId: 'decision-fiat-low-1',
      decision: null,
    });
  });

  it('should auto-clear deposit when manual simulation is LOW', async () => {
    prismaMock.workflowDecisionRecord.findUnique.mockResolvedValue({
      id: 'decision-fiat-low-1',
      status: 'CREATED',
      contextType: 'TX_DEPOSIT_FINAL',
      subjectId: 'dep-fiat-low-1',
    });
    prismaMock.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-fiat-low-1',
      depositNo: 'DEP-FIAT-LOW-1',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-fiat-1',
      assetId: 'asset-fiat-1',
      kytStatus: 'PASS',
      travelRuleStatus: 'NOT_REQUIRED',
      travelRuleRequired: false,
    });
    riskEngineServiceMock.completeDecisionRecord.mockResolvedValue({
      decisionRecordId: 'decision-fiat-low-1',
      decision: 'APPROVE',
      recommendedActions: [],
      reasonCodes: ['TX_DEPOSIT_LOW_RISK_AUTO_CLEAR'],
    });
    transactionDepositWorkflowServiceMock.execute.mockResolvedValue({
      applied: true,
      transitionCode: 'TX_DEPOSIT_CLEAR_TO_SUCCESS',
    });

    const result = await service.simulateDepositFinalReview({
      decisionRecordId: 'decision-fiat-low-1',
      riskLevel: 'LOW',
      riskReason: 'TX_DEPOSIT_LOW_RISK_AUTO_CLEAR',
    });

    expect(riskEngineServiceMock.completeDecisionRecord).toHaveBeenCalledWith(
      'decision-fiat-low-1',
      expect.objectContaining({
        contextType: 'TX_DEPOSIT_FINAL',
        subjectId: 'dep-fiat-low-1',
        signals: expect.objectContaining({
          simulationMode: 'MANUAL',
          riskBand: 'LOW',
          riskReason: 'TX_DEPOSIT_LOW_RISK_AUTO_CLEAR',
        }),
      }),
      undefined,
    );
    expect(transactionDepositWorkflowServiceMock.execute).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        depositId: 'dep-fiat-low-1',
        workflowAction: 'CLEAR',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        skipped: false,
        decision: 'APPROVE',
        alertId: null,
        caseId: null,
      }),
    );
    expect(prismaMock.workflowDecisionRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'decision-fiat-low-1' },
        data: expect.objectContaining({
          outputs: expect.stringContaining(
            '"updatedSubject":{"id":"dep-fiat-low-1","sourceType":"DEPOSIT","subjectNo":"DEP-FIAT-LOW-1"',
          ),
        }),
      }),
    );
  });

  it('should create deposit alert when manual simulation is MEDIUM', async () => {
    prismaMock.workflowDecisionRecord.findUnique.mockResolvedValue({
      id: 'decision-fiat-medium-1',
      status: 'CREATED',
      contextType: 'TX_DEPOSIT_FINAL',
      subjectId: 'dep-fiat-medium-1',
    });
    prismaMock.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-fiat-medium-1',
      depositNo: 'DEP-FIAT-MEDIUM-1',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-fiat-1',
      assetId: 'asset-fiat-1',
      kytStatus: 'PASS',
      travelRuleStatus: 'NOT_REQUIRED',
      travelRuleRequired: false,
    });
    riskEngineServiceMock.completeDecisionRecord.mockResolvedValue({
      decisionRecordId: 'decision-fiat-medium-1',
      decision: 'REVIEW',
      recommendedActions: [{ type: 'UPSERT_ALERT', payload: { recommendation: 'REVIEW' } }],
      reasonCodes: ['LARGE_DEPOSIT_PROFILE_MISMATCH'],
    });
    complianceAlertsServiceMock.triggerSystemAlert.mockResolvedValue({
      id: 'alert-fiat-medium-1',
      alertNo: 'ALT-FIAT-MEDIUM-1',
    });
    transactionDepositWorkflowServiceMock.execute.mockResolvedValue({
      applied: true,
      transitionCode: 'TX_DEPOSIT_FLAG_TO_UNDER_REVIEW',
    });

    const result = await service.simulateDepositFinalReview({
      decisionRecordId: 'decision-fiat-medium-1',
      riskLevel: 'MEDIUM',
      riskReason: 'LARGE_DEPOSIT_PROFILE_MISMATCH',
    });

    expect(complianceAlertsServiceMock.triggerSystemAlert).toHaveBeenCalled();
    expect(complianceAlertsServiceMock.triggerSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          riskBand: 'MEDIUM',
          riskReason: 'LARGE_DEPOSIT_PROFILE_MISMATCH',
        }),
      }),
      undefined,
    );
    const depositAlertMetadata =
      complianceAlertsServiceMock.triggerSystemAlert.mock.calls[0][0].metadata;
    expect(depositAlertMetadata).not.toHaveProperty('simulationRiskLevel');
    expect(depositAlertMetadata).not.toHaveProperty('simulationRiskReason');
    expect(transactionDepositWorkflowServiceMock.execute).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        depositId: 'dep-fiat-medium-1',
        source: 'ALERT',
        sourceId: 'alert-fiat-medium-1',
        workflowAction: 'FLAG',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        skipped: false,
        decision: 'REVIEW',
        alertId: 'alert-fiat-medium-1',
        caseId: null,
      }),
    );
  });

  it('should create deposit alert and case when manual simulation is HIGH', async () => {
    prismaMock.workflowDecisionRecord.findUnique.mockResolvedValue({
      id: 'decision-fiat-high-1',
      status: 'CREATED',
      contextType: 'TX_DEPOSIT_FINAL',
      subjectId: 'dep-fiat-high-1',
    });
    prismaMock.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-fiat-high-1',
      depositNo: 'DEP-FIAT-HIGH-1',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-fiat-1',
      assetId: 'asset-fiat-1',
      kytStatus: 'PASS',
      travelRuleStatus: 'NOT_REQUIRED',
      travelRuleRequired: false,
    });
    riskEngineServiceMock.completeDecisionRecord.mockResolvedValue({
      decisionRecordId: 'decision-fiat-high-1',
      decision: 'REVIEW',
      recommendedActions: [{ type: 'UPSERT_ALERT' }, { type: 'AUTO_ESCALATE_CASE' }],
      reasonCodes: ['SANCTIONS_HIT'],
    });
    complianceAlertsServiceMock.triggerSystemAlert.mockResolvedValue({
      id: 'alert-fiat-high-1',
      alertNo: 'ALT-FIAT-HIGH-1',
    });
    complianceIncidentsServiceMock.createFromAlert.mockResolvedValue({
      id: 'case-fiat-high-1',
      incidentNo: 'CAS-FIAT-HIGH-1',
    });
    transactionDepositWorkflowServiceMock.execute.mockResolvedValue({
      applied: true,
      transitionCode: 'TX_DEPOSIT_FLAG_TO_UNDER_REVIEW',
    });

    const result = await service.simulateDepositFinalReview({
      decisionRecordId: 'decision-fiat-high-1',
      riskLevel: 'HIGH',
      riskReason: 'SANCTIONS_HIT',
    });

    expect(complianceIncidentsServiceMock.createFromAlert).toHaveBeenCalledWith(
      'alert-fiat-high-1',
      expect.objectContaining({
        decisionRecordIds: ['decision-fiat-high-1'],
      }),
      expect.any(Object),
    );
    expect(transactionDepositWorkflowServiceMock.execute).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        depositId: 'dep-fiat-high-1',
        source: 'CASE',
        sourceId: 'case-fiat-high-1',
        workflowAction: 'FLAG',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        skipped: false,
        decision: 'REVIEW',
        alertId: 'alert-fiat-high-1',
        caseId: 'case-fiat-high-1',
      }),
    );
  });

  it('should create one pending swap decision record and wait for manual simulation', async () => {
    prismaMock.swapTransaction.findUnique.mockResolvedValue(buildSwap());
    riskEngineServiceMock.createPendingDecisionRecord.mockResolvedValue({
      decisionRecordId: 'decision-swap-pending-1',
      status: 'CREATED',
      decision: null,
    });

    const result = await service.handleSwapFinalReview({
      swapId: 'swap-1',
      sourceType: TxSourceType.SWAP,
      sourceId: 'swap-1',
    });

    expect(riskEngineServiceMock.createPendingDecisionRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        contextType: 'TX_SWAP_FINAL',
        subjectType: 'SWAP',
        subjectId: 'swap-1',
      }),
      undefined,
    );
    expect(complianceAlertsServiceMock.triggerSystemAlert).not.toHaveBeenCalled();
    expect(swapTransactionWorkflowServiceMock.execute).not.toHaveBeenCalled();
    expect(result).toEqual({
      skipped: false,
      decisionRecordId: 'decision-swap-pending-1',
      decision: null,
    });
  });

  it('should auto-clear swap when manual simulation is LOW', async () => {
    prismaMock.workflowDecisionRecord.findUnique.mockResolvedValue({
      id: 'decision-swap-approve-1',
      status: 'CREATED',
      contextType: 'TX_SWAP_FINAL',
      subjectId: 'swap-1',
      customerId: 'customer-1',
    });
    prismaMock.swapTransaction.findUnique.mockResolvedValue(buildSwap());
    riskEngineServiceMock.completeDecisionRecord.mockResolvedValue({
      decisionRecordId: 'decision-swap-approve-1',
      decision: 'APPROVE',
      recommendedActions: [],
      reasonCodes: ['TX_SWAP_LOW_RISK_AUTO_CLEAR'],
    });
    swapTransactionWorkflowServiceMock.execute.mockResolvedValue({
      applied: true,
      transitionCode: 'TX_SWAP_CLEAR_TO_SUCCESS',
      swapId: 'swap-1',
      swapNo: 'SWP0001',
      swapStatusBefore: 'PENDING_COMPLIANCE',
      swapStatusAfter: 'SUCCESS',
    });

    const result = await service.simulateSwapFinalReview({
      decisionRecordId: 'decision-swap-approve-1',
      riskLevel: 'LOW',
      riskReason: 'TX_SWAP_LOW_RISK_AUTO_CLEAR',
    });

    expect(swapTransactionWorkflowServiceMock.execute).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        swapId: 'swap-1',
        workflowAction: 'CLEAR',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        skipped: false,
        decision: 'APPROVE',
        alertId: null,
        caseId: null,
      }),
    );
    expect(recordSystemSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowType: 'SWAP',
        traceId: 'SWAP:swap-1',
        metadata: expect.objectContaining({
          quoteId: 'quote-1',
          quoteNo: 'QTE0001',
        }),
      }),
      undefined,
    );
  });

  it('should create swap alert and flag under review when manual simulation is MEDIUM', async () => {
    prismaMock.workflowDecisionRecord.findUnique.mockResolvedValue({
      id: 'decision-swap-review-1',
      status: 'CREATED',
      contextType: 'TX_SWAP_FINAL',
      subjectId: 'swap-1',
      customerId: 'customer-1',
    });
    prismaMock.swapTransaction.findUnique.mockResolvedValue(
      buildSwap({
        customer: {
          id: 'customer-1',
          customerNo: 'CU0001',
          amlRiskTier: 'MEDIUM',
          investorClassification: 'RETAIL',
        },
      }),
    );
    riskEngineServiceMock.completeDecisionRecord.mockResolvedValue({
      decisionRecordId: 'decision-swap-review-1',
      decision: 'REVIEW',
      recommendedActions: [{ type: 'UPSERT_ALERT', payload: { recommendation: 'REVIEW' } }],
      reasonCodes: ['VELOCITY_SPIKE'],
    });
    complianceAlertsServiceMock.triggerSystemAlert.mockResolvedValue({
      id: 'alert-swap-review-1',
      alertNo: 'ALT-SWAP-1',
    });
    swapTransactionWorkflowServiceMock.execute.mockResolvedValue({
      applied: true,
      transitionCode: 'TX_SWAP_FLAG_TO_UNDER_REVIEW',
      swapId: 'swap-1',
      swapNo: 'SWP0001',
      swapStatusBefore: 'PENDING_COMPLIANCE',
      swapStatusAfter: 'UNDER_REVIEW',
    });

    const result = await service.simulateSwapFinalReview({
      decisionRecordId: 'decision-swap-review-1',
      riskLevel: 'MEDIUM',
      riskReason: 'VELOCITY_SPIKE',
    });

    expect(complianceAlertsServiceMock.triggerSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleCode: 'TX_SWAP_FINAL_REVIEW_REQUIRED',
        stage: 'REVIEW_SWAP_FINAL',
        sourceType: 'SWAP',
        sourceId: 'swap-1',
        decisionRecommendation: 'REVIEW',
        metadata: expect.objectContaining({
          riskBand: 'MEDIUM',
          riskReason: 'VELOCITY_SPIKE',
        }),
      }),
      undefined,
    );
    const mediumSwapAlertMetadata =
      complianceAlertsServiceMock.triggerSystemAlert.mock.calls[0][0].metadata;
    expect(mediumSwapAlertMetadata).not.toHaveProperty('simulationRiskLevel');
    expect(mediumSwapAlertMetadata).not.toHaveProperty('simulationRiskReason');
    expect(swapTransactionWorkflowServiceMock.execute).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        swapId: 'swap-1',
        source: 'ALERT',
        sourceId: 'alert-swap-review-1',
        workflowAction: 'FLAG',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        skipped: false,
        decision: 'REVIEW',
        alertId: 'alert-swap-review-1',
        caseId: null,
      }),
    );
    expect(prismaMock.workflowDecisionRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'decision-swap-review-1' },
        data: expect.objectContaining({
          outputs: expect.stringContaining('"alertId":"alert-swap-review-1"'),
        }),
      }),
    );
    expect(prismaMock.workflowDecisionRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'decision-swap-review-1' },
        data: expect.objectContaining({
          outputs: expect.stringContaining(
            '"updatedSubject":{"id":"swap-1","sourceType":"SWAP","subjectNo":"SWP0001"',
          ),
        }),
      }),
    );
    expect(recordSystemSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowType: 'SWAP',
        traceId: 'SWAP:swap-1',
      }),
      undefined,
    );
  });

  it('should create swap alert and case when manual simulation is HIGH', async () => {
    prismaMock.workflowDecisionRecord.findUnique.mockResolvedValue({
      id: 'decision-swap-high-1',
      status: 'CREATED',
      contextType: 'TX_SWAP_FINAL',
      subjectId: 'swap-1',
      customerId: 'customer-1',
    });
    prismaMock.swapTransaction.findUnique.mockResolvedValue(
      buildSwap({
        customer: {
          id: 'customer-1',
          customerNo: 'CU0001',
          amlRiskTier: 'HIGH',
          investorClassification: 'RETAIL',
        },
      }),
    );
    riskEngineServiceMock.completeDecisionRecord.mockResolvedValue({
      decisionRecordId: 'decision-swap-high-1',
      decision: 'REVIEW',
      recommendedActions: [{ type: 'UPSERT_ALERT' }, { type: 'AUTO_ESCALATE_CASE' }],
      reasonCodes: ['LAYERING_PATTERN'],
    });
    complianceAlertsServiceMock.triggerSystemAlert.mockResolvedValue({
      id: 'alert-swap-high-1',
      alertNo: 'ALT-SWAP-2',
    });
    complianceIncidentsServiceMock.createFromAlert.mockResolvedValue({
      id: 'case-swap-1',
      incidentNo: 'CAS-SWAP-1',
    });
    swapTransactionWorkflowServiceMock.execute.mockResolvedValue({
      applied: true,
      transitionCode: 'TX_SWAP_FLAG_TO_UNDER_REVIEW',
      swapId: 'swap-1',
      swapNo: 'SWP0001',
      swapStatusBefore: 'PENDING_COMPLIANCE',
      swapStatusAfter: 'UNDER_REVIEW',
    });

    const result = await service.simulateSwapFinalReview({
      decisionRecordId: 'decision-swap-high-1',
      riskLevel: 'HIGH',
      riskReason: 'LAYERING_PATTERN',
    });

    expect(complianceIncidentsServiceMock.createFromAlert).toHaveBeenCalledWith(
      'alert-swap-high-1',
      expect.objectContaining({
        decisionRecordIds: ['decision-swap-high-1'],
      }),
      expect.objectContaining({
        actorType: 'SYSTEM',
      }),
    );
    expect(swapTransactionWorkflowServiceMock.execute).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        swapId: 'swap-1',
        source: 'CASE',
        sourceId: 'case-swap-1',
        workflowAction: 'FLAG',
        caseId: 'case-swap-1',
      }),
    );
    const highSwapAlertMetadata =
      complianceAlertsServiceMock.triggerSystemAlert.mock.calls[0][0].metadata;
    expect(highSwapAlertMetadata).toEqual(
      expect.objectContaining({
        riskBand: 'HIGH',
        riskReason: 'LAYERING_PATTERN',
      }),
    );
    expect(highSwapAlertMetadata).not.toHaveProperty('simulationRiskLevel');
    expect(highSwapAlertMetadata).not.toHaveProperty('simulationRiskReason');
    expect(result).toEqual(
      expect.objectContaining({
        skipped: false,
        decision: 'REVIEW',
        alertId: 'alert-swap-high-1',
        caseId: 'case-swap-1',
      }),
    );
    expect(prismaMock.workflowDecisionRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'decision-swap-high-1' },
        data: expect.objectContaining({
          outputs: expect.stringContaining('"caseId":"case-swap-1"'),
        }),
      }),
    );
    expect(prismaMock.workflowDecisionRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'decision-swap-high-1' },
        data: expect.objectContaining({
          outputs: expect.stringContaining(
            '"updatedSubject":{"id":"swap-1","sourceType":"SWAP","subjectNo":"SWP0001"',
          ),
        }),
      }),
    );
    expect(recordSystemSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowType: 'SWAP',
        traceId: 'SWAP:swap-1',
      }),
      undefined,
    );
  });

  it('should reuse completed swap decision record without creating another pending record', async () => {
    prismaMock.swapTransaction.findUnique.mockResolvedValue(buildSwap());
    prismaMock.workflowDecisionRecord.findFirst.mockResolvedValue({
      id: 'decision-swap-existing-1',
      status: 'COMPLETED',
      outputDecision: 'APPROVE',
      recommendedActions: JSON.stringify([]),
      reasonCodes: JSON.stringify(['TX_SWAP_LOW_RISK_AUTO_CLEAR']),
    });

    const result = await service.handleSwapFinalReview({
      swapId: 'swap-1',
      sourceType: TxSourceType.SWAP,
      sourceId: 'swap-1',
    });

    expect(riskEngineServiceMock.createPendingDecisionRecord).not.toHaveBeenCalled();
    expect(result).toEqual({
      skipped: false,
      decisionRecordId: 'decision-swap-existing-1',
      decision: 'APPROVE',
    });
  });

  it('should skip swap final review when swap status is not eligible', async () => {
    prismaMock.swapTransaction.findUnique.mockResolvedValue(
      buildSwap({
        status: 'SUCCESS',
      }),
    );

    const result = await service.handleSwapFinalReview({
      swapId: 'swap-1',
      sourceType: TxSourceType.SWAP,
      sourceId: 'swap-1',
    });

    expect(result).toEqual({
      skipped: true,
      skipReason: 'STATUS_NOT_ELIGIBLE',
    });
    expect(riskEngineServiceMock.createPendingDecisionRecord).not.toHaveBeenCalled();
  });

  it('should skip swap final review when swap owner is unsupported', async () => {
    prismaMock.swapTransaction.findUnique.mockResolvedValue(
      buildSwap({
        ownerType: 'INTERNAL_TREASURY',
        ownerId: null,
      }),
    );

    const result = await service.handleSwapFinalReview({
      swapId: 'swap-1',
      sourceType: TxSourceType.SWAP,
      sourceId: 'swap-1',
    });

    expect(result).toEqual({
      skipped: true,
      skipReason: 'UNSUPPORTED_OWNER',
    });
    expect(riskEngineServiceMock.createPendingDecisionRecord).not.toHaveBeenCalled();
  });

  it('should keep historical withdraw precheck handler as read-only skip', async () => {
    const result = await service.handleWithdrawPrecheckReview({
      withdrawId: 'wd-legacy-1',
      sourceType: TxSourceType.WITHDRAW,
      sourceId: 'wd-legacy-1',
      triggerSource: 'PRE_KYT',
      triggerStatus: 'FINAL',
      aggregate: {
        derivedComplianceStatus: 'PENDING',
        preKytCase: { id: 'pre-1', caseNo: 'KYT-PRE-1', status: 'FINAL' },
      },
    } as any);

    expect(result).toEqual({
      skipped: true,
      skipReason: 'LEGACY_PRECHECK_READ_ONLY',
    });
  });

  it('should reject manual simulation for historical withdraw precheck review', async () => {
    await expect(
      service.simulateWithdrawPrecheckReview({
        decisionRecordId: 'decision-pre-1',
        riskLevel: 'LOW',
        riskReason: 'LEGACY_PRECHECK_READ_ONLY',
      }),
    ).rejects.toThrow('historical read-only');
  });
});

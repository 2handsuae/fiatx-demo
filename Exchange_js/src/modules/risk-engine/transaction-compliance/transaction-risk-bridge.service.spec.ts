import { ModuleRef } from '@nestjs/core';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ComplianceAlertsService } from '../compliance-alerts/compliance-alerts.service';
import { ComplianceIncidentsService } from '../compliance-incidents/compliance-incidents.service';
import { TransactionRiskBridgeService } from './transaction-risk-bridge.service';
import { TxSourceType } from './types/tx-compliance.types';
import { TransactionDepositWorkflowService } from '../../trading/deposit-transactions/transaction-deposit-workflow.service';

describe('TransactionRiskBridgeService', () => {
  const prismaMock: any = {
    depositTransaction: {
      findUnique: jest.fn(),
    },
    workflowDecisionRecord: {
      findFirst: jest.fn(),
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
  const moduleRefMock = {
    get: jest.fn(),
  };

  let service: TransactionRiskBridgeService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(AuditLogsService.prototype, 'recordSystem').mockResolvedValue({} as any);
    prismaMock.workflowDecisionRecord.findFirst.mockResolvedValue(null);
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
      return null;
    });
    service = new TransactionRiskBridgeService(
      prismaMock as any,
      riskEngineServiceMock as any,
      moduleRefMock as unknown as ModuleRef,
    );
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

  it('should create one final alert and case when both responses are terminal and final decision is reject', async () => {
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
    riskEngineServiceMock.evaluate.mockResolvedValue({
      decisionRecordId: 'decision-final-1',
      decision: 'REJECT',
      recommendedActions: [{ type: 'UPSERT_ALERT' }, { type: 'AUTO_ESCALATE_CASE' }],
      reasonCodes: ['TX_KYT_PASS', 'TX_TRAVEL_RULE_REJECTED'],
    });
    complianceAlertsServiceMock.triggerSystemAlert.mockResolvedValue({
      id: 'alert-final-1',
      alertNo: 'ALT0002',
    });
    complianceIncidentsServiceMock.createFromAlert.mockResolvedValue({
      id: 'case-final-1',
      incidentNo: 'CAS0002',
    });
    transactionDepositWorkflowServiceMock.execute.mockResolvedValue({
      applied: true,
      transitionCode: 'TX_DEPOSIT_FLAG_TO_UNDER_REVIEW',
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

    expect(riskEngineServiceMock.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        contextType: 'TX_DEPOSIT_FINAL',
        subjectId: 'dep-1',
      }),
    );
    expect(complianceAlertsServiceMock.triggerSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleCode: 'TX_DEPOSIT_FINAL_REVIEW_REQUIRED',
        stage: 'REVIEW_DEPOSIT_FINAL',
      }),
      undefined,
    );
    expect(transactionDepositWorkflowServiceMock.execute).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        depositId: 'dep-1',
        source: 'CASE',
        sourceId: 'case-final-1',
        workflowAction: 'FLAG',
      }),
    );
    expect(result.caseId).toBe('case-final-1');
  });

  it('should create one final alert without case when both responses are terminal and final decision is review', async () => {
    prismaMock.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-1',
      depositNo: 'DEP0001',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-1',
      assetId: 'asset-1',
      kytStatus: 'REVIEW',
      travelRuleStatus: 'NOT_REQUIRED',
      travelRuleRequired: false,
      payin: {
        providerTxnId: 'signal-1',
      },
    });
    (prismaMock as any).inboundTransferSignal = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'signal-1',
        simulationRiskLevel: 'MEDIUM',
        simulationRiskReason: 'KYT_ISSUE',
      }),
    };
    riskEngineServiceMock.evaluate.mockResolvedValue({
      decisionRecordId: 'decision-final-review-1',
      decision: 'REVIEW',
      recommendedActions: [{ type: 'UPSERT_ALERT', payload: { recommendation: 'REVIEW' } }],
      reasonCodes: ['TX_SIM_KYT_ISSUE', 'TX_KYT_REVIEW', 'TX_TRAVEL_RULE_NOT_REQUIRED'],
    });
    complianceAlertsServiceMock.triggerSystemAlert.mockResolvedValue({
      id: 'alert-final-review-1',
      alertNo: 'ALT0003',
    });
    transactionDepositWorkflowServiceMock.execute.mockResolvedValue({
      applied: true,
      transitionCode: 'TX_DEPOSIT_FLAG_TO_UNDER_REVIEW',
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
          status: 'NOT_REQUIRED',
          required: false,
        },
      },
    });

    expect(complianceAlertsServiceMock.triggerSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleCode: 'TX_DEPOSIT_FINAL_REVIEW_REQUIRED',
        stage: 'REVIEW_DEPOSIT_FINAL',
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
        sourceId: 'alert-final-review-1',
        workflowAction: 'FLAG',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        skipped: false,
        decision: 'REVIEW',
        alertId: 'alert-final-review-1',
        caseId: null,
      }),
    );
  });

  it('should directly approve fiat final review with low risk after payin confirmed', async () => {
    prismaMock.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-fiat-low-1',
      depositNo: 'DEP-FIAT-LOW-1',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-fiat-1',
      assetId: 'asset-fiat-1',
      kytStatus: 'PASS',
      travelRuleStatus: 'NOT_REQUIRED',
      travelRuleRequired: false,
      payin: {
        providerTxnId: 'signal-fiat-low-1',
      },
    });
    (prismaMock as any).inboundTransferSignal = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'signal-fiat-low-1',
        simulationRiskLevel: 'LOW',
        simulationRiskReason: null,
      }),
    };
    riskEngineServiceMock.evaluate.mockResolvedValue({
      decisionRecordId: 'decision-fiat-low-1',
      decision: 'APPROVE',
      recommendedActions: [],
      reasonCodes: ['TX_KYT_PASS', 'TX_TRAVEL_RULE_NOT_REQUIRED'],
    });
    transactionDepositWorkflowServiceMock.execute.mockResolvedValue({
      applied: true,
      transitionCode: 'TX_DEPOSIT_CLEAR_TO_SUCCESS',
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

    expect(riskEngineServiceMock.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        contextType: 'TX_DEPOSIT_FINAL',
        subjectId: 'dep-fiat-low-1',
        signals: expect.objectContaining({
          simulationRiskLevel: 'LOW',
          kytStatus: 'PASS',
          travelRuleStatus: 'NOT_REQUIRED',
        }),
      }),
    );
    expect(complianceAlertsServiceMock.triggerSystemAlert).not.toHaveBeenCalled();
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
  });

  it('should create a final alert for fiat medium-risk direct review', async () => {
    prismaMock.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-fiat-medium-1',
      depositNo: 'DEP-FIAT-MEDIUM-1',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-fiat-1',
      assetId: 'asset-fiat-1',
      kytStatus: 'PASS',
      travelRuleStatus: 'NOT_REQUIRED',
      travelRuleRequired: false,
      payin: {
        providerTxnId: 'signal-fiat-medium-1',
      },
    });
    (prismaMock as any).inboundTransferSignal = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'signal-fiat-medium-1',
        simulationRiskLevel: 'MEDIUM',
        simulationRiskReason: 'LARGE_DEPOSIT_PROFILE_MISMATCH',
      }),
    };
    riskEngineServiceMock.evaluate.mockResolvedValue({
      decisionRecordId: 'decision-fiat-medium-1',
      decision: 'REVIEW',
      recommendedActions: [{ type: 'UPSERT_ALERT', payload: { recommendation: 'REVIEW' } }],
      reasonCodes: [
        'TX_SIM_LARGE_DEPOSIT_PROFILE_MISMATCH',
        'TX_KYT_PASS',
        'TX_TRAVEL_RULE_NOT_REQUIRED',
      ],
    });
    complianceAlertsServiceMock.triggerSystemAlert.mockResolvedValue({
      id: 'alert-fiat-medium-1',
      alertNo: 'ALT-FIAT-MEDIUM-1',
    });
    transactionDepositWorkflowServiceMock.execute.mockResolvedValue({
      applied: true,
      transitionCode: 'TX_DEPOSIT_FLAG_TO_UNDER_REVIEW',
    });

    const result = await service.handleDirectDepositFinalReview({
      depositId: 'dep-fiat-medium-1',
      sourceType: TxSourceType.DEPOSIT,
      sourceId: 'dep-fiat-medium-1',
      triggerStatus: 'PAYIN_CONFIRMED',
      kytStatus: 'PASS',
      travelRuleRequired: false,
      travelRuleStatus: 'NOT_REQUIRED',
    });

    expect(complianceAlertsServiceMock.triggerSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleCode: 'TX_DEPOSIT_FINAL_REVIEW_REQUIRED',
        stage: 'REVIEW_DEPOSIT_FINAL',
      }),
      undefined,
    );
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

  it('should create final alert and case for fiat high-risk direct review', async () => {
    prismaMock.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-fiat-high-1',
      depositNo: 'DEP-FIAT-HIGH-1',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-fiat-1',
      assetId: 'asset-fiat-1',
      kytStatus: 'PASS',
      travelRuleStatus: 'NOT_REQUIRED',
      travelRuleRequired: false,
      payin: {
        providerTxnId: 'signal-fiat-high-1',
      },
    });
    (prismaMock as any).inboundTransferSignal = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'signal-fiat-high-1',
        simulationRiskLevel: 'HIGH',
        simulationRiskReason: 'SANCTIONS_HIT',
      }),
    };
    riskEngineServiceMock.evaluate.mockResolvedValue({
      decisionRecordId: 'decision-fiat-high-1',
      decision: 'REVIEW',
      recommendedActions: [
        { type: 'UPSERT_ALERT', payload: { recommendation: 'REVIEW' } },
        { type: 'AUTO_ESCALATE_CASE' },
      ],
      reasonCodes: ['SANCTIONS_HIT', 'TX_SIM_SANCTIONS_HIT', 'TX_KYT_PASS', 'TX_TRAVEL_RULE_NOT_REQUIRED'],
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

    const result = await service.handleDirectDepositFinalReview({
      depositId: 'dep-fiat-high-1',
      sourceType: TxSourceType.DEPOSIT,
      sourceId: 'dep-fiat-high-1',
      triggerStatus: 'PAYIN_CONFIRMED',
      kytStatus: 'PASS',
      travelRuleRequired: false,
      travelRuleStatus: 'NOT_REQUIRED',
    });

    expect(complianceAlertsServiceMock.triggerSystemAlert).toHaveBeenCalled();
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

  it('should evaluate final review only once when medium-risk evidence arrives sequentially', async () => {
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
      decisionRecordId: 'decision-final-review-1',
      decision: 'REVIEW',
      recommendedActions: [{ type: 'UPSERT_ALERT', payload: { recommendation: 'REVIEW' } }],
      reasonCodes: ['TX_SIM_KYT_ISSUE', 'TX_KYT_REVIEW', 'TX_TRAVEL_RULE_NOT_REQUIRED'],
    });
    complianceAlertsServiceMock.triggerSystemAlert.mockResolvedValue({
      id: 'alert-final-review-1',
      alertNo: 'ALT0003',
    });
    transactionDepositWorkflowServiceMock.execute.mockResolvedValue({
      applied: true,
      transitionCode: 'TX_DEPOSIT_FLAG_TO_UNDER_REVIEW',
    });

    const firstResult = await service.handleDepositFinalReviewIfReady({
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
    const secondResult = await service.handleDepositFinalReviewIfReady({
      depositId: 'dep-1',
      sourceType: TxSourceType.DEPOSIT,
      sourceId: 'dep-1',
      triggerSource: 'TRAVEL_RULE',
      triggerStatus: 'NOT_REQUIRED',
      aggregate: {
        derivedComplianceStatus: 'HOLD',
        mainKytCase: { id: 'kyt-1', caseNo: 'KYT0001', status: 'REVIEW' },
        travelRuleCase: {
          id: 'trv-1',
          caseNo: 'TRV0001',
          status: 'NOT_REQUIRED',
          required: false,
        },
      },
    });

    expect(firstResult).toEqual({
      skipped: true,
      skipReason: 'FINAL_REVIEW_NOT_READY',
    });
    expect(riskEngineServiceMock.evaluate).toHaveBeenCalledTimes(1);
    expect(complianceAlertsServiceMock.triggerSystemAlert).toHaveBeenCalledTimes(1);
    expect(secondResult).toEqual(
      expect.objectContaining({
        skipped: false,
        decision: 'REVIEW',
        alertId: 'alert-final-review-1',
        caseId: null,
      }),
    );
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { DepositWorkflowService } from './deposit-workflow.service';
import { DepositTransactionsService } from './deposit-transactions.service';
import { FundsOrderService } from '../../funds-orders/funds-order.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TbEvidenceService } from '../../accounting/tigerbeetle/tb-evidence.service';
import { WithdrawalAddressService } from '../../asset-treasury/withdrawal-addresses/withdrawal-address.service';
import { SUMSUB_TXN_CLIENT } from '../../deposit-sumsub/sumsub-txn-client.interface';
import { DepositStatusChangedEvent } from './events/deposit-transaction.events';
import {
  DepositTransactionStatus,
  DepositTransactionAction,
} from './dto/deposit-transaction.dto';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { deterministicTransferId } from '../../accounting/tigerbeetle/utils/tb-id.util';
import {
  AuditActions,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { SystemWalletResolver } from '../../funds-layer/domain/system-wallet-resolver.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

describe('DepositWorkflowService', () => {
  let service: DepositWorkflowService;
  let depositService: Record<string, jest.Mock>;
  let auditLogsService: Record<string, jest.Mock>;
  let fundsOrders: Record<string, jest.Mock>;
  let withdrawalAddresses: Record<string, jest.Mock>;
  let sumsubTxnClient: Record<string, jest.Mock>;
  let approvalsService: Record<string, jest.Mock>;
  let systemWalletResolver: Record<string, jest.Mock>;
  let tbEvidenceService: Record<string, jest.Mock>;

  beforeEach(async () => {
    depositService = {
      getOwnerComplianceStatus: jest.fn(),
      updateStatus: jest.fn(),
      findOne: jest.fn(),
      updateSumsubVerdict: jest.fn(),
      saveTxnDetail: jest.fn().mockResolvedValue(undefined),
      setSlaDeadline: jest.fn().mockResolvedValue(undefined),
      setSumsubTxnIds: jest.fn().mockResolvedValue(undefined),
      clearLimitHold: jest.fn().mockResolvedValue(undefined),
    };
    auditLogsService = {
      recordSystem: jest.fn().mockResolvedValue(undefined),
      recordByActor: jest.fn().mockResolvedValue(undefined),
    };
    fundsOrders = {
      findById: jest.fn(),
      findByParent: jest.fn().mockResolvedValue([]),
      advance: jest.fn().mockResolvedValue(undefined),
      create: jest.fn(),
      // Faithful mirror of the real type-based resolver: CRYPTO → txHash, FIAT → referenceNo
      // (default CRYPTO when asset.type is absent). NOT a txHash ?? referenceNo coalesce.
      resolveExternalRef: jest.fn((row) =>
        ((row?.asset?.type ?? 'CRYPTO').toUpperCase() === 'CRYPTO'
          ? (row?.txHash ?? null)
          : (row?.referenceNo ?? null))),
    };
    withdrawalAddresses = {
      hasActiveFiatWithdrawalAddress: jest.fn().mockResolvedValue(true),
    };
    sumsubTxnClient = {
      submitTxn: jest.fn(),
      getTxn: jest.fn(),
      rescore: jest.fn(),
      reviewComplete: jest.fn(),
    };
    approvalsService = {
      list: jest.fn().mockResolvedValue({ total: 0, items: [] }),
      createAndSubmit: jest.fn().mockResolvedValue({ id: 'app-1', approvalNo: 'APR-1' }),
    };
    systemWalletResolver = {
      resolve: jest.fn().mockResolvedValue({ id: 'fee-wallet-1', address: null, iban: null }),
    };
    tbEvidenceService = {
      enrichForPost: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepositWorkflowService,
        { provide: DepositTransactionsService, useValue: depositService },
        { provide: FundsOrderService, useValue: fundsOrders },
        { provide: AuditLogsService, useValue: auditLogsService },
        { provide: AccountingService, useValue: { resolveTbAccountId: jest.fn(), executeTransfer: jest.fn() } },
        { provide: WithdrawalAddressService, useValue: withdrawalAddresses },
        { provide: SUMSUB_TXN_CLIENT, useValue: sumsubTxnClient },
        { provide: ApprovalsService, useValue: approvalsService },
        { provide: SystemWalletResolver, useValue: systemWalletResolver },
        { provide: TbEvidenceService, useValue: tbEvidenceService },
      ],
    }).compile();

    service = module.get<DepositWorkflowService>(DepositWorkflowService);
  });

  describe('handleDepositStatusChanged — Gate 0', () => {
    it('runs Gate 0 when entering COMPLIANCE_PENDING with normal customer', async () => {
      depositService.getOwnerComplianceStatus.mockResolvedValue('ACTIVE');
      depositService.findOne.mockResolvedValue({ id: 'dep-1', depositNo: 'DEP001', ownerType: 'CUSTOMER', ownerId: 'cust-1', traceId: null });

      const event = new DepositStatusChangedEvent(
        'dep-1',
        DepositTransactionStatus.PAYIN_PENDING,
        DepositTransactionStatus.COMPLIANCE_PENDING,
        'CUSTOMER', 'cust-1', 'asset-1', '100',
      );

      await service.handleDepositStatusChanged(event);

      expect(depositService.getOwnerComplianceStatus).toHaveBeenCalledWith('dep-1');
    });

    it('freezes deposit when customer complianceStatus is FROZEN', async () => {
      depositService.getOwnerComplianceStatus.mockResolvedValue('FROZEN');

      const event = new DepositStatusChangedEvent(
        'dep-1',
        DepositTransactionStatus.PAYIN_PENDING,
        DepositTransactionStatus.COMPLIANCE_PENDING,
        'CUSTOMER', 'cust-1', 'asset-1', '100',
      );

      await service.handleDepositStatusChanged(event);

      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'dep-1',
        { action: DepositTransactionAction.FREEZE },
        expect.objectContaining({
          reason: expect.stringContaining('FROZEN'),
        }),
      );
    });

    it('freezes deposit when customer complianceStatus is SUSPENDED', async () => {
      depositService.getOwnerComplianceStatus.mockResolvedValue('SUSPENDED');

      const event = new DepositStatusChangedEvent(
        'dep-1',
        DepositTransactionStatus.PAYIN_PENDING,
        DepositTransactionStatus.COMPLIANCE_PENDING,
        'CUSTOMER', 'cust-1', 'asset-1', '100',
      );

      await service.handleDepositStatusChanged(event);

      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'dep-1',
        { action: DepositTransactionAction.FREEZE },
        expect.objectContaining({
          reason: expect.stringContaining('SUSPENDED'),
        }),
      );
    });

    it('does nothing for non-COMPLIANCE_PENDING transitions', async () => {
      const event = new DepositStatusChangedEvent(
        'dep-1',
        DepositTransactionStatus.COMPLIANCE_PENDING,
        DepositTransactionStatus.SUCCESS,
        'CUSTOMER', 'cust-1', 'asset-1', '100',
      );

      await service.handleDepositStatusChanged(event);

      expect(depositService.getOwnerComplianceStatus).not.toHaveBeenCalled();
    });
  });

  describe('Sumsub txn submission — Gate 0 (Task 8)', () => {
    const baseFiatDeposit = {
      id: 'dep-sub-fiat',
      depositNo: 'DEP-SUB-FIAT-001',
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      traceId: null,
      amount: '500',
      asset: { type: 'FIAT', currency: 'AED' },
      customer: { sumsubApplicantId: 'applicant-1' },
    };

    const baseCryptoDeposit = {
      id: 'dep-sub-crypto',
      depositNo: 'DEP-SUB-CRYPTO-001',
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      traceId: null,
      amount: '100.5',
      asset: { type: 'CRYPTO', currency: 'USDT' },
      customer: { sumsubApplicantId: 'applicant-1' },
    };

    function mkEvent(depositId: string) {
      return new DepositStatusChangedEvent(
        depositId,
        DepositTransactionStatus.PAYIN_PENDING,
        DepositTransactionStatus.COMPLIANCE_PENDING,
        'CUSTOMER', 'cust-1', 'asset-1', '100',
      );
    }

    beforeEach(() => {
      depositService.getOwnerComplianceStatus.mockResolvedValue('ACTIVE');
    });

    it('fiat deposit with applicantId → submits finance leg once and persists sumsubFinanceTxnId', async () => {
      depositService.findOne.mockResolvedValue(baseFiatDeposit);
      sumsubTxnClient.submitTxn.mockResolvedValue({ txnId: 'TXN-FIN-1' });

      await service.handleDepositStatusChanged(mkEvent('dep-sub-fiat'));

      expect(sumsubTxnClient.submitTxn).toHaveBeenCalledTimes(1);
      expect(sumsubTxnClient.submitTxn).toHaveBeenCalledWith(
        expect.objectContaining({
          applicantId: 'applicant-1',
          clientTxnId: 'DEP-SUB-FIAT-001',
          type: 'finance',
          direction: 'in',
          amount: 500,
          currencyCode: 'AED',
          currencyType: 'fiat',
        }),
      );
      expect(depositService.setSumsubTxnIds).toHaveBeenCalledWith('dep-sub-fiat', {
        financeTxnId: 'TXN-FIN-1',
      });
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditActions.DEPOSIT_SUMSUB_SUBMITTED,
          entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
          entityId: 'dep-sub-fiat',
          entityNo: 'DEP-SUB-FIAT-001',
          entityOwnerType: 'CUSTOMER',
          entityOwnerId: 'cust-1',
          workflowType: 'DEPOSIT',
          metadata: { financeTxnId: 'TXN-FIN-1', travelRuleTxnId: undefined },
        }),
      );
    });

    it('crypto deposit with applicantId → submits finance + travelRule and persists both txnIds', async () => {
      depositService.findOne.mockResolvedValue(baseCryptoDeposit);
      sumsubTxnClient.submitTxn
        .mockResolvedValueOnce({ txnId: 'TXN-FIN-2' })
        .mockResolvedValueOnce({ txnId: 'TXN-TR-2' });

      await service.handleDepositStatusChanged(mkEvent('dep-sub-crypto'));

      expect(sumsubTxnClient.submitTxn).toHaveBeenCalledTimes(2);
      expect(sumsubTxnClient.submitTxn).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ type: 'finance', currencyType: 'crypto', currencyCode: 'USDT' }),
      );
      expect(sumsubTxnClient.submitTxn).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ type: 'travelRule', currencyType: 'crypto', currencyCode: 'USDT' }),
      );
      expect(depositService.setSumsubTxnIds).toHaveBeenCalledWith('dep-sub-crypto', {
        financeTxnId: 'TXN-FIN-2',
        travelRuleTxnId: 'TXN-TR-2',
      });
    });

    it('customer has no sumsubApplicantId → warns and skips submission (stays COMPLIANCE_PENDING for manual handling)', async () => {
      depositService.findOne.mockResolvedValue({
        ...baseFiatDeposit,
        customer: {},
      });

      await service.handleDepositStatusChanged(mkEvent('dep-sub-fiat'));

      expect(sumsubTxnClient.submitTxn).not.toHaveBeenCalled();
      expect(depositService.setSumsubTxnIds).not.toHaveBeenCalled();
      // No submission happened → no DEPOSIT_SUMSUB_SUBMITTED audit entry.
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.DEPOSIT_SUMSUB_SUBMITTED }),
      );
    });

    it('deposit already has sumsubFinanceTxnId → idempotent skip (no re-submit on runGate0 re-entry)', async () => {
      depositService.findOne.mockResolvedValue({
        ...baseFiatDeposit,
        sumsubFinanceTxnId: 'TXN-ALREADY-SET',
      });

      await service.handleDepositStatusChanged(mkEvent('dep-sub-fiat'));

      expect(sumsubTxnClient.submitTxn).not.toHaveBeenCalled();
      expect(depositService.setSumsubTxnIds).not.toHaveBeenCalled();
    });

    it('I2: submitTxn throws (real HTTP failure) → runGate0 does not throw, deposit stays COMPLIANCE_PENDING', async () => {
      depositService.findOne.mockResolvedValue(baseFiatDeposit);
      sumsubTxnClient.submitTxn.mockRejectedValue(new Error('ECONNREFUSED: Sumsub unreachable'));

      await expect(service.handleDepositStatusChanged(mkEvent('dep-sub-fiat'))).resolves.not.toThrow();

      expect(sumsubTxnClient.submitTxn).toHaveBeenCalledTimes(1);
      // Submission failed → no txnIds persisted, no DEPOSIT_SUMSUB_SUBMITTED audit.
      expect(depositService.setSumsubTxnIds).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.DEPOSIT_SUMSUB_SUBMITTED }),
      );
      // Gate 0 must NOT be strand: deposit is not touched via updateStatus
      // (i.e. it stays wherever it already is — COMPLIANCE_PENDING).
      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('checkAutoApproval', () => {
    it('approves when all three gates pass (COMPLIANCE_PENDING + ACTIVE + PASSED + PASSED)', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-1',
        depositNo: 'DEP001',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        financeStatus: 'PASSED',
        travelRuleStatus: 'PASSED',
        ownerId: 'cust-1',
        ownerType: 'CUSTOMER',
        assetId: 'asset-1',
        amount: '100',
        payinId: 'payin-1',
        traceId: 'trace-1',
        asset: { currency: 'USDT', tbLedgerId: 2, decimals: 6 },
      });
      depositService.getOwnerComplianceStatus.mockResolvedValue('ACTIVE');
      depositService.updateStatus.mockResolvedValue({});
      withdrawalAddresses.hasActiveFiatWithdrawalAddress.mockResolvedValue(true);

      await service.checkAutoApproval('dep-1');

      expect(depositService.findOne).toHaveBeenCalledWith('dep-1');
      expect(depositService.getOwnerComplianceStatus).toHaveBeenCalledWith('dep-1');
      expect(withdrawalAddresses.hasActiveFiatWithdrawalAddress).toHaveBeenCalledWith('cust-1');
      expect(depositService.updateStatus).toHaveBeenCalledWith('dep-1', {
        action: DepositTransactionAction.APPROVE,
      });
    });

    it('holds deposit in COMPLIANCE_PENDING when customer is not trading-ready (no active fiat address)', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-1',
        depositNo: 'DEP001',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        financeStatus: 'PASSED',
        travelRuleStatus: 'PASSED',
        ownerId: 'cust-1',
        ownerType: 'CUSTOMER',
        assetId: 'asset-1',
        amount: '100',
        payinId: 'payin-1',
        traceId: 'trace-1',
        asset: { currency: 'USDT', tbLedgerId: 2, decimals: 6 },
      });
      depositService.getOwnerComplianceStatus.mockResolvedValue('ACTIVE');
      withdrawalAddresses.hasActiveFiatWithdrawalAddress.mockResolvedValue(false);

      await service.checkAutoApproval('dep-1');

      expect(withdrawalAddresses.hasActiveFiatWithdrawalAddress).toHaveBeenCalledWith('cust-1');
      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(fundsOrders.findByParent).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEPOSIT_HELD_NOT_TRADING_READY',
          entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
          entityId: 'dep-1',
          entityNo: 'DEP001',
          entityOwnerType: 'CUSTOMER',
          entityOwnerId: 'cust-1',
          workflowType: 'DEPOSIT',
        }),
      );
    });

    it('holds when limitHoldReason=BELOW_MIN — audits DEPOSIT_HELD_BELOW_MIN, never approves', async () => {
      const approveSpy = jest.spyOn(service, 'approveDeposit');
      depositService.findOne.mockResolvedValue({
        id: 'dep-1',
        depositNo: 'DEP001',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        financeStatus: 'PASSED',
        travelRuleStatus: 'PASSED',
        ownerId: 'cust-1',
        ownerType: 'CUSTOMER',
        amount: '5',
        traceId: 'trace-1',
        limitHoldReason: 'BELOW_MIN',
      });

      await service.checkAutoApproval('dep-1');

      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_HELD_BELOW_MIN' }),
      );
      expect(approveSpy).not.toHaveBeenCalled();
      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('does not approve when deposit is FROZEN (even if KYT+TR passed)', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-1',
        status: DepositTransactionStatus.FROZEN,
        financeStatus: 'PASSED',
        travelRuleStatus: 'PASSED',
      });

      await service.checkAutoApproval('dep-1');

      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('does not approve when financeStatus is PENDING', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-1',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        financeStatus: 'PENDING',
        travelRuleStatus: 'PASSED',
      });

      await service.checkAutoApproval('dep-1');

      expect(depositService.getOwnerComplianceStatus).not.toHaveBeenCalled();
    });

    it('does not approve when travelRuleStatus is PENDING', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-1',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        financeStatus: 'PASSED',
        travelRuleStatus: 'PENDING',
      });

      await service.checkAutoApproval('dep-1');

      expect(depositService.getOwnerComplianceStatus).not.toHaveBeenCalled();
    });

    it('does not approve when customer compliance is abnormal', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-1',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        financeStatus: 'PASSED',
        travelRuleStatus: 'PASSED',
        ownerId: 'cust-1',
      });
      depositService.getOwnerComplianceStatus.mockResolvedValue('FROZEN');

      await service.checkAutoApproval('dep-1');

      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('approves fiat deposit when financeStatus=PASSED and travelRuleStatus=NOT_REQUIRED', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-fiat-1',
        depositNo: 'DEP-FIAT-001',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        financeStatus: 'PASSED',
        travelRuleStatus: 'NOT_REQUIRED',
        ownerId: 'cust-1',
        ownerType: 'CUSTOMER',
        assetId: 'asset-usd',
        amount: '500',
        payinId: 'payin-fiat-1',
        traceId: 'trace-fiat-1',
        asset: { currency: 'USD', tbLedgerId: 3, decimals: 2 },
      });
      depositService.getOwnerComplianceStatus.mockResolvedValue('ACTIVE');
      depositService.updateStatus.mockResolvedValue({});
      withdrawalAddresses.hasActiveFiatWithdrawalAddress.mockResolvedValue(true);

      await service.checkAutoApproval('dep-fiat-1');

      expect(depositService.findOne).toHaveBeenCalledWith('dep-fiat-1');
      expect(depositService.getOwnerComplianceStatus).toHaveBeenCalledWith('dep-fiat-1');
      expect(depositService.updateStatus).toHaveBeenCalledWith('dep-fiat-1', {
        action: DepositTransactionAction.APPROVE,
      });
    });
  });

  describe('waiveLimitHold', () => {
    const adminActor = { actorId: 'admin-1', actorRole: 'OPERATOR' };
    const baseDeposit = (overrides: Record<string, unknown> = {}) => ({
      id: 'dep-1',
      depositNo: 'DEP001',
      status: DepositTransactionStatus.COMPLIANCE_PENDING,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      amount: '5',
      traceId: 'trace-1',
      limitHoldReason: 'BELOW_MIN',
      ...overrides,
    });

    it('waiveLimitHold: clears flag, audits DEPOSIT_LIMIT_WAIVED, re-runs checkAutoApproval', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit());
      const reRun = jest.spyOn(service, 'checkAutoApproval').mockResolvedValue(undefined);

      await service.waiveLimitHold('dep-1', adminActor);

      expect(depositService.clearLimitHold).toHaveBeenCalledWith('dep-1');
      expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_LIMIT_WAIVED' }),
        expect.anything(),
      );
      expect(reRun).toHaveBeenCalledWith('dep-1');
    });

    it('waiveLimitHold: rejects when deposit has no BELOW_MIN hold', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit({ limitHoldReason: null }));
      await expect(service.waiveLimitHold('dep-1', adminActor)).rejects.toThrow(BadRequestException);
    });

    it('waiveLimitHold: rejects a BELOW_MIN hold no longer in COMPLIANCE_PENDING', async () => {
      depositService.findOne.mockResolvedValue(
        baseDeposit({ limitHoldReason: 'BELOW_MIN', status: DepositTransactionStatus.SUCCESS }),
      );
      await expect(service.waiveLimitHold('dep-1', adminActor)).rejects.toThrow(BadRequestException);
      expect(depositService.clearLimitHold).not.toHaveBeenCalled();
    });
  });

  describe('initiateConfiscation', () => {
    const adminActor = {
      actorType: 'ADMIN' as const,
      userId: 'admin-1',
      userNo: 'ADM-1',
      role: 'OPS_OFFICER',
      roleCodes: ['OPS_OFFICER'],
    };
    const baseDeposit = (overrides: Record<string, unknown> = {}) => ({
      id: 'dep-1',
      depositNo: 'DEP001',
      status: DepositTransactionStatus.COMPLIANCE_PENDING,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      assetId: 'asset-1',
      amount: '5',
      traceId: 'trace-1',
      limitHoldReason: 'BELOW_MIN',
      ...overrides,
    });

    it('initiateConfiscation: below-min COMPLIANCE_PENDING → creates approval, audits REQUESTED', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit({ limitHoldReason: 'BELOW_MIN', status: 'COMPLIANCE_PENDING' }));
      approvalsService.list.mockResolvedValue({ total: 0, items: [] });
      approvalsService.createAndSubmit.mockResolvedValue({ id: 'app-1', approvalNo: 'APR-1' });
      const res = await service.initiateConfiscation('dep-1', { reason: 'below min' }, adminActor);
      expect(approvalsService.createAndSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'DEPOSIT_CONFISCATION', entityRef: expect.any(String),
          objectSnapshot: expect.objectContaining({ basis: expect.stringContaining('T&C') }) }),
        expect.anything(), expect.anything(),
      );
      expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_CONFISCATION_REQUESTED' }), expect.anything(),
      );
      expect(res).toEqual(expect.objectContaining({ approvalNo: 'APR-1' }));
    });

    it('initiateConfiscation: rejects when not BELOW_MIN held', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit({ limitHoldReason: null }));
      await expect(service.initiateConfiscation('dep-1', { reason: 'x' }, adminActor)).rejects.toThrow(BadRequestException);
    });

    it('initiateConfiscation: rejects when an open confiscation approval already exists', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit({ limitHoldReason: 'BELOW_MIN', status: 'COMPLIANCE_PENDING' }));
      approvalsService.list.mockResolvedValue({ total: 1, items: [{ id: 'existing' }] });
      await expect(service.initiateConfiscation('dep-1', { reason: 'x' }, adminActor)).rejects.toThrow(ConflictException);
    });

    // Regression guard (D6 review FIX 1): a deposit whose traceId is null must NOT fail
    // the confiscation. createDraftCase mints its own traceId when createDto.traceId is
    // undefined; submitCase then asserts create/submit trace consistency. Reusing the one
    // locally-minted traceId in BOTH DTOs keeps them identical so submit does not throw.
    it('initiateConfiscation: null-traceId deposit resolves with matching create/submit traceId', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit({ traceId: null }));
      approvalsService.list.mockResolvedValue({ total: 0, items: [] });
      approvalsService.createAndSubmit.mockResolvedValue({ id: 'app-2', approvalNo: 'APR-2' });

      await expect(
        service.initiateConfiscation('dep-1', { reason: 'below min' }, adminActor),
      ).resolves.toEqual(expect.objectContaining({ approvalNo: 'APR-2' }));

      const [createDto, submitDto] = approvalsService.createAndSubmit.mock.calls[0];
      expect(createDto.traceId).toBeTruthy();
      expect(submitDto.traceId).toBeTruthy();
      expect(createDto.traceId).toBe(submitDto.traceId);
    });

    // FIX 2: high-risk fund-confiscating action must carry a non-blank audit reason.
    it('initiateConfiscation: rejects a blank reason before creating any approval', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit({ limitHoldReason: 'BELOW_MIN', status: 'COMPLIANCE_PENDING' }));
      await expect(
        service.initiateConfiscation('dep-1', { reason: '  ' }, adminActor),
      ).rejects.toThrow(BadRequestException);
      expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
    });
  });

  // A2: initiateReturn/initiateSeize/initiateUnfreeze mirror initiateConfiscation's
  // structure (precondition + anti-dup + createAndSubmit + audit, no deposit-table write).
  describe('initiateReturn', () => {
    const adminActor = {
      actorType: 'ADMIN' as const,
      userId: 'admin-1',
      userNo: 'ADM-1',
      role: 'MLRO',
      roleCodes: ['MLRO'],
    };
    const baseDeposit = (overrides: Record<string, unknown> = {}) => ({
      id: 'dep-r1',
      depositNo: 'DEPR001',
      status: DepositTransactionStatus.MANUAL_CHECKING,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      assetId: 'asset-1',
      amount: '5',
      traceId: 'trace-r1',
      fromAddress: 'T_SENDER_ADDR',
      fromIban: null,
      ...overrides,
    });

    it('MANUAL_CHECKING → creates a DEPOSIT_RETURN approval, audits REQUESTED', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit());
      approvalsService.list.mockResolvedValue({ total: 0, items: [] });
      approvalsService.createAndSubmit.mockResolvedValue({ id: 'app-r1', approvalNo: 'APR-R1' });

      const res = await service.initiateReturn('dep-r1', { reason: 'dirty money' }, adminActor);

      expect(approvalsService.createAndSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'DEPOSIT_RETURN', entityRef: 'dep-r1' }),
        expect.anything(),
        expect.anything(),
      );
      expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_RETURN_APPROVAL_REQUESTED' }),
        expect.anything(),
      );
      expect(res).toEqual(expect.objectContaining({ approvalNo: 'APR-R1' }));
      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('rejects when deposit is not MANUAL_CHECKING', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit({ status: DepositTransactionStatus.COMPLIANCE_PENDING }));
      await expect(
        service.initiateReturn('dep-r1', { reason: 'x' }, adminActor),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when an open return approval already exists', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit());
      approvalsService.list.mockResolvedValue({ total: 1, items: [{ id: 'existing' }] });
      await expect(
        service.initiateReturn('dep-r1', { reason: 'x' }, adminActor),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a blank reason before creating any approval', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit());
      await expect(
        service.initiateReturn('dep-r1', { reason: '  ' }, adminActor),
      ).rejects.toThrow(BadRequestException);
      expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
    });

    it('Fix 4: rejects when deposit has no fromAddress/fromIban on file (nowhere to return the funds to)', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit({ fromAddress: null, fromIban: null }));
      await expect(
        service.initiateReturn('dep-r1', { reason: 'x' }, adminActor),
      ).rejects.toThrow(BadRequestException);
      expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
    });

    it('Fix 4: fromIban alone (no fromAddress) is sufficient — fiat sender IBAN', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit({ fromAddress: null, fromIban: 'AE-IBAN-1' }));
      approvalsService.list.mockResolvedValue({ total: 0, items: [] });
      approvalsService.createAndSubmit.mockResolvedValue({ id: 'app-r2', approvalNo: 'APR-R2' });

      const res = await service.initiateReturn('dep-r1', { reason: 'dirty money' }, adminActor);

      expect(res).toEqual(expect.objectContaining({ approvalNo: 'APR-R2' }));
    });
  });

  describe('initiateSeize', () => {
    const adminActor = {
      actorType: 'ADMIN' as const,
      userId: 'admin-2',
      userNo: 'ADM-2',
      role: 'SENIOR_MANAGEMENT_OFFICER',
      roleCodes: ['SENIOR_MANAGEMENT_OFFICER'],
    };
    const baseDeposit = (overrides: Record<string, unknown> = {}) => ({
      id: 'dep-s1',
      depositNo: 'DEPS001',
      status: DepositTransactionStatus.FROZEN,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      assetId: 'asset-1',
      amount: '5',
      traceId: 'trace-s1',
      ...overrides,
    });

    it('FROZEN → creates a DEPOSIT_SEIZE approval, audits REQUESTED with orderRef', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit());
      approvalsService.list.mockResolvedValue({ total: 0, items: [] });
      approvalsService.createAndSubmit.mockResolvedValue({ id: 'app-s1', approvalNo: 'APR-S1' });

      const res = await service.initiateSeize(
        'dep-s1',
        { reason: 'gov order', orderRef: 'ORD-123' },
        adminActor,
      );

      expect(approvalsService.createAndSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'DEPOSIT_SEIZE',
          entityRef: 'dep-s1',
          objectSnapshot: expect.objectContaining({ orderRef: 'ORD-123' }),
        }),
        expect.anything(),
        expect.anything(),
      );
      expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEPOSIT_SEIZE_APPROVAL_REQUESTED',
          metadata: expect.objectContaining({ orderRef: 'ORD-123' }),
        }),
        expect.anything(),
      );
      expect(res).toEqual(expect.objectContaining({ approvalNo: 'APR-S1' }));
      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('rejects when deposit is not FROZEN', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit({ status: DepositTransactionStatus.MANUAL_CHECKING }));
      await expect(
        service.initiateSeize('dep-s1', { reason: 'x', orderRef: 'ORD-1' }, adminActor),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when an open seize approval already exists', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit());
      approvalsService.list.mockResolvedValue({ total: 1, items: [{ id: 'existing' }] });
      await expect(
        service.initiateSeize('dep-s1', { reason: 'x', orderRef: 'ORD-1' }, adminActor),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a blank reason before creating any approval', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit());
      await expect(
        service.initiateSeize('dep-s1', { reason: '  ', orderRef: 'ORD-1' }, adminActor),
      ).rejects.toThrow(BadRequestException);
      expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
    });

    it('rejects a blank orderRef before creating any approval', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit());
      await expect(
        service.initiateSeize('dep-s1', { reason: 'x', orderRef: '  ' }, adminActor),
      ).rejects.toThrow(BadRequestException);
      expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
    });
  });

  describe('initiateUnfreeze', () => {
    const adminActor = {
      actorType: 'ADMIN' as const,
      userId: 'admin-3',
      userNo: 'ADM-3',
      role: 'MLRO',
      roleCodes: ['MLRO'],
    };
    const baseDeposit = (overrides: Record<string, unknown> = {}) => ({
      id: 'dep-u1',
      depositNo: 'DEPU001',
      status: DepositTransactionStatus.FROZEN,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      assetId: 'asset-1',
      amount: '5',
      traceId: 'trace-u1',
      ...overrides,
    });

    it('FROZEN → creates a DEPOSIT_UNFREEZE approval, audits REQUESTED with orderRef', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit());
      approvalsService.list.mockResolvedValue({ total: 0, items: [] });
      approvalsService.createAndSubmit.mockResolvedValue({ id: 'app-u1', approvalNo: 'APR-U1' });

      const res = await service.initiateUnfreeze(
        'dep-u1',
        { reason: 'delisted', orderRef: 'ORD-U-1' },
        adminActor,
      );

      expect(approvalsService.createAndSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'DEPOSIT_UNFREEZE',
          entityRef: 'dep-u1',
          objectSnapshot: expect.objectContaining({ orderRef: 'ORD-U-1' }),
        }),
        expect.anything(),
        expect.anything(),
      );
      expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEPOSIT_UNFREEZE_APPROVAL_REQUESTED',
          metadata: expect.objectContaining({ orderRef: 'ORD-U-1' }),
        }),
        expect.anything(),
      );
      expect(res).toEqual(expect.objectContaining({ approvalNo: 'APR-U1' }));
      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('rejects when deposit is not FROZEN', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit({ status: DepositTransactionStatus.MANUAL_CHECKING }));
      await expect(
        service.initiateUnfreeze('dep-u1', { reason: 'x', orderRef: 'ORD-1' }, adminActor),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when an open unfreeze approval already exists', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit());
      approvalsService.list.mockResolvedValue({ total: 1, items: [{ id: 'existing' }] });
      await expect(
        service.initiateUnfreeze('dep-u1', { reason: 'x', orderRef: 'ORD-1' }, adminActor),
      ).rejects.toThrow(ConflictException);
    });
  });

  // A2: decided listeners are routing skeletons only — APPROVED delegates to a stub
  // (logs + TODO, never throws); any other outcome is a no-op (approvals engine already
  // owns the audit trail for reject/cancel/expire). Real execution lands in A3/A4/A5.
  describe('onReturnDecided / onSeizeDecided / onUnfreezeDecided (A2 stubs)', () => {
    const decidedEvent = (overrides: Record<string, unknown> = {}) => ({
      decision: 'APPROVED' as const,
      actionType: 'DEPOSIT_RETURN',
      entityRef: 'dep-x1',
      approvalId: 'app-x1',
      approvalNo: 'APR-X1',
      traceId: 'trace-x1',
      workflowType: 'DEPOSIT_RETURN',
      metadata: {},
      ...overrides,
    });

    it('onReturnDecided: APPROVED → calls the onReturnApproved stub, does not throw, does not touch deposit status', async () => {
      const deposit = { id: 'dep-x1', depositNo: 'DEP-X1', status: DepositTransactionStatus.MANUAL_CHECKING };
      depositService.findOne.mockResolvedValue(deposit);
      const stub = jest.spyOn(service as any, 'onReturnApproved').mockResolvedValue(undefined);

      await expect(service.onReturnDecided(decidedEvent())).resolves.toBeUndefined();

      expect(stub).toHaveBeenCalledWith(deposit);
      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('onReturnDecided: DECLINED → no-op (stub not called, deposit untouched)', async () => {
      const deposit = { id: 'dep-x1', depositNo: 'DEP-X1', status: DepositTransactionStatus.MANUAL_CHECKING };
      depositService.findOne.mockResolvedValue(deposit);
      const stub = jest.spyOn(service as any, 'onReturnApproved').mockResolvedValue(undefined);

      await service.onReturnDecided(decidedEvent({ decision: 'DECLINED' }));

      expect(stub).not.toHaveBeenCalled();
      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('onReturnDecided: foreign entityRef (deposit not found) → graceful no-op', async () => {
      depositService.findOne.mockRejectedValue(new NotFoundException('not found'));
      await expect(service.onReturnDecided(decidedEvent())).resolves.toBeUndefined();
    });

    it('onSeizeDecided: APPROVED → calls the onSeizeApproved stub, does not throw', async () => {
      const deposit = { id: 'dep-x2', depositNo: 'DEP-X2', status: DepositTransactionStatus.FROZEN };
      depositService.findOne.mockResolvedValue(deposit);
      const stub = jest.spyOn(service as any, 'onSeizeApproved').mockResolvedValue(undefined);

      await expect(
        service.onSeizeDecided(decidedEvent({ actionType: 'DEPOSIT_SEIZE', entityRef: 'dep-x2', workflowType: 'DEPOSIT_SEIZE' })),
      ).resolves.toBeUndefined();

      expect(stub).toHaveBeenCalledWith(deposit);
      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('onSeizeDecided: CANCELLED → no-op', async () => {
      const deposit = { id: 'dep-x2', depositNo: 'DEP-X2', status: DepositTransactionStatus.FROZEN };
      depositService.findOne.mockResolvedValue(deposit);
      const stub = jest.spyOn(service as any, 'onSeizeApproved').mockResolvedValue(undefined);

      await service.onSeizeDecided(
        decidedEvent({ actionType: 'DEPOSIT_SEIZE', entityRef: 'dep-x2', workflowType: 'DEPOSIT_SEIZE', decision: 'CANCELLED' }),
      );

      expect(stub).not.toHaveBeenCalled();
    });

    it('onUnfreezeDecided: APPROVED → calls the onUnfreezeApproved stub, does not throw', async () => {
      const deposit = { id: 'dep-x3', depositNo: 'DEP-X3', status: DepositTransactionStatus.FROZEN };
      depositService.findOne.mockResolvedValue(deposit);
      const stub = jest.spyOn(service as any, 'onUnfreezeApproved').mockResolvedValue(undefined);

      await expect(
        service.onUnfreezeDecided(decidedEvent({ actionType: 'DEPOSIT_UNFREEZE', entityRef: 'dep-x3', workflowType: 'DEPOSIT_UNFREEZE' })),
      ).resolves.toBeUndefined();

      expect(stub).toHaveBeenCalledWith(deposit);
      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('onUnfreezeDecided: EXPIRED → no-op', async () => {
      const deposit = { id: 'dep-x3', depositNo: 'DEP-X3', status: DepositTransactionStatus.FROZEN };
      depositService.findOne.mockResolvedValue(deposit);
      const stub = jest.spyOn(service as any, 'onUnfreezeApproved').mockResolvedValue(undefined);

      await service.onUnfreezeDecided(
        decidedEvent({ actionType: 'DEPOSIT_UNFREEZE', entityRef: 'dep-x3', workflowType: 'DEPOSIT_UNFREEZE', decision: 'EXPIRED' }),
      );

      expect(stub).not.toHaveBeenCalled();
    });
  });

  describe('handleFundsOrderChanged — filter + routing', () => {
    it('ignores funds orders that are not payins (no depositTransactionId)', async () => {
      await service.handleFundsOrderChanged({
        fundsOrderId: 'fo-w1',
        fundsOrderNo: 'FO-W1',
        parent: { withdrawTransactionId: 'wd-1' },
        legSeq: 1,
        attempt: 1,
        oldStatus: 'CONFIRMED',
        newStatus: 'CLEARED',
      });

      expect(depositService.findOne).not.toHaveBeenCalled();
      expect(fundsOrders.findById).not.toHaveBeenCalled();
    });

    it('routes a CONFIRMED payin funds order to onPayinConfirmed', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-1',
        depositNo: 'DEP001',
        status: DepositTransactionStatus.PAYIN_PENDING,
        ownerType: 'FIRM', // skip TB posting, focus on routing + CLEAR
        ownerId: 'firm-1',
        traceId: null,
      });
      fundsOrders.findById.mockResolvedValue({ id: 'fo-1', fundsOrderNo: 'FO001', status: 'CONFIRMED' });
      depositService.updateStatus.mockResolvedValue({});

      await service.handleFundsOrderChanged({
        fundsOrderId: 'fo-1',
        fundsOrderNo: 'FO001',
        parent: { depositTransactionId: 'dep-1' },
        legSeq: 1,
        attempt: 1,
        oldStatus: 'CONFIRMING',
        newStatus: 'CONFIRMED',
      });

      expect(depositService.updateStatus).toHaveBeenCalledWith('dep-1', {
        action: DepositTransactionAction.PAYIN_CONFIRMED,
      });
      expect(fundsOrders.advance).toHaveBeenCalledWith('fo-1', 'CLEAR', 'SYSTEM');
    });
  });

  describe('executeDepositAccounting — real-time 1:1 model', () => {
    let accountingService: { resolveTbAccountId: jest.Mock; executeTransfer: jest.Mock };

    beforeEach(async () => {
      accountingService = {
        resolveTbAccountId: jest.fn(),
        executeTransfer: jest.fn().mockResolvedValue(undefined),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DepositWorkflowService,
          { provide: DepositTransactionsService, useValue: depositService },
          { provide: FundsOrderService, useValue: fundsOrders },
          { provide: AuditLogsService, useValue: auditLogsService },
          { provide: AccountingService, useValue: accountingService },
          { provide: WithdrawalAddressService, useValue: withdrawalAddresses },
          { provide: SUMSUB_TXN_CLIENT, useValue: sumsubTxnClient },
          { provide: ApprovalsService, useValue: approvalsService },
          { provide: SystemWalletResolver, useValue: systemWalletResolver },
          { provide: TbEvidenceService, useValue: tbEvidenceService },
        ],
      }).compile();

      service = module.get<DepositWorkflowService>(DepositWorkflowService);
    });

    const baseDeposit = {
      id: 'dep-acc-1',
      depositNo: 'DEP-ACC-001',
      ownerId: 'cust-uuid-1',
      ownerType: 'CUSTOMER',
      amount: '100.50',
      traceId: 'trace-acc-1',
      asset: { currency: 'USDT', tbLedgerId: 2, decimals: 6, type: 'CRYPTO' },
    };

    // The payin funds_order pins the receiving wallet + external ref; passed as arg 3.
    const cryptoFundsOrder = {
      id: 'fo-acc-1',
      toWalletId: 'wallet-acc-1',
      txHash: '0xdeadbeef',
      referenceNo: null,
    };

    it('STEP_1: debits CLIENT_ASSET/SYSTEM and credits DEPOSIT_SUSPENSE/CUSTOMER with DEPOSIT_ASSET_TO_SUSPENSE code', async () => {
      accountingService.resolveTbAccountId
        .mockResolvedValueOnce('tb-client-asset-id')   // debit: CLIENT_ASSET SYSTEM
        .mockResolvedValueOnce('tb-suspense-id');       // credit: DEPOSIT_SUSPENSE CUSTOMER

      await (service as any).executeDepositAccounting(baseDeposit, 'STEP_1', cryptoFundsOrder);

      // First resolve call: CLIENT_ASSET / SYSTEM (no ownerUuid)
      expect(accountingService.resolveTbAccountId).toHaveBeenNthCalledWith(1, {
        code: TB_ACCOUNT_CODES.CLIENT_ASSET,
        ledger: 2,
        ownerType: 'SYSTEM',
      });

      // Second resolve call: DEPOSIT_SUSPENSE / CUSTOMER
      expect(accountingService.resolveTbAccountId).toHaveBeenNthCalledWith(2, {
        code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE,
        ledger: 2,
        ownerType: 'CUSTOMER',
        ownerUuid: 'cust-uuid-1',
      });

      expect(accountingService.executeTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          debitAccountId: 'tb-client-asset-id',
          creditAccountId: 'tb-suspense-id',
          code: TB_TRANSFER_CODES.DEPOSIT_ASSET_TO_SUSPENSE,
          evidence: expect.objectContaining({
            debitCode: 'A.CLIENT_ASSET',
            creditCode: 'L.DEPOSIT_SUSPENSE',
            // Phase B: both legs carry the customer's wallet, externalRef = txHash, crossing = true
            debitWalletRef: 'wallet-acc-1',
            creditWalletRef: 'wallet-acc-1',
            externalRef: '0xdeadbeef',
            isExternalCrossing: true,
          }),
        }),
      );
    });

    it('STEP_1: uses funds order referenceNo for a FIAT payin (type-based externalRef)', async () => {
      const fiatRefFundsOrder = {
        id: 'fo-acc-1',
        toWalletId: 'wallet-acc-1',
        // FIAT payin funds order: type-based resolver reads referenceNo (not txHash).
        asset: { type: 'FIAT' },
        txHash: null,
        referenceNo: 'BANK-REF-XYZ',
      };
      accountingService.resolveTbAccountId
        .mockResolvedValueOnce('tb-client-asset-id')
        .mockResolvedValueOnce('tb-suspense-id');

      await (service as any).executeDepositAccounting(baseDeposit, 'STEP_1', fiatRefFundsOrder);

      expect(accountingService.executeTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          evidence: expect.objectContaining({
            externalRef: 'BANK-REF-XYZ',
            isExternalCrossing: true,
          }),
        }),
      );
    });

    it('STEP_1: works the same for FIAT assets (no fiat/crypto branching for debit account)', async () => {
      const fiatDeposit = {
        ...baseDeposit,
        asset: { currency: 'USD', tbLedgerId: 3, decimals: 2, type: 'FIAT' },
      };

      accountingService.resolveTbAccountId
        .mockResolvedValueOnce('tb-client-asset-fiat-id')
        .mockResolvedValueOnce('tb-suspense-fiat-id');

      await (service as any).executeDepositAccounting(fiatDeposit, 'STEP_1', {
        id: 'fo-fiat-1',
        toWalletId: 'wallet-fiat-1',
        txHash: null,
        referenceNo: 'BANK-REF-FIAT',
      });

      // Debit must still be CLIENT_ASSET/SYSTEM — NOT CLIENT_BANK or CLIENT_CUSTODY
      expect(accountingService.resolveTbAccountId).toHaveBeenNthCalledWith(1, {
        code: TB_ACCOUNT_CODES.CLIENT_ASSET,
        ledger: 3,
        ownerType: 'SYSTEM',
      });

      expect(accountingService.executeTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          code: TB_TRANSFER_CODES.DEPOSIT_ASSET_TO_SUSPENSE,
        }),
      );
    });

    it('STEP_2: debits DEPOSIT_SUSPENSE/CUSTOMER and credits CLIENT_PAYABLE/CUSTOMER with DEPOSIT_SUSPENSE_TO_PAYABLE code', async () => {
      accountingService.resolveTbAccountId
        .mockResolvedValueOnce('tb-suspense-id')    // debit: DEPOSIT_SUSPENSE CUSTOMER
        .mockResolvedValueOnce('tb-payable-id');    // credit: CLIENT_PAYABLE CUSTOMER

      await (service as any).executeDepositAccounting(baseDeposit, 'STEP_2', cryptoFundsOrder);

      expect(accountingService.resolveTbAccountId).toHaveBeenNthCalledWith(1, {
        code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE,
        ledger: 2,
        ownerType: 'CUSTOMER',
        ownerUuid: 'cust-uuid-1',
      });

      expect(accountingService.resolveTbAccountId).toHaveBeenNthCalledWith(2, {
        code: TB_ACCOUNT_CODES.CLIENT_PAYABLE,
        ledger: 2,
        ownerType: 'CUSTOMER',
        ownerUuid: 'cust-uuid-1',
      });

      expect(accountingService.executeTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          debitAccountId: 'tb-suspense-id',
          creditAccountId: 'tb-payable-id',
          code: TB_TRANSFER_CODES.DEPOSIT_SUSPENSE_TO_PAYABLE,
          evidence: expect.objectContaining({
            debitCode: 'L.DEPOSIT_SUSPENSE',
            creditCode: 'L.CLIENT_PAYABLE',
            // Phase B: same wallet on both legs (pure ledger reclass), no external ref, not crossing
            debitWalletRef: 'wallet-acc-1',
            creditWalletRef: 'wallet-acc-1',
            externalRef: null,
            isExternalCrossing: false,
          }),
        }),
      );
    });
  });

  describe('applyKytVerdict — 展示投影回写(sumsubVerdict/sumsubScore)', () => {
    // 回归防线:新 KYT-only 管道曾经只驱动状态机、不回写展示字段,导致制裁命中冻结的
    // 单子在 admin 详情页 L2 仍显示 sumsubVerdict=null、风险分空白 —— operator 看不出
    // 这笔单为什么被冻(2026-07-29 live demo 实测发现)。
    function gateDeposit(id: string, status = DepositTransactionStatus.COMPLIANCE_PENDING) {
      return {
        id,
        depositNo: `DEP-${id}`,
        status,
        ownerType: 'FIRM',
        ownerId: 'firm-1',
        traceId: null,
        sumsubScore: null,
      };
    }

    it('rejected → updateSumsubVerdict 写原值 + 落风险分', async () => {
      const deposit = gateDeposit('dep-gate-1');
      depositService.findOne.mockResolvedValue(deposit);
      depositService.updateStatus.mockResolvedValue({ ...deposit });

      await service.applyKytVerdict('dep-gate-1', {
        verdict: 'rejected',
        riskScore: 98,
        sceneTag: 'SANCTION',
      });

      expect(depositService.updateSumsubVerdict).toHaveBeenCalledWith('dep-gate-1', 'rejected', 98);
    });

    it('onHold / awaitUser → 原值写回,不做任何翻译', async () => {
      const deposit = gateDeposit('dep-gate-3');
      depositService.findOne.mockResolvedValue(deposit);
      depositService.updateStatus.mockResolvedValue({ ...deposit });

      await service.applyKytVerdict('dep-gate-3', { verdict: 'onHold' });
      expect(depositService.updateSumsubVerdict).toHaveBeenCalledWith('dep-gate-3', 'onHold', null);

      await service.applyKytVerdict('dep-gate-3', { verdict: 'awaitUser' });
      expect(depositService.updateSumsubVerdict).toHaveBeenCalledWith(
        'dep-gate-3',
        'awaitUser',
        null,
      );
    });

    it('已终态的单:迟到 webhook 不覆写既有裁决', async () => {
      const deposit = gateDeposit('dep-gate-4', DepositTransactionStatus.SEIZED);
      depositService.findOne.mockResolvedValue(deposit);

      await service.applyKytVerdict('dep-gate-4', {
        verdict: 'approved',
        riskScore: 5,
      });

      expect(depositService.updateSumsubVerdict).not.toHaveBeenCalled();
    });

    it('detailRaw 透传 → saveTxnDetail 写 sumsubTxnDetailJson 列(两参,无 lane)', async () => {
      const deposit = gateDeposit('dep-gate-6');
      depositService.findOne.mockResolvedValue(deposit);
      depositService.updateStatus.mockResolvedValue({ ...deposit });

      const raw = { txnId: 'T-FIN', foo: 'bar' };
      await service.applyKytVerdict('dep-gate-6', {
        verdict: 'approved',
        riskScore: 10,
        detailRaw: raw,
      });

      expect(depositService.saveTxnDetail).toHaveBeenCalledWith(
        'dep-gate-6',
        JSON.stringify(raw),
      );
    });

    it('已终态的单:即便带 detailRaw 也不写报文(终态不被迟到 webhook 覆写)', async () => {
      const deposit = gateDeposit('dep-gate-8', DepositTransactionStatus.SEIZED);
      depositService.findOne.mockResolvedValue(deposit);

      await service.applyKytVerdict('dep-gate-8', {
        verdict: 'approved',
        riskScore: 5,
        detailRaw: { txnId: 'late' },
      });

      expect(depositService.saveTxnDetail).not.toHaveBeenCalled();
    });

    it('未给 detailRaw 时不调 saveTxnDetail', async () => {
      const deposit = gateDeposit('dep-gate-9');
      depositService.findOne.mockResolvedValue(deposit);
      depositService.updateStatus.mockResolvedValue({ ...deposit });

      await service.applyKytVerdict('dep-gate-9', { verdict: 'approved' });

      expect(depositService.saveTxnDetail).not.toHaveBeenCalled();
    });

    // 终审 Important #1:FROZEN 不在 KYT_VERDICT_TERMINAL_STATUSES 里,所以此前迟到/
    // 重评的 approved webhook 会先把 sumsubVerdict rejected→approved、再用 approved 报文
    // 覆写既有的制裁报文(sumsubScore 98→5),尽管状态机随后在 applyKytApproved 的
    // FROZEN 守卫处 no-op(不放行)。结果是 L2 闸门 + Sumsub Transaction Detail 块在一笔
    // 冻结单上渲染成 approved/无制裁证据 —— 制裁证据被静默损坏。
    it('FROZEN 单收到迟到 approved(带 detailRaw+riskScore)→ 不覆写既有制裁证据(writeBackVerdict/saveTxnDetail 均跳过)', async () => {
      const deposit = {
        ...gateDeposit('dep-gate-frozen', DepositTransactionStatus.FROZEN),
        sumsubVerdict: 'rejected',
        sumsubScore: 98,
      };
      depositService.findOne.mockResolvedValue(deposit);

      await service.applyKytVerdict('dep-gate-frozen', {
        verdict: 'approved',
        riskScore: 5,
        detailRaw: { txnId: 'late-approved', verdict: 'approved' },
      });

      expect(depositService.updateSumsubVerdict).not.toHaveBeenCalled();
      expect(depositService.saveTxnDetail).not.toHaveBeenCalled();
    });

    it('对照组:MANUAL_CHECKING 单收到 approved → 仍正常写回展示字段 + 存证(不受 FROZEN 护栏影响,它合法翻案到 SUCCESS)', async () => {
      const deposit = gateDeposit('dep-gate-manual', DepositTransactionStatus.MANUAL_CHECKING);
      depositService.findOne.mockResolvedValue(deposit);
      depositService.updateStatus.mockResolvedValue({ ...deposit, status: DepositTransactionStatus.SUCCESS });

      await service.applyKytVerdict('dep-gate-manual', {
        verdict: 'approved',
        riskScore: 3,
        detailRaw: { txnId: 'overturn-approved' },
      });

      expect(depositService.updateSumsubVerdict).toHaveBeenCalledWith('dep-gate-manual', 'approved', 3);
      expect(depositService.saveTxnDetail).toHaveBeenCalledWith(
        'dep-gate-manual',
        JSON.stringify({ txnId: 'overturn-approved' }),
      );
    });
  });

  describe('applyKytVerdict — Task 7 state transitions', () => {
    it('approved from COMPLIANCE_PENDING → delegates to approveDeposit (SUCCESS)', async () => {
      const deposit = {
        id: 'dep-1',
        depositNo: 'DEP001',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        ownerType: 'FIRM', // skip TB posting, focus on state transition
        ownerId: 'firm-1',
        traceId: null,
      };
      depositService.findOne.mockResolvedValue(deposit);
      depositService.updateStatus.mockResolvedValue({
        ...deposit,
        status: DepositTransactionStatus.SUCCESS,
      });

      await service.applyKytVerdict('dep-1', { verdict: 'approved' });

      expect(depositService.updateStatus).toHaveBeenCalledWith('dep-1', {
        action: DepositTransactionAction.APPROVE,
      });
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_APPROVED' }),
      );
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_MANUAL_APPROVED' }),
      );
    });

    it('approved from MANUAL_CHECKING → records DEPOSIT_MANUAL_APPROVED then approveDeposit → SUCCESS', async () => {
      const deposit = {
        id: 'dep-2',
        depositNo: 'DEP002',
        status: DepositTransactionStatus.MANUAL_CHECKING,
        ownerType: 'FIRM',
        ownerId: 'firm-1',
        traceId: null,
      };
      depositService.findOne.mockResolvedValue(deposit);
      depositService.updateStatus.mockResolvedValue({
        ...deposit,
        status: DepositTransactionStatus.SUCCESS,
      });

      await service.applyKytVerdict('dep-2', { verdict: 'approved' });

      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_MANUAL_APPROVED', entityId: 'dep-2' }),
      );
      expect(depositService.updateStatus).toHaveBeenCalledWith('dep-2', {
        action: DepositTransactionAction.APPROVE,
      });
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_COMPLETED' }),
      );
    });

    it('approved from ACTION_PENDING (补料重检:Sumsub 自动重评发 applicantKytTxnApproved)→ delegates to approveDeposit (SUCCESS), no DEPOSIT_MANUAL_APPROVED overturn record', async () => {
      const deposit = {
        id: 'dep-2b',
        depositNo: 'DEP002B',
        status: DepositTransactionStatus.ACTION_PENDING,
        ownerType: 'FIRM', // skip TB posting, focus on state transition
        ownerId: 'firm-1',
        traceId: null,
      };
      depositService.findOne.mockResolvedValue(deposit);
      depositService.updateStatus.mockResolvedValue({
        ...deposit,
        status: DepositTransactionStatus.SUCCESS,
      });

      // Sumsub 自动重评后发出的 applicantKytTxnApproved webhook → 已被
      // DepositKytVerdictHandler 翻译为 verdict='approved'(无需 DepositActionHandler)。
      await service.applyKytVerdict('dep-2b', { verdict: 'approved' });

      expect(depositService.updateStatus).toHaveBeenCalledWith('dep-2b', {
        action: DepositTransactionAction.APPROVE,
      });
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_APPROVED' }),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_COMPLETED' }),
      );
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_MANUAL_APPROVED' }),
      );
    });

    it('I1: approved but customer has no active fiat withdrawal address → held in COMPLIANCE_PENDING, DEPOSIT_HELD_NOT_TRADING_READY audit, NOT SUCCESS (trading-ready gate shared with checkAutoApproval)', async () => {
      const deposit = {
        id: 'dep-2c',
        depositNo: 'DEP002C',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-not-ready',
        traceId: null,
      };
      depositService.findOne.mockResolvedValue(deposit);
      withdrawalAddresses.hasActiveFiatWithdrawalAddress.mockResolvedValue(false);

      await service.applyKytVerdict('dep-2c', { verdict: 'approved' });

      expect(withdrawalAddresses.hasActiveFiatWithdrawalAddress).toHaveBeenCalledWith('cust-not-ready');
      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEPOSIT_HELD_NOT_TRADING_READY',
          entityId: 'dep-2c',
          entityNo: 'DEP002C',
        }),
      );
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_APPROVED' }),
      );
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_COMPLETED' }),
      );
    });

    it('fix(deposit): FROZEN → approved verdict (e.g. a re-scored/late applicantKytTxnApproved after a sanctions veto) is blocked — no-op, DEPOSIT_APPROVE_BLOCKED_FROZEN audit, deposit stays FROZEN, never reaches approveDeposit/TB', async () => {
      const deposit = {
        id: 'dep-frozen-1',
        depositNo: 'DEP-FROZEN-1',
        status: DepositTransactionStatus.FROZEN,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: 'trace-frozen-1',
      };
      depositService.findOne.mockResolvedValue(deposit);
      const approveSpy = jest.spyOn(service, 'approveDeposit');

      await service.applyKytVerdict('dep-frozen-1', { verdict: 'approved' });

      expect(withdrawalAddresses.hasActiveFiatWithdrawalAddress).not.toHaveBeenCalled();
      expect(approveSpy).not.toHaveBeenCalled();
      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEPOSIT_APPROVE_BLOCKED_FROZEN',
          entityId: 'dep-frozen-1',
          entityNo: 'DEP-FROZEN-1',
        }),
      );
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_APPROVED' }),
      );
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_COMPLETED' }),
      );
    });

    it('awaitUser + PEP → ACTION_PENDING with manualReason=EDD_PEP', async () => {
      const deposit = {
        id: 'dep-3',
        depositNo: 'DEP003',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: 'trace-3',
      };
      depositService.findOne.mockResolvedValue(deposit);
      depositService.updateStatus.mockResolvedValue({
        ...deposit,
        status: DepositTransactionStatus.ACTION_PENDING,
      });

      await service.applyKytVerdict('dep-3', { verdict: 'awaitUser', sceneTag: 'PEP' });

      // Minor a: slaDeadline is folded into the same updateStatus extraData write
      // (one atomic write), not a separate setSlaDeadline call.
      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'dep-3',
        expect.objectContaining({ action: DepositTransactionAction.ACTION_PENDING }),
        expect.objectContaining({
          extraData: { manualReason: 'EDD_PEP', slaDeadline: expect.any(Date) },
        }),
      );
      expect(depositService.setSlaDeadline).not.toHaveBeenCalled();
    });

    it('awaitUser without PEP → manualReason=CLIENT_ACTION', async () => {
      const deposit = {
        id: 'dep-3b',
        depositNo: 'DEP003B',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: null,
      };
      depositService.findOne.mockResolvedValue(deposit);
      depositService.updateStatus.mockResolvedValue({
        ...deposit,
        status: DepositTransactionStatus.ACTION_PENDING,
      });

      await service.applyKytVerdict('dep-3b', { verdict: 'awaitUser' });

      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'dep-3b',
        expect.objectContaining({ action: DepositTransactionAction.ACTION_PENDING }),
        expect.objectContaining({
          extraData: { manualReason: 'CLIENT_ACTION', slaDeadline: expect.any(Date) },
        }),
      );
      expect(depositService.setSlaDeadline).not.toHaveBeenCalled();
    });

    it('onHold → stays put, sets slaDeadline via setSlaDeadline, records DEPOSIT_ONHOLD', async () => {
      const deposit = {
        id: 'dep-4',
        depositNo: 'DEP004',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: null,
      };
      depositService.findOne.mockResolvedValue(deposit);

      await service.applyKytVerdict('dep-4', { verdict: 'onHold' });

      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(depositService.setSlaDeadline).toHaveBeenCalledWith('dep-4', expect.any(Date));
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_ONHOLD', entityId: 'dep-4' }),
      );
    });

    it('Minor b: late onHold on a deposit no longer in COMPLIANCE_PENDING (e.g. MANUAL_CHECKING) → no-op, no slaDeadline rewrite / no DEPOSIT_ONHOLD audit', async () => {
      const deposit = {
        id: 'dep-4b',
        depositNo: 'DEP004B',
        status: DepositTransactionStatus.MANUAL_CHECKING,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: null,
      };
      depositService.findOne.mockResolvedValue(deposit);

      await service.applyKytVerdict('dep-4b', { verdict: 'onHold' });

      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(depositService.setSlaDeadline).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_ONHOLD' }),
      );
    });

    it('rejected + SANCTION (from COMPLIANCE_PENDING) → FROZEN, zero accounting', async () => {
      const deposit = {
        id: 'dep-5',
        depositNo: 'DEP005',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: null,
      };
      depositService.findOne.mockResolvedValue(deposit);
      depositService.updateStatus.mockResolvedValue({
        ...deposit,
        status: DepositTransactionStatus.FROZEN,
      });

      await service.applyKytVerdict('dep-5', { verdict: 'rejected', sceneTag: 'SANCTION' });

      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'dep-5',
        expect.objectContaining({ action: DepositTransactionAction.FREEZE }),
        expect.anything(),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_FROZEN' }),
      );
      // Zero accounting: no TB/executeTransfer calls implied — accountingService not asserted here
      // since freeze never touches it (only updateStatus + audit).
    });

    it('rejected, no tag (from COMPLIANCE_PENDING) → MANUAL_CHECKING', async () => {
      const deposit = {
        id: 'dep-6',
        depositNo: 'DEP006',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: null,
      };
      depositService.findOne.mockResolvedValue(deposit);
      depositService.updateStatus.mockResolvedValue({
        ...deposit,
        status: DepositTransactionStatus.MANUAL_CHECKING,
      });

      await service.applyKytVerdict('dep-6', { verdict: 'rejected' });

      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'dep-6',
        expect.objectContaining({ action: DepositTransactionAction.MANUAL_CHECK }),
        expect.anything(),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_MANUAL_CHECKING' }),
      );
    });

    it('rejected + FROZEN_BY_MLRO (from MANUAL_CHECKING) → FROZEN', async () => {
      const deposit = {
        id: 'dep-7',
        depositNo: 'DEP007',
        status: DepositTransactionStatus.MANUAL_CHECKING,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: null,
      };
      depositService.findOne.mockResolvedValue(deposit);
      depositService.updateStatus.mockResolvedValue({
        ...deposit,
        status: DepositTransactionStatus.FROZEN,
      });

      await service.applyKytVerdict('dep-7', { verdict: 'rejected', dispoTag: 'FROZEN_BY_MLRO' });

      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'dep-7',
        expect.objectContaining({ action: DepositTransactionAction.FREEZE }),
        expect.anything(),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEPOSIT_FROZEN',
          reason: expect.stringContaining('MLRO'),
        }),
      );
    });

    // A2: RETURN_TO_SENDER no longer drives a direct status transition — it opens a
    // maker-checker approval instead (MLRO single-step). The deposit stays MANUAL_CHECKING;
    // real settlement + the RETURNING/RETURNED transition lands in A3.
    it('rejected + RETURN_TO_SENDER (from MANUAL_CHECKING) → opens a DEPOSIT_RETURN approval, stays MANUAL_CHECKING', async () => {
      const deposit = {
        id: 'dep-8',
        depositNo: 'DEP008',
        status: DepositTransactionStatus.MANUAL_CHECKING,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        assetId: 'asset-1',
        amount: '10',
        traceId: null,
        fromAddress: 'T_SENDER_ADDR',
        fromIban: null,
      };
      depositService.findOne.mockResolvedValue(deposit);
      approvalsService.list.mockResolvedValue({ total: 0, items: [] });
      approvalsService.createAndSubmit.mockResolvedValue({ id: 'app-ret-1', approvalNo: 'APR-RET-1' });

      await service.applyKytVerdict('dep-8', { verdict: 'rejected', dispoTag: 'RETURN_TO_SENDER' });

      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(approvalsService.createAndSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'DEPOSIT_RETURN', entityRef: 'dep-8' }),
        expect.anything(),
        expect.anything(),
      );
      expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_RETURN_APPROVAL_REQUESTED' }),
        expect.anything(),
      );
    });

    it('rejected + RETURN_TO_SENDER duplicate webhook while a return approval is already pending → idempotent no-op', async () => {
      const deposit = {
        id: 'dep-8b',
        depositNo: 'DEP008B',
        status: DepositTransactionStatus.MANUAL_CHECKING,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        assetId: 'asset-1',
        amount: '10',
        traceId: null,
        fromAddress: 'T_SENDER_ADDR',
        fromIban: null,
      };
      depositService.findOne.mockResolvedValue(deposit);
      approvalsService.list.mockResolvedValue({ total: 1, items: [{ id: 'existing' }] });

      await expect(
        service.applyKytVerdict('dep-8b', { verdict: 'rejected', dispoTag: 'RETURN_TO_SENDER' }),
      ).resolves.toBeUndefined();

      expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('no-op when deposit already terminal (SUCCESS)', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-9',
        depositNo: 'DEP009',
        status: DepositTransactionStatus.SUCCESS,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: null,
      });

      await service.applyKytVerdict('dep-9', { verdict: 'rejected', sceneTag: 'SANCTION' });

      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
    });

    it('no-op when already FROZEN and a duplicate rejected+SANCTION webhook arrives', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-10',
        depositNo: 'DEP010',
        status: DepositTransactionStatus.FROZEN,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: null,
      });

      await service.applyKytVerdict('dep-10', { verdict: 'rejected', sceneTag: 'SANCTION' });

      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
    });

    it('no-op when already ACTION_PENDING and a duplicate awaitUser webhook arrives', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-11',
        depositNo: 'DEP011',
        status: DepositTransactionStatus.ACTION_PENDING,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: null,
      });

      await service.applyKytVerdict('dep-11', { verdict: 'awaitUser', sceneTag: 'PEP' });

      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
    });

    it('no-op when already RETURNING and a duplicate rejected+RETURN_TO_SENDER webhook arrives', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-12',
        depositNo: 'DEP012',
        status: DepositTransactionStatus.RETURNING,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: null,
      });

      await service.applyKytVerdict('dep-12', { verdict: 'rejected', dispoTag: 'RETURN_TO_SENDER' });

      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
    });

    it('no-op when already MANUAL_CHECKING and a duplicate rejected (no tag) webhook arrives', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-13',
        depositNo: 'DEP013',
        status: DepositTransactionStatus.MANUAL_CHECKING,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: null,
      });

      await service.applyKytVerdict('dep-13', { verdict: 'rejected' });

      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
    });
  });

  describe('approveDeposit — oldStatus whitelist (fix: FROZEN→approve→SUCCESS single-operator release hole)', () => {
    it('called directly (e.g. via PATCH :id/status {action:approve}) on a FROZEN deposit → blocked: throws BadRequestException + records DEPOSIT_APPROVE_BLOCKED_FROZEN audit, stays FROZEN, no DEPOSIT_APPROVED/COMPLETED audit, no TB posting', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-frozen-direct',
        depositNo: 'DEP-FROZEN-DIRECT',
        status: DepositTransactionStatus.FROZEN,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: null,
      });

      await expect(service.approveDeposit('dep-frozen-direct')).rejects.toThrow(
        BadRequestException,
      );

      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(fundsOrders.findByParent).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEPOSIT_APPROVE_BLOCKED_FROZEN',
          entityId: 'dep-frozen-direct',
          entityNo: 'DEP-FROZEN-DIRECT',
        }),
      );
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_APPROVED' }),
      );
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_COMPLETED' }),
      );
    });
  });

  describe('onConfiscationDecided — confiscation start (C2, two-phase)', () => {
    let accountingService: {
      resolveTbAccountId: jest.Mock;
      executeTransfer: jest.Mock;
      executePendingTransfer: jest.Mock;
    };

    const decidedEvent = (overrides: Record<string, unknown> = {}) => ({
      decision: 'APPROVED' as const,
      actionType: 'DEPOSIT_CONFISCATION',
      entityRef: 'dep-cf-1',
      approvalId: 'app-cf-1',
      approvalNo: 'APR-CF-1',
      traceId: 'trace-cf-1',
      workflowType: 'DEPOSIT_CONFISCATION',
      metadata: {},
      ...overrides,
    });

    const confiscableDeposit = (overrides: Record<string, unknown> = {}) => ({
      id: 'dep-cf-1',
      depositNo: 'DEP-CF-001',
      status: DepositTransactionStatus.COMPLIANCE_PENDING,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-cf-1',
      assetId: 'asset-usdt',
      amount: '5',
      toWalletId: 'cust-wallet-1',
      toAddress: 'T_CUST_ADDR',
      toIban: null,
      traceId: 'trace-cf-1',
      limitHoldReason: 'BELOW_MIN',
      asset: { currency: 'USDT', tbLedgerId: 2, decimals: 6, type: 'CRYPTO' },
      ...overrides,
    });

    beforeEach(async () => {
      accountingService = {
        // leg1: DEPOSIT_SUSPENSE, CLIENT_ASSET ; leg2: FIRM_ASSET, FIRM_FEE
        resolveTbAccountId: jest.fn()
          .mockResolvedValueOnce('tb-suspense')
          .mockResolvedValueOnce('tb-client-asset')
          .mockResolvedValueOnce('tb-firm-asset')
          .mockResolvedValueOnce('tb-firm-fee'),
        executeTransfer: jest.fn().mockResolvedValue(undefined),
        executePendingTransfer: jest.fn().mockResolvedValue({ tbTransferId: 1n }),
      };
      fundsOrders.findByParent.mockResolvedValue([]);
      fundsOrders.create.mockResolvedValue({ id: 'fo-cf-1', fundsOrderNo: 'FO-CF-1', legSeq: 2, status: 'CREATED' });
      fundsOrders.advance.mockResolvedValue(undefined);
      depositService.updateStatus.mockResolvedValue({});

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DepositWorkflowService,
          { provide: DepositTransactionsService, useValue: depositService },
          { provide: FundsOrderService, useValue: fundsOrders },
          { provide: AuditLogsService, useValue: auditLogsService },
          { provide: AccountingService, useValue: accountingService },
          { provide: WithdrawalAddressService, useValue: withdrawalAddresses },
          { provide: SUMSUB_TXN_CLIENT, useValue: sumsubTxnClient },
          { provide: ApprovalsService, useValue: approvalsService },
          { provide: SystemWalletResolver, useValue: systemWalletResolver },
          { provide: TbEvidenceService, useValue: tbEvidenceService },
        ],
      }).compile();

      service = module.get<DepositWorkflowService>(DepositWorkflowService);
    });

    it('APPROVED → pends leg1 (reverse suspense) + leg2 (firm fee), funds order legSeq 2 CREATED (not advanced), CONFISCATING, STARTED audit', async () => {
      depositService.findOne.mockResolvedValue(confiscableDeposit());

      await service.onConfiscationDecided(decidedEvent());

      // Funds order legSeq 2: customer deposit wallet → firm F_FEE wallet, CREATED (advanceable, NOT auto-cleared).
      expect(systemWalletResolver.resolve).toHaveBeenCalledWith('asset-usdt', 'F_FEE');
      expect(fundsOrders.create).toHaveBeenCalledWith(
        expect.objectContaining({
          depositTransactionId: 'dep-cf-1',
          legSeq: 2,
          initialStatus: 'CREATED',
          fromWalletId: 'cust-wallet-1',
          toWalletId: 'fee-wallet-1',
        }),
      );
      expect(fundsOrders.advance).not.toHaveBeenCalled();

      // Leg 1 (pending): DR DEPOSIT_SUSPENSE(CUSTOMER) / CR CLIENT_ASSET(SYSTEM)
      expect(accountingService.resolveTbAccountId).toHaveBeenNthCalledWith(1, {
        code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ledger: 2, ownerType: 'CUSTOMER', ownerUuid: 'cust-cf-1',
      });
      expect(accountingService.resolveTbAccountId).toHaveBeenNthCalledWith(2, {
        code: TB_ACCOUNT_CODES.CLIENT_ASSET, ledger: 2, ownerType: 'SYSTEM',
      });
      expect(accountingService.executePendingTransfer).toHaveBeenNthCalledWith(1,
        expect.objectContaining({
          debitAccountId: 'tb-suspense',
          creditAccountId: 'tb-client-asset',
          code: TB_TRANSFER_CODES.DEPOSIT_CONFISCATE_SUSPENSE_TO_ASSET,
          timeout: 0,
          legIndex: 1,
          evidence: expect.objectContaining({
            // C3's post must reproduce this via deterministicTransferId('DEPOSIT', depositNo, eventCode, 1)
            eventCode: 'CONFISCATE_REVERSE_SUSPENSE',
            debitCode: 'L.DEPOSIT_SUSPENSE',
            creditCode: 'A.CLIENT_ASSET',
            debitWalletRef: 'cust-wallet-1',
            creditWalletRef: 'cust-wallet-1',
            isExternalCrossing: false,
          }),
        }),
      );

      // Leg 2 (pending): DR FIRM_ASSET(SYSTEM) / CR FIRM_FEE(SYSTEM)
      expect(accountingService.resolveTbAccountId).toHaveBeenNthCalledWith(3, {
        code: TB_ACCOUNT_CODES.FIRM_ASSET, ledger: 2, ownerType: 'SYSTEM',
      });
      expect(accountingService.resolveTbAccountId).toHaveBeenNthCalledWith(4, {
        code: TB_ACCOUNT_CODES.FIRM_FEE, ledger: 2, ownerType: 'SYSTEM',
      });
      expect(accountingService.executePendingTransfer).toHaveBeenNthCalledWith(2,
        expect.objectContaining({
          debitAccountId: 'tb-firm-asset',
          creditAccountId: 'tb-firm-fee',
          code: TB_TRANSFER_CODES.DEPOSIT_CONFISCATE_FIRM_FEE,
          timeout: 0,
          legIndex: 1,
          evidence: expect.objectContaining({
            eventCode: 'CONFISCATE_FIRM_FEE',
            debitCode: 'A.FIRM_ASSET',
            creditCode: 'E.FIRM_FEE',
            debitWalletRef: null,
            creditWalletRef: 'fee-wallet-1',
            isExternalCrossing: false,
          }),
        }),
      );

      // Never the synchronous post — pending only in the start half.
      expect(accountingService.executeTransfer).not.toHaveBeenCalled();

      // 先账后状态: deposit → CONFISCATING via CONFISCATE_START (via the service, Rule 5).
      expect(depositService.updateStatus).toHaveBeenCalledWith('dep-cf-1',
        expect.objectContaining({ action: DepositTransactionAction.CONFISCATE_START }),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEPOSIT_CONFISCATION_STARTED',
          metadata: expect.objectContaining({ approvalNo: 'APR-CF-1' }),
        }),
      );
    });

    it('startConfiscation: CREATED legSeq2 funds order, pends 2 legs, deposit → CONFISCATING', async () => {
      const dep = confiscableDeposit();
      fundsOrders.findByParent.mockResolvedValue([]);
      fundsOrders.create.mockResolvedValue({ id: 'fo2', fundsOrderNo: 'FO-2', legSeq: 2, status: 'CREATED' });
      systemWalletResolver.resolve.mockResolvedValue({ id: 'firmFee', address: null, iban: null });
      accountingService.resolveTbAccountId.mockResolvedValue('acct');
      await (service as any).startConfiscation(dep, 'APR-1');
      expect(fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({ legSeq: 2, initialStatus: 'CREATED' }));
      expect(fundsOrders.advance).not.toHaveBeenCalled();
      expect(accountingService.executePendingTransfer).toHaveBeenCalledTimes(2);
      expect(accountingService.executeTransfer).not.toHaveBeenCalled();
      expect(depositService.updateStatus).toHaveBeenCalledWith(
        dep.id, expect.objectContaining({ action: DepositTransactionAction.CONFISCATE_START }),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_CONFISCATION_STARTED' }),
      );
    });

    it('startConfiscation idempotent: reuses existing legSeq2 funds order', async () => {
      const dep = confiscableDeposit();
      fundsOrders.findByParent.mockResolvedValue([{ id: 'fo2', fundsOrderNo: 'FO-2', legSeq: 2, status: 'CREATED' }]);
      systemWalletResolver.resolve.mockResolvedValue({ id: 'firmFee', address: null, iban: null });
      accountingService.resolveTbAccountId.mockResolvedValue('acct');
      await (service as any).startConfiscation(dep, 'APR-1');
      expect(fundsOrders.create).not.toHaveBeenCalled();
    });

    it('DECLINED → no-op (no legs, no funds order, status unchanged)', async () => {
      depositService.findOne.mockResolvedValue(confiscableDeposit());

      await service.onConfiscationDecided(decidedEvent({ decision: 'DECLINED' }));

      expect(fundsOrders.create).not.toHaveBeenCalled();
      expect(accountingService.executeTransfer).not.toHaveBeenCalled();
      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('foreign entityRef (deposit not found) → graceful no-op', async () => {
      depositService.findOne.mockRejectedValue(new NotFoundException('Deposit transaction not found'));

      await expect(service.onConfiscationDecided(decidedEvent())).resolves.toBeUndefined();

      expect(fundsOrders.create).not.toHaveBeenCalled();
      expect(accountingService.executeTransfer).not.toHaveBeenCalled();
      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('already CONFISCATED deposit (replayed decided event) → no-op', async () => {
      depositService.findOne.mockResolvedValue(
        confiscableDeposit({ status: DepositTransactionStatus.CONFISCATED }),
      );

      await service.onConfiscationDecided(decidedEvent());

      expect(accountingService.executeTransfer).not.toHaveBeenCalled();
      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    // C3 guard fix: a replayed APPROVED decided event that arrives while the deposit is
    // already CONFISCATING (start half done, settle in flight) must be a clean no-op — NOT
    // a misleading "drifted out of confiscable state" FAILED audit, and NOT a second start.
    it('onConfiscationDecided replay while CONFISCATING → no-op (no FAILED audit, no double start)', async () => {
      depositService.findOne.mockResolvedValue(
        confiscableDeposit({ status: DepositTransactionStatus.CONFISCATING }),
      );

      await service.onConfiscationDecided(decidedEvent());

      expect(accountingService.executePendingTransfer).not.toHaveBeenCalled();
      expect(fundsOrders.create).not.toHaveBeenCalled();
      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_CONFISCATION_FAILED' }),
      );
    });

    // Double-spend regression guard (D7 review): initiateConfiscation writes nothing to
    // the deposit, so a concurrent waiveLimitHold→approve (SUCCESS) or adminReject
    // (REJECTED) can drift it out of the confiscable state while the approval is PENDING.
    // The APPROVED decided event must then post NOTHING (else CLIENT_ASSET is zeroed while
    // CLIENT_PAYABLE still owes the now-credited customer → phantom liability).
    it('drift race: deposit already SUCCESS (waived→approved) → posts nothing, records FAILED audit', async () => {
      depositService.findOne.mockResolvedValue(
        confiscableDeposit({ status: DepositTransactionStatus.SUCCESS, limitHoldReason: null }),
      );

      await service.onConfiscationDecided(decidedEvent());

      expect(accountingService.executeTransfer).not.toHaveBeenCalled();
      expect(fundsOrders.create).not.toHaveBeenCalled();
      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEPOSIT_CONFISCATION_FAILED',
          reason: expect.stringContaining('drifted out of confiscable state'),
        }),
      );
    });

    it('drift race: deposit REJECTED after initiate → posts nothing, records FAILED audit', async () => {
      depositService.findOne.mockResolvedValue(
        confiscableDeposit({ status: DepositTransactionStatus.REJECTED }),
      );

      await service.onConfiscationDecided(decidedEvent());

      expect(accountingService.executeTransfer).not.toHaveBeenCalled();
      expect(fundsOrders.create).not.toHaveBeenCalled();
      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_CONFISCATION_FAILED' }),
      );
    });

    it('pending transfer throws → rethrows, deposit NOT flipped to CONFISCATING, no STARTED audit (先账后状态)', async () => {
      depositService.findOne.mockResolvedValue(confiscableDeposit());
      accountingService.executePendingTransfer.mockRejectedValueOnce(new Error('TB rejected'));

      await expect(service.onConfiscationDecided(decidedEvent())).rejects.toThrow('TB rejected');

      // Deposit must remain COMPLIANCE_PENDING — CONFISCATE_START transition never applied.
      expect(depositService.updateStatus).not.toHaveBeenCalledWith('dep-cf-1', expect.objectContaining({
        action: DepositTransactionAction.CONFISCATE_START,
      }));
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_CONFISCATION_STARTED' }),
      );
    });
  });

  describe('handleFundsOrderChanged — legSeq2 confiscation settle (C3)', () => {
    let accountingService: {
      resolveTbAccountId: jest.Mock;
      executeTransfer: jest.Mock;
      executePendingTransfer: jest.Mock;
      postPendingTransfer: jest.Mock;
    };

    const baseDeposit = (overrides: Record<string, unknown> = {}) => ({
      id: 'dep-1',
      depositNo: 'DEP-CF-001',
      status: DepositTransactionStatus.CONFISCATING,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      amount: '5',
      traceId: 'trace-1',
      asset: { currency: 'USDT', tbLedgerId: 2, decimals: 6, type: 'CRYPTO' },
      ...overrides,
    });

    const legEvent = (overrides: Record<string, unknown> = {}) => ({
      fundsOrderId: 'fo2',
      fundsOrderNo: 'FO-CF-2',
      parent: { depositTransactionId: 'dep-1' },
      legSeq: 2,
      attempt: 1,
      oldStatus: 'CREATED',
      newStatus: 'CONFIRMED',
      ...overrides,
    });

    beforeEach(async () => {
      accountingService = {
        resolveTbAccountId: jest.fn(),
        executeTransfer: jest.fn().mockResolvedValue(undefined),
        executePendingTransfer: jest.fn().mockResolvedValue({ tbTransferId: 1n }),
        postPendingTransfer: jest.fn().mockResolvedValue(undefined),
      };
      depositService.updateStatus.mockResolvedValue({});

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DepositWorkflowService,
          { provide: DepositTransactionsService, useValue: depositService },
          { provide: FundsOrderService, useValue: fundsOrders },
          { provide: AuditLogsService, useValue: auditLogsService },
          { provide: AccountingService, useValue: accountingService },
          { provide: WithdrawalAddressService, useValue: withdrawalAddresses },
          { provide: SUMSUB_TXN_CLIENT, useValue: sumsubTxnClient },
          { provide: ApprovalsService, useValue: approvalsService },
          { provide: SystemWalletResolver, useValue: systemWalletResolver },
          { provide: TbEvidenceService, useValue: tbEvidenceService },
        ],
      }).compile();

      service = module.get<DepositWorkflowService>(DepositWorkflowService);
    });

    it('handleFundsOrderChanged: legSeq2 CONFIRMED → posts 2 legs → CONFISCATED', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit({ status: 'CONFISCATING' }));
      accountingService.postPendingTransfer.mockResolvedValue(undefined);

      await service.handleFundsOrderChanged(legEvent() as any);

      expect(accountingService.postPendingTransfer).toHaveBeenCalledTimes(2);
      expect(depositService.updateStatus).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ action: DepositTransactionAction.CONFISCATE_SETTLE }),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_CONFISCATION_EXECUTED' }),
      );
    });

    it('settle: post fails 3× → stays CONFISCATING + FAILED audit (no settle)', async () => {
      const dep = baseDeposit({ status: 'CONFISCATING' });
      depositService.findOne.mockResolvedValue(dep);
      accountingService.postPendingTransfer.mockRejectedValue(new Error('TB down'));

      await (service as any).settleConfiscation(dep, 'fo2');

      // leg1 rejects on every attempt → 1 call/attempt = 3 total (leg2 never reached).
      expect(accountingService.postPendingTransfer).toHaveBeenCalledTimes(3);
      expect(depositService.updateStatus).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ action: DepositTransactionAction.CONFISCATE_SETTLE }),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_CONFISCATION_FAILED' }),
      );
    });

    it('settle idempotent: deposit already CONFISCATED → no-op', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit({ status: 'CONFISCATED' }));

      await service.handleFundsOrderChanged(legEvent() as any);

      expect(accountingService.postPendingTransfer).not.toHaveBeenCalled();
    });

    it('legSeq2 non-CONFIRMED status → no settle (e.g. SUBMITTED)', async () => {
      await service.handleFundsOrderChanged(legEvent({ newStatus: 'SUBMITTED' }) as any);

      expect(accountingService.postPendingTransfer).not.toHaveBeenCalled();
    });
  });

  // A3: onReturnApproved fills in the real return-leg start (previously a stub —
  // see A2). Mirrors startConfiscation's structure: single pending leg (DR
  // DEPOSIT_SUSPENSE(CUSTOMER) / CR CLIENT_ASSET(SYSTEM) — same reverse-suspense
  // direction as confiscation's leg1) + legSeq 3 funds order (confiscation owns
  // legSeq 2) whose destination is the ORIGINAL SENDER (deposit.fromAddress/
  // fromIban), not a firm wallet. 先账后状态: pending leg booked BEFORE the
  // MANUAL_CHECKING → RETURNING transition, so a TB failure never leaves the
  // deposit "in transit" without an actual lock.
  describe('onReturnApproved — return leg start (A3)', () => {
    let accountingService: {
      resolveTbAccountId: jest.Mock;
      executeTransfer: jest.Mock;
      executePendingTransfer: jest.Mock;
    };

    const returnableDeposit = (overrides: Record<string, unknown> = {}) => ({
      id: 'dep-rt-1',
      depositNo: 'DEP-RT-001',
      status: DepositTransactionStatus.MANUAL_CHECKING,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-rt-1',
      assetId: 'asset-usdt',
      amount: '5',
      toWalletId: 'cust-wallet-1',
      toAddress: 'T_CUST_ADDR',
      toIban: null,
      fromAddress: 'T_SENDER_ADDR',
      fromIban: null,
      traceId: 'trace-rt-1',
      asset: { currency: 'USDT', tbLedgerId: 2, decimals: 6, type: 'CRYPTO' },
      ...overrides,
    });

    beforeEach(async () => {
      accountingService = {
        resolveTbAccountId: jest.fn()
          .mockResolvedValueOnce('tb-suspense')
          .mockResolvedValueOnce('tb-client-asset'),
        executeTransfer: jest.fn().mockResolvedValue(undefined),
        executePendingTransfer: jest.fn().mockResolvedValue({ tbTransferId: 1n }),
      };
      fundsOrders.findByParent.mockResolvedValue([]);
      fundsOrders.create.mockResolvedValue({ id: 'fo-rt-1', fundsOrderNo: 'FO-RT-1', legSeq: 3, attempt: 1, status: 'CREATED' });
      depositService.updateStatus.mockResolvedValue({});

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DepositWorkflowService,
          { provide: DepositTransactionsService, useValue: depositService },
          { provide: FundsOrderService, useValue: fundsOrders },
          { provide: AuditLogsService, useValue: auditLogsService },
          { provide: AccountingService, useValue: accountingService },
          { provide: WithdrawalAddressService, useValue: withdrawalAddresses },
          { provide: SUMSUB_TXN_CLIENT, useValue: sumsubTxnClient },
          { provide: ApprovalsService, useValue: approvalsService },
          { provide: SystemWalletResolver, useValue: systemWalletResolver },
          { provide: TbEvidenceService, useValue: tbEvidenceService },
        ],
      }).compile();

      service = module.get<DepositWorkflowService>(DepositWorkflowService);
    });

    it('MANUAL_CHECKING → creates legSeq 3 funds order (CREATED), pends reverse-suspense leg, RETURNING, STARTED audit', async () => {
      const dep = returnableDeposit();

      await (service as any).onReturnApproved(dep);

      // Funds order legSeq 3: platform receiving wallet → external original sender
      // (fromAddress/fromIban), CREATED (advanceable, NOT auto-cleared).
      expect(fundsOrders.create).toHaveBeenCalledWith(
        expect.objectContaining({
          depositTransactionId: 'dep-rt-1',
          legSeq: 3,
          initialStatus: 'CREATED',
          fromWalletId: 'cust-wallet-1',
          toWalletId: null,
          toAddress: 'T_SENDER_ADDR',
        }),
      );

      // Pending leg: DR DEPOSIT_SUSPENSE(CUSTOMER) / CR CLIENT_ASSET(SYSTEM) —
      // same direction as confiscation's leg1 (zeroes the customer's suspense).
      expect(accountingService.resolveTbAccountId).toHaveBeenNthCalledWith(1, {
        code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ledger: 2, ownerType: 'CUSTOMER', ownerUuid: 'cust-rt-1',
      });
      expect(accountingService.resolveTbAccountId).toHaveBeenNthCalledWith(2, {
        code: TB_ACCOUNT_CODES.CLIENT_ASSET, ledger: 2, ownerType: 'SYSTEM',
      });
      expect(accountingService.executePendingTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          debitAccountId: 'tb-suspense',
          creditAccountId: 'tb-client-asset',
          code: TB_TRANSFER_CODES.DEPOSIT_RETURN_PENDING,
          timeout: 0,
          legIndex: 1,
          evidence: expect.objectContaining({
            // settleReturn/onReturnLegFailed must reproduce this via
            // deterministicTransferId('DEPOSIT', depositNo, eventCode, attempt)
            eventCode: 'DEPOSIT_RETURN_PENDING',
            debitCode: 'L.DEPOSIT_SUSPENSE',
            creditCode: 'A.CLIENT_ASSET',
            debitWalletRef: 'cust-wallet-1',
            creditWalletRef: 'cust-wallet-1',
            isExternalCrossing: true,
          }),
        }),
      );

      expect(accountingService.executeTransfer).not.toHaveBeenCalled();

      // 先账后状态: deposit → RETURNING via RETURN action (via the service, Rule 5).
      expect(depositService.updateStatus).toHaveBeenCalledWith('dep-rt-1',
        expect.objectContaining({ action: DepositTransactionAction.RETURN }),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_RETURN_STARTED' }),
      );
    });

    it('idempotent: reuses existing legSeq 3 funds order (no duplicate create)', async () => {
      fundsOrders.findByParent.mockResolvedValue([
        { id: 'fo-rt-1', fundsOrderNo: 'FO-RT-1', legSeq: 3, attempt: 1, status: 'CREATED' },
      ]);
      const dep = returnableDeposit();

      await (service as any).onReturnApproved(dep);

      expect(fundsOrders.create).not.toHaveBeenCalled();
      expect(accountingService.executePendingTransfer).toHaveBeenCalledTimes(1);
    });

    it('no-op when deposit is not MANUAL_CHECKING (e.g. replayed decided event after already RETURNING)', async () => {
      const dep = returnableDeposit({ status: DepositTransactionStatus.RETURNING });

      await (service as any).onReturnApproved(dep);

      expect(fundsOrders.create).not.toHaveBeenCalled();
      expect(accountingService.executePendingTransfer).not.toHaveBeenCalled();
      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('pending transfer throws → rethrows, deposit NOT flipped to RETURNING, no STARTED audit (先账后状态)', async () => {
      accountingService.executePendingTransfer.mockRejectedValueOnce(new Error('TB rejected'));
      const dep = returnableDeposit();

      await expect((service as any).onReturnApproved(dep)).rejects.toThrow('TB rejected');

      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_RETURN_STARTED' }),
      );
    });
  });

  // A3: legSeq 3 return-leg settle (external confirm → POST → RETURNED) and
  // fail/retry (external FAILED/TIMEOUT → VOID → rebuild leg, up to 3 attempts).
  describe('handleFundsOrderChanged — legSeq3 return settle/fail (A3)', () => {
    let accountingService: {
      resolveTbAccountId: jest.Mock;
      executeTransfer: jest.Mock;
      executePendingTransfer: jest.Mock;
      postPendingTransfer: jest.Mock;
      voidPendingTransfer: jest.Mock;
    };

    const baseDeposit = (overrides: Record<string, unknown> = {}) => ({
      id: 'dep-rt-2',
      depositNo: 'DEP-RT-002',
      status: DepositTransactionStatus.RETURNING,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-rt-2',
      amount: '5',
      toWalletId: 'cust-wallet-2',
      toAddress: 'T_CUST_ADDR_2',
      toIban: null,
      fromAddress: 'T_SENDER_ADDR_2',
      fromIban: null,
      assetId: 'asset-usdt',
      traceId: 'trace-rt-2',
      asset: { currency: 'USDT', tbLedgerId: 2, decimals: 6, type: 'CRYPTO' },
      ...overrides,
    });

    const legEvent = (overrides: Record<string, unknown> = {}) => ({
      fundsOrderId: 'fo-rt-2',
      fundsOrderNo: 'FO-RT-2',
      parent: { depositTransactionId: 'dep-rt-2' },
      legSeq: 3,
      attempt: 1,
      oldStatus: 'CONFIRMING',
      newStatus: 'CONFIRMED',
      ...overrides,
    });

    beforeEach(async () => {
      accountingService = {
        resolveTbAccountId: jest.fn().mockResolvedValue('acct'),
        executeTransfer: jest.fn().mockResolvedValue(undefined),
        executePendingTransfer: jest.fn().mockResolvedValue({ tbTransferId: 1n }),
        postPendingTransfer: jest.fn().mockResolvedValue(undefined),
        voidPendingTransfer: jest.fn().mockResolvedValue(undefined),
      };
      fundsOrders.findById.mockResolvedValue({
        id: 'fo-rt-2', fundsOrderNo: 'FO-RT-2', legSeq: 3, attempt: 1,
        asset: { type: 'CRYPTO' }, txHash: '0xabc',
      });
      fundsOrders.create.mockResolvedValue({ id: 'fo-rt-3', fundsOrderNo: 'FO-RT-3', legSeq: 3, attempt: 2, status: 'CREATED' });
      depositService.updateStatus.mockResolvedValue({});

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DepositWorkflowService,
          { provide: DepositTransactionsService, useValue: depositService },
          { provide: FundsOrderService, useValue: fundsOrders },
          { provide: AuditLogsService, useValue: auditLogsService },
          { provide: AccountingService, useValue: accountingService },
          { provide: WithdrawalAddressService, useValue: withdrawalAddresses },
          { provide: SUMSUB_TXN_CLIENT, useValue: sumsubTxnClient },
          { provide: ApprovalsService, useValue: approvalsService },
          { provide: SystemWalletResolver, useValue: systemWalletResolver },
          { provide: TbEvidenceService, useValue: tbEvidenceService },
        ],
      }).compile();

      service = module.get<DepositWorkflowService>(DepositWorkflowService);
    });

    it('legSeq3 CONFIRMED → posts pending, enriches externalRef, RETURNED, DEPOSIT_RETURNED audit', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit());

      await service.handleFundsOrderChanged(legEvent() as any);

      expect(accountingService.postPendingTransfer).toHaveBeenCalledTimes(1);
      expect(accountingService.postPendingTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          pendingTransferId: deterministicTransferId('DEPOSIT', 'DEP-RT-002', 'DEPOSIT_RETURN_PENDING', 1),
        }),
      );
      expect(tbEvidenceService.enrichForPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ eventCode: 'DEPOSIT_RETURN_POST', externalRef: '0xabc', isExternalCrossing: true }),
      );
      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'dep-rt-2',
        expect.objectContaining({ action: DepositTransactionAction.RETURNED_DONE }),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_RETURNED' }),
      );
    });

    it('settle: post fails 3× → stays RETURNING + STUCK audit (no RETURNED)', async () => {
      const dep = baseDeposit();
      accountingService.postPendingTransfer.mockRejectedValue(new Error('TB down'));

      await (service as any).settleReturn(dep, 'fo-rt-2', 1);

      expect(accountingService.postPendingTransfer).toHaveBeenCalledTimes(3);
      expect(depositService.updateStatus).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ action: DepositTransactionAction.RETURNED_DONE }),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_RETURN_STUCK' }),
      );
    });

    it('settle idempotent: deposit no longer RETURNING → no-op', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit({ status: 'RETURNED' }));

      await service.handleFundsOrderChanged(legEvent() as any);

      expect(accountingService.postPendingTransfer).not.toHaveBeenCalled();
    });

    it('legSeq3 FAILED, attempt < 3 → voids pending, rebuilds leg (attempt+1), RETRIED audit, stays RETURNING', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit());

      await service.handleFundsOrderChanged(legEvent({ newStatus: 'FAILED', attempt: 1 }) as any);

      const oldPendingId = deterministicTransferId('DEPOSIT', 'DEP-RT-002', 'DEPOSIT_RETURN_PENDING', 1);
      const newPendingId = deterministicTransferId('DEPOSIT', 'DEP-RT-002', 'DEPOSIT_RETURN_PENDING', 2);
      expect(newPendingId).not.toEqual(oldPendingId); // rebuilt attempt must not collide with the voided one

      expect(accountingService.voidPendingTransfer).toHaveBeenCalledTimes(1);
      expect(accountingService.voidPendingTransfer).toHaveBeenCalledWith(
        expect.objectContaining({ pendingTransferId: oldPendingId }),
      );
      expect(fundsOrders.create).toHaveBeenCalledWith(
        expect.objectContaining({ depositTransactionId: 'dep-rt-2', legSeq: 3, attempt: 2, initialStatus: 'CREATED' }),
      );
      expect(accountingService.executePendingTransfer).toHaveBeenCalledWith(
        expect.objectContaining({ legIndex: 2 }),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_RETURN_RETRIED' }),
      );
      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('legSeq3 TIMEOUT at attempt 3 (exhausted) → voids pending, no rebuild, STUCK audit, stays RETURNING', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit());

      await service.handleFundsOrderChanged(legEvent({ newStatus: 'TIMEOUT', attempt: 3 }) as any);

      expect(accountingService.voidPendingTransfer).toHaveBeenCalledTimes(1);
      expect(accountingService.voidPendingTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          pendingTransferId: deterministicTransferId('DEPOSIT', 'DEP-RT-002', 'DEPOSIT_RETURN_PENDING', 3),
        }),
      );
      expect(fundsOrders.create).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_RETURN_STUCK' }),
      );
      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('legSeq3 non-CONFIRMED/FAILED/TIMEOUT status → no-op (e.g. SUBMITTED)', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit());

      await service.handleFundsOrderChanged(legEvent({ newStatus: 'SUBMITTED' }) as any);

      expect(accountingService.postPendingTransfer).not.toHaveBeenCalled();
      expect(accountingService.voidPendingTransfer).not.toHaveBeenCalled();
    });

    // Fix 2: onReturnLegFailed is a fire-and-forget @OnEvent downstream — its
    // external calls (voidPendingTransfer, fundsOrders.create, pendReturnSuspense)
    // must never throw uncaught, or it escapes as an unhandled rejection. Mirrors
    // settleReturn's own try/catch.
    it('Fix 2: voidPendingTransfer throws → does not throw, writes DEPOSIT_RETURN_STUCK audit, deposit stays RETURNING (in-flight, no revert)', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit());
      accountingService.voidPendingTransfer.mockRejectedValueOnce(new Error('TB unreachable'));

      await expect(
        service.handleFundsOrderChanged(legEvent({ newStatus: 'FAILED', attempt: 1 }) as any),
      ).resolves.toBeUndefined();

      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEPOSIT_RETURN_STUCK',
          reason: expect.stringContaining('TB unreachable'),
        }),
      );
      expect(fundsOrders.create).not.toHaveBeenCalled(); // never got to the rebuild step
      expect(depositService.updateStatus).not.toHaveBeenCalled(); // stays RETURNING
    });
  });

  // A4: onSeizeApproved fills in the real seize-leg start (previously a stub —
  // see A2). Mirrors onReturnApproved's structure exactly, including the credit
  // account: final-review correction (2026-07-28) traced the A6 COA break to the
  // leg crediting FIRM_SEIZED instead of CLIENT_ASSET — fixing that makes the
  // single leg self-balancing on its own, so the two-leg version (A7) was
  // reverted. Destination (toWalletId/toAddress/toIban) is deliberately left
  // BLANK — no government/law-enforcement receiving account is modeled (owner
  // decision 2026-07-28); orderRef (fetched from the APPROVED DEPOSIT_SEIZE
  // case's objectSnapshot) is the sole 8-year retention anchor, carried in the
  // pending lock's evidence.memo.
  describe('onSeizeApproved — seize leg start (A4)', () => {
    let accountingService: {
      resolveTbAccountId: jest.Mock;
      executeTransfer: jest.Mock;
      executePendingTransfer: jest.Mock;
    };

    const seizableDeposit = (overrides: Record<string, unknown> = {}) => ({
      id: 'dep-sz-1',
      depositNo: 'DEP-SZ-001',
      status: DepositTransactionStatus.FROZEN,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-sz-1',
      assetId: 'asset-usdt',
      amount: '5',
      toWalletId: 'cust-wallet-sz-1',
      toAddress: 'T_CUST_ADDR_SZ',
      toIban: null,
      traceId: 'trace-sz-1',
      asset: { currency: 'USDT', tbLedgerId: 2, decimals: 6, type: 'CRYPTO' },
      ...overrides,
    });

    const approvedSeizeCase = (orderRef = 'ORD-SZ-1') => ({
      total: 1,
      items: [{ id: 'app-sz-1', objectSnapshot: { depositNo: 'DEP-SZ-001', orderRef } }],
    });

    beforeEach(async () => {
      accountingService = {
        // DEPOSIT_SUSPENSE, CLIENT_ASSET — single leg
        resolveTbAccountId: jest.fn()
          .mockResolvedValueOnce('tb-suspense')
          .mockResolvedValueOnce('tb-client-asset'),
        executeTransfer: jest.fn().mockResolvedValue(undefined),
        executePendingTransfer: jest.fn().mockResolvedValue({ tbTransferId: 1n }),
      };
      fundsOrders.findByParent.mockResolvedValue([]);
      fundsOrders.create.mockResolvedValue({ id: 'fo-sz-1', fundsOrderNo: 'FO-SZ-1', legSeq: 4, attempt: 1, status: 'CREATED' });
      depositService.updateStatus.mockResolvedValue({});
      approvalsService.list.mockResolvedValue(approvedSeizeCase());

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DepositWorkflowService,
          { provide: DepositTransactionsService, useValue: depositService },
          { provide: FundsOrderService, useValue: fundsOrders },
          { provide: AuditLogsService, useValue: auditLogsService },
          { provide: AccountingService, useValue: accountingService },
          { provide: WithdrawalAddressService, useValue: withdrawalAddresses },
          { provide: SUMSUB_TXN_CLIENT, useValue: sumsubTxnClient },
          { provide: ApprovalsService, useValue: approvalsService },
          { provide: SystemWalletResolver, useValue: systemWalletResolver },
          { provide: TbEvidenceService, useValue: tbEvidenceService },
        ],
      }).compile();

      service = module.get<DepositWorkflowService>(DepositWorkflowService);
    });

    it('FROZEN → creates legSeq 4 funds order (CREATED) with BLANK destination, pends reverse-suspense into CLIENT_ASSET, SEIZING, STARTED audit with orderRef', async () => {
      const dep = seizableDeposit();

      await (service as any).onSeizeApproved(dep);

      expect(approvalsService.list).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'DEPOSIT_SEIZE', entityRef: 'dep-sz-1', status: 'APPROVED' }),
      );

      // Funds order legSeq 4: destination is deliberately blank (no government/
      // law-enforcement account modeled) — only the source side (fromWalletId/
      // fromAddress, the customer's original receiving wallet) is populated.
      expect(fundsOrders.create).toHaveBeenCalledWith(
        expect.objectContaining({
          depositTransactionId: 'dep-sz-1',
          legSeq: 4,
          initialStatus: 'CREATED',
          fromWalletId: 'cust-wallet-sz-1',
          toWalletId: null,
          toAddress: undefined,
          toIban: undefined,
        }),
      );

      // Single pending leg (final-review correction — mirrors pendReturnSuspense):
      // DR DEPOSIT_SUSPENSE(CUSTOMER) / CR CLIENT_ASSET(SYSTEM) — zeroes the
      // customer's suspense AND shrinks custodial CLIENT_ASSET (money genuinely
      // leaves custody for the government).
      expect(accountingService.resolveTbAccountId).toHaveBeenNthCalledWith(1, {
        code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ledger: 2, ownerType: 'CUSTOMER', ownerUuid: 'cust-sz-1',
      });
      expect(accountingService.resolveTbAccountId).toHaveBeenNthCalledWith(2, {
        code: TB_ACCOUNT_CODES.CLIENT_ASSET, ledger: 2, ownerType: 'SYSTEM',
      });
      expect(accountingService.executePendingTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          debitAccountId: 'tb-suspense',
          creditAccountId: 'tb-client-asset',
          code: TB_TRANSFER_CODES.DEPOSIT_SEIZE_PENDING,
          timeout: 0,
          legIndex: 1,
          evidence: expect.objectContaining({
            // settleSeize/onSeizeLegFailed must reproduce this via
            // deterministicTransferId('DEPOSIT', depositNo, eventCode, attempt)
            eventCode: 'SEIZE_REVERSE_SUSPENSE',
            debitCode: 'L.DEPOSIT_SUSPENSE',
            creditCode: 'A.CLIENT_ASSET',
            debitWalletRef: 'cust-wallet-sz-1',
            // CLIENT_ASSET (COA 1) is an aggregate account (R2-exempt) — same
            // customerWalletRef on both sides, copied from pendReturnSuspense's
            // walletRef treatment.
            creditWalletRef: 'cust-wallet-sz-1',
            isExternalCrossing: true,
            // 8-year retention anchor: orderRef must be embedded in the memo since
            // the destination account itself is never modeled.
            memo: expect.stringContaining('ORD-SZ-1'),
          }),
        }),
      );

      expect(accountingService.executeTransfer).not.toHaveBeenCalled();

      // 先账后状态: deposit → SEIZING via SEIZE action (via the service, Rule 5).
      expect(depositService.updateStatus).toHaveBeenCalledWith('dep-sz-1',
        expect.objectContaining({ action: DepositTransactionAction.SEIZE }),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEPOSIT_SEIZE_STARTED',
          metadata: expect.objectContaining({ orderRef: 'ORD-SZ-1' }),
        }),
      );
    });

    it('idempotent: reuses existing legSeq 4 funds order (no duplicate create)', async () => {
      fundsOrders.findByParent.mockResolvedValue([
        { id: 'fo-sz-1', fundsOrderNo: 'FO-SZ-1', legSeq: 4, attempt: 1, status: 'CREATED' },
      ]);
      const dep = seizableDeposit();

      await (service as any).onSeizeApproved(dep);

      expect(fundsOrders.create).not.toHaveBeenCalled();
      expect(accountingService.executePendingTransfer).toHaveBeenCalledTimes(1);
    });

    it('no-op when deposit is not FROZEN (e.g. replayed decided event after already SEIZING)', async () => {
      const dep = seizableDeposit({ status: DepositTransactionStatus.SEIZING });

      await (service as any).onSeizeApproved(dep);

      expect(fundsOrders.create).not.toHaveBeenCalled();
      expect(accountingService.executePendingTransfer).not.toHaveBeenCalled();
      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('pending transfer throws → rethrows, deposit NOT flipped to SEIZING, no STARTED audit (先账后状态)', async () => {
      accountingService.executePendingTransfer.mockRejectedValueOnce(new Error('TB rejected'));
      const dep = seizableDeposit();

      await expect((service as any).onSeizeApproved(dep)).rejects.toThrow('TB rejected');

      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_SEIZE_STARTED' }),
      );
    });

    it('no APPROVED DEPOSIT_SEIZE case found (orderRef unavailable) → throws, no funds order created, no status change', async () => {
      approvalsService.list.mockResolvedValue({ total: 0, items: [] });
      const dep = seizableDeposit();

      await expect((service as any).onSeizeApproved(dep)).rejects.toThrow(/orderRef/);

      expect(fundsOrders.create).not.toHaveBeenCalled();
      expect(accountingService.executePendingTransfer).not.toHaveBeenCalled();
      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });
  });

  // A4: legSeq 4 seize-leg settle (offline handoff confirm → POST → SEIZED) and
  // fail/retry (offline handoff FAILED/TIMEOUT → VOID → rebuild leg, up to 3
  // attempts). Mirrors legSeq3's return settle/fail almost exactly (single leg,
  // same as return), EXCEPT settleSeize deliberately does NOT call
  // tbEvidenceService.enrichForPost — there is no external payout artifact
  // (txHash/bank ref) to enrich with since the destination is intentionally
  // blank (owner decision 2026-07-28).
  describe('handleFundsOrderChanged — legSeq4 seize settle/fail (A4)', () => {
    let accountingService: {
      resolveTbAccountId: jest.Mock;
      executeTransfer: jest.Mock;
      executePendingTransfer: jest.Mock;
      postPendingTransfer: jest.Mock;
      voidPendingTransfer: jest.Mock;
    };

    const baseDeposit = (overrides: Record<string, unknown> = {}) => ({
      id: 'dep-sz-2',
      depositNo: 'DEP-SZ-002',
      status: DepositTransactionStatus.SEIZING,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-sz-2',
      amount: '5',
      toWalletId: 'cust-wallet-sz-2',
      toAddress: 'T_CUST_ADDR_SZ_2',
      toIban: null,
      assetId: 'asset-usdt',
      traceId: 'trace-sz-2',
      asset: { currency: 'USDT', tbLedgerId: 2, decimals: 6, type: 'CRYPTO' },
      ...overrides,
    });

    const legEvent = (overrides: Record<string, unknown> = {}) => ({
      fundsOrderId: 'fo-sz-2',
      fundsOrderNo: 'FO-SZ-2',
      parent: { depositTransactionId: 'dep-sz-2' },
      legSeq: 4,
      attempt: 1,
      oldStatus: 'CONFIRMING',
      newStatus: 'CONFIRMED',
      ...overrides,
    });

    beforeEach(async () => {
      accountingService = {
        resolveTbAccountId: jest.fn().mockResolvedValue('acct'),
        executeTransfer: jest.fn().mockResolvedValue(undefined),
        executePendingTransfer: jest.fn().mockResolvedValue({ tbTransferId: 1n }),
        postPendingTransfer: jest.fn().mockResolvedValue(undefined),
        voidPendingTransfer: jest.fn().mockResolvedValue(undefined),
      };
      fundsOrders.findById.mockResolvedValue({
        id: 'fo-sz-2', fundsOrderNo: 'FO-SZ-2', legSeq: 4, attempt: 1,
        asset: { type: 'CRYPTO' },
      });
      fundsOrders.create.mockResolvedValue({ id: 'fo-sz-3', fundsOrderNo: 'FO-SZ-3', legSeq: 4, attempt: 2, status: 'CREATED' });
      depositService.updateStatus.mockResolvedValue({});
      approvalsService.list.mockResolvedValue({
        total: 1,
        items: [{ id: 'app-sz-2', objectSnapshot: { depositNo: 'DEP-SZ-002', orderRef: 'ORD-SZ-2' } }],
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DepositWorkflowService,
          { provide: DepositTransactionsService, useValue: depositService },
          { provide: FundsOrderService, useValue: fundsOrders },
          { provide: AuditLogsService, useValue: auditLogsService },
          { provide: AccountingService, useValue: accountingService },
          { provide: WithdrawalAddressService, useValue: withdrawalAddresses },
          { provide: SUMSUB_TXN_CLIENT, useValue: sumsubTxnClient },
          { provide: ApprovalsService, useValue: approvalsService },
          { provide: SystemWalletResolver, useValue: systemWalletResolver },
          { provide: TbEvidenceService, useValue: tbEvidenceService },
        ],
      }).compile();

      service = module.get<DepositWorkflowService>(DepositWorkflowService);
    });

    it('legSeq4 CONFIRMED → posts the single pending leg (no externalRef enrich), SEIZED, DEPOSIT_SEIZED audit', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit());

      await service.handleFundsOrderChanged(legEvent() as any);

      expect(accountingService.postPendingTransfer).toHaveBeenCalledTimes(1);
      expect(accountingService.postPendingTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          pendingTransferId: deterministicTransferId('DEPOSIT', 'DEP-SZ-002', 'SEIZE_REVERSE_SUSPENSE', 1),
        }),
      );
      expect(tbEvidenceService.enrichForPost).not.toHaveBeenCalled();
      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'dep-sz-2',
        expect.objectContaining({ action: DepositTransactionAction.SEIZED_DONE }),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_SEIZED' }),
      );
    });

    it('settle: post fails 3× → stays SEIZING + STUCK audit (no SEIZED)', async () => {
      const dep = baseDeposit();
      accountingService.postPendingTransfer.mockRejectedValue(new Error('TB down'));

      await (service as any).settleSeize(dep, 'fo-sz-2', 1);

      expect(accountingService.postPendingTransfer).toHaveBeenCalledTimes(3);
      expect(depositService.updateStatus).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ action: DepositTransactionAction.SEIZED_DONE }),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_SEIZE_STUCK' }),
      );
    });

    it('settle idempotent: deposit no longer SEIZING → no-op', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit({ status: 'SEIZED' }));

      await service.handleFundsOrderChanged(legEvent() as any);

      expect(accountingService.postPendingTransfer).not.toHaveBeenCalled();
    });

    it('legSeq4 FAILED, attempt < 3 → voids the pending leg, rebuilds leg (attempt+1), RETRIED audit, stays SEIZING', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit());

      await service.handleFundsOrderChanged(legEvent({ newStatus: 'FAILED', attempt: 1 }) as any);

      const oldPendingId = deterministicTransferId('DEPOSIT', 'DEP-SZ-002', 'SEIZE_REVERSE_SUSPENSE', 1);
      const newPendingId = deterministicTransferId('DEPOSIT', 'DEP-SZ-002', 'SEIZE_REVERSE_SUSPENSE', 2);
      expect(newPendingId).not.toEqual(oldPendingId); // rebuilt attempt must not collide with the voided one

      expect(accountingService.voidPendingTransfer).toHaveBeenCalledTimes(1);
      expect(accountingService.voidPendingTransfer).toHaveBeenCalledWith(
        expect.objectContaining({ pendingTransferId: oldPendingId }),
      );
      expect(fundsOrders.create).toHaveBeenCalledWith(
        expect.objectContaining({ depositTransactionId: 'dep-sz-2', legSeq: 4, attempt: 2, initialStatus: 'CREATED' }),
      );
      expect(accountingService.executePendingTransfer).toHaveBeenCalledWith(
        expect.objectContaining({ legIndex: 2 }),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_SEIZE_RETRIED' }),
      );
      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('legSeq4 TIMEOUT at attempt 3 (exhausted) → voids the pending leg, no rebuild, STUCK audit, stays SEIZING', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit());

      await service.handleFundsOrderChanged(legEvent({ newStatus: 'TIMEOUT', attempt: 3 }) as any);

      expect(accountingService.voidPendingTransfer).toHaveBeenCalledTimes(1);
      expect(accountingService.voidPendingTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          pendingTransferId: deterministicTransferId('DEPOSIT', 'DEP-SZ-002', 'SEIZE_REVERSE_SUSPENSE', 3),
        }),
      );
      expect(fundsOrders.create).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_SEIZE_STUCK' }),
      );
      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('legSeq4 non-CONFIRMED/FAILED/TIMEOUT status → no-op (e.g. SUBMITTED)', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit());

      await service.handleFundsOrderChanged(legEvent({ newStatus: 'SUBMITTED' }) as any);

      expect(accountingService.postPendingTransfer).not.toHaveBeenCalled();
      expect(accountingService.voidPendingTransfer).not.toHaveBeenCalled();
    });

    // Fix 2: onSeizeLegFailed is a fire-and-forget @OnEvent downstream — its
    // external calls (voidPendingTransfer, fetchSeizeOrderRef, fundsOrders.create,
    // pendSeizeSuspense) must never throw uncaught, or it escapes as an unhandled
    // rejection. Mirrors settleSeize's own try/catch.
    it('Fix 2: voidPendingTransfer throws → does not throw, writes DEPOSIT_SEIZE_STUCK audit, deposit stays SEIZING (in-flight, no revert)', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit());
      accountingService.voidPendingTransfer.mockRejectedValueOnce(new Error('TB unreachable'));

      await expect(
        service.handleFundsOrderChanged(legEvent({ newStatus: 'FAILED', attempt: 1 }) as any),
      ).resolves.toBeUndefined();

      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEPOSIT_SEIZE_STUCK',
          reason: expect.stringContaining('TB unreachable'),
        }),
      );
      expect(fundsOrders.create).not.toHaveBeenCalled(); // never got to the rebuild step
      expect(depositService.updateStatus).not.toHaveBeenCalled(); // stays SEIZING
    });
  });

  // A5: onUnfreezeApproved fills in the real resume-into-compliance-flow execution
  // (previously a stub — see A2). Zero accounting (money never left DEPOSIT_SUSPENSE
  // while FROZEN) — the only state change is FROZEN --RESUME--> COMPLIANCE_PENDING,
  // plus a best-effort Sumsub rescore so a fresh verdict can drive the state machine
  // post-resume (the whole reason this arc exists). rescore is an external HTTP call
  // and must NEVER crash/roll back the already-committed resume (plan-1 终审 I2
  // teaching re: submitSumsubTxns' missing try/catch stranding deposits).
  describe('onUnfreezeApproved — resume into compliance flow (A5)', () => {
    const frozenDeposit = (overrides: Record<string, unknown> = {}) => ({
      id: 'dep-uf-1',
      depositNo: 'DEP-UF-001',
      status: DepositTransactionStatus.FROZEN,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-uf-1',
      assetId: 'asset-usdt',
      amount: '5',
      traceId: 'trace-uf-1',
      sumsubFinanceTxnId: 'sumsub-fin-1',
      sumsubTravelRuleTxnId: 'sumsub-tr-1',
      ...overrides,
    });

    const approvedUnfreezeCase = (orderRef = 'ORD-UF-1') => ({
      total: 1,
      items: [{ id: 'app-uf-1', objectSnapshot: { depositNo: 'DEP-UF-001', orderRef } }],
    });

    beforeEach(() => {
      depositService.updateStatus.mockResolvedValue({});
      approvalsService.list.mockResolvedValue(approvedUnfreezeCase());
      sumsubTxnClient.rescore.mockResolvedValue(undefined);
    });

    it('FROZEN → resumes to COMPLIANCE_PENDING (RESUME), DEPOSIT_UNFROZEN audit with orderRef, rescores both finance + travelRule txns', async () => {
      const dep = frozenDeposit();

      await (service as any).onUnfreezeApproved(dep);

      expect(approvalsService.list).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'DEPOSIT_UNFREEZE', entityRef: 'dep-uf-1', status: 'APPROVED' }),
      );
      expect(depositService.updateStatus).toHaveBeenCalledWith('dep-uf-1',
        expect.objectContaining({ action: DepositTransactionAction.RESUME }),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEPOSIT_UNFROZEN',
          reason: expect.stringContaining('ORD-UF-1'),
        }),
      );
      expect(sumsubTxnClient.rescore).toHaveBeenCalledWith('sumsub-fin-1');
      expect(sumsubTxnClient.rescore).toHaveBeenCalledWith('sumsub-tr-1');
      expect(sumsubTxnClient.rescore).toHaveBeenCalledTimes(2);
    });

    it('fiat deposit (no sumsubTravelRuleTxnId) → rescores only the finance txn once', async () => {
      const dep = frozenDeposit({ sumsubTravelRuleTxnId: undefined });

      await (service as any).onUnfreezeApproved(dep);

      expect(sumsubTxnClient.rescore).toHaveBeenCalledWith('sumsub-fin-1');
      expect(sumsubTxnClient.rescore).toHaveBeenCalledTimes(1);
    });

    it('no-op when deposit is not FROZEN (e.g. replayed decided event after already resumed)', async () => {
      const dep = frozenDeposit({ status: DepositTransactionStatus.COMPLIANCE_PENDING });

      await (service as any).onUnfreezeApproved(dep);

      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
      expect(sumsubTxnClient.rescore).not.toHaveBeenCalled();
    });

    it('rescore throws → flow still succeeds (status flipped + audit already written), only warns — never crashes/rolls back', async () => {
      sumsubTxnClient.rescore.mockRejectedValue(new Error('Sumsub down'));
      const dep = frozenDeposit();

      await expect((service as any).onUnfreezeApproved(dep)).resolves.toBeUndefined();

      expect(depositService.updateStatus).toHaveBeenCalledWith('dep-uf-1',
        expect.objectContaining({ action: DepositTransactionAction.RESUME }),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_UNFROZEN' }),
      );
    });

    it('no sumsubFinanceTxnId (never submitted to Sumsub) → skips rescore entirely, does not throw', async () => {
      const dep = frozenDeposit({ sumsubFinanceTxnId: undefined, sumsubTravelRuleTxnId: undefined });

      await expect((service as any).onUnfreezeApproved(dep)).resolves.toBeUndefined();

      expect(sumsubTxnClient.rescore).not.toHaveBeenCalled();
      expect(depositService.updateStatus).toHaveBeenCalled();
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_UNFROZEN' }),
      );
    });

    it('no APPROVED DEPOSIT_UNFREEZE case found (orderRef unavailable) → throws, no status change, no audit, no rescore', async () => {
      approvalsService.list.mockResolvedValue({ total: 0, items: [] });
      const dep = frozenDeposit();

      await expect((service as any).onUnfreezeApproved(dep)).rejects.toThrow(/orderRef/);

      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
      expect(sumsubTxnClient.rescore).not.toHaveBeenCalled();
    });

    // Reject path (A2, untouched by A5): decision !== APPROVED never reaches
    // onUnfreezeApproved — onUnfreezeDecided's routing short-circuits before this
    // method is called, so the deposit stays FROZEN. Already covered by the existing
    // A2 stub test 'onUnfreezeDecided: EXPIRED → no-op' (asserts the (now-real) method
    // is never invoked for a non-APPROVED decision).
  });
});

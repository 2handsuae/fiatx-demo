import { Test, TestingModule } from '@nestjs/testing';
import { DepositWorkflowService } from './deposit-workflow.service';
import { DepositTransactionsService } from './deposit-transactions.service';
import { FundsOrderService } from '../../funds-orders/funds-order.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { WithdrawalAddressService } from '../../asset-treasury/withdrawal-addresses/withdrawal-address.service';
import { DepositStatusChangedEvent } from './events/deposit-transaction.events';
import {
  DepositTransactionStatus,
  DepositTransactionAction,
} from './dto/deposit-transaction.dto';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { SystemWalletResolver } from '../../funds-layer/domain/system-wallet-resolver.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

describe('DepositWorkflowService', () => {
  let service: DepositWorkflowService;
  let depositService: Record<string, jest.Mock>;
  let auditLogsService: Record<string, jest.Mock>;
  let fundsOrders: Record<string, jest.Mock>;
  let withdrawalAddresses: Record<string, jest.Mock>;
  let approvalsService: Record<string, jest.Mock>;
  let systemWalletResolver: Record<string, jest.Mock>;

  beforeEach(async () => {
    depositService = {
      getOwnerComplianceStatus: jest.fn(),
      initializeComplianceGates: jest.fn(),
      updateStatus: jest.fn(),
      findOne: jest.fn(),
      updateKytStatus: jest.fn(),
      updateTravelRuleStatus: jest.fn(),
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
    approvalsService = {
      list: jest.fn().mockResolvedValue({ total: 0, items: [] }),
      createAndSubmit: jest.fn().mockResolvedValue({ id: 'app-1', approvalNo: 'APR-1' }),
    };
    systemWalletResolver = {
      resolve: jest.fn().mockResolvedValue({ id: 'fee-wallet-1', address: null, iban: null }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepositWorkflowService,
        { provide: DepositTransactionsService, useValue: depositService },
        { provide: FundsOrderService, useValue: fundsOrders },
        { provide: AuditLogsService, useValue: auditLogsService },
        { provide: AccountingService, useValue: { resolveTbAccountId: jest.fn(), executeTransfer: jest.fn() } },
        { provide: WithdrawalAddressService, useValue: withdrawalAddresses },
        { provide: ApprovalsService, useValue: approvalsService },
        { provide: SystemWalletResolver, useValue: systemWalletResolver },
      ],
    }).compile();

    service = module.get<DepositWorkflowService>(DepositWorkflowService);
  });

  describe('handleDepositStatusChanged — Gate 0', () => {
    it('initializes compliance gates when entering COMPLIANCE_PENDING with normal customer', async () => {
      depositService.getOwnerComplianceStatus.mockResolvedValue('ACTIVE');
      depositService.initializeComplianceGates.mockResolvedValue({});
      depositService.findOne.mockResolvedValue({ id: 'dep-1', depositNo: 'DEP001', ownerType: 'CUSTOMER', ownerId: 'cust-1', traceId: null });

      const event = new DepositStatusChangedEvent(
        'dep-1',
        DepositTransactionStatus.PAYIN_PENDING,
        DepositTransactionStatus.COMPLIANCE_PENDING,
        'CUSTOMER', 'cust-1', 'asset-1', '100',
      );

      await service.handleDepositStatusChanged(event);

      expect(depositService.getOwnerComplianceStatus).toHaveBeenCalledWith('dep-1');
      expect(depositService.initializeComplianceGates).toHaveBeenCalledWith('dep-1');
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
      expect(depositService.initializeComplianceGates).not.toHaveBeenCalled();
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

  describe('checkAutoApproval', () => {
    it('approves when all three gates pass (COMPLIANCE_PENDING + ACTIVE + PASSED + PASSED)', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-1',
        depositNo: 'DEP001',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        kytStatus: 'PASSED',
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
        kytStatus: 'PASSED',
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
        kytStatus: 'PASSED',
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
        kytStatus: 'PASSED',
        travelRuleStatus: 'PASSED',
      });

      await service.checkAutoApproval('dep-1');

      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('does not approve when kytStatus is PENDING', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-1',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        kytStatus: 'PENDING',
        travelRuleStatus: 'PASSED',
      });

      await service.checkAutoApproval('dep-1');

      expect(depositService.getOwnerComplianceStatus).not.toHaveBeenCalled();
    });

    it('does not approve when travelRuleStatus is PENDING', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-1',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        kytStatus: 'PASSED',
        travelRuleStatus: 'PENDING',
      });

      await service.checkAutoApproval('dep-1');

      expect(depositService.getOwnerComplianceStatus).not.toHaveBeenCalled();
    });

    it('does not approve when customer compliance is abnormal', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-1',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        kytStatus: 'PASSED',
        travelRuleStatus: 'PASSED',
        ownerId: 'cust-1',
      });
      depositService.getOwnerComplianceStatus.mockResolvedValue('FROZEN');

      await service.checkAutoApproval('dep-1');

      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('approves fiat deposit when kytStatus=PASSED and travelRuleStatus=NOT_REQUIRED', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-fiat-1',
        depositNo: 'DEP-FIAT-001',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        kytStatus: 'PASSED',
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
          { provide: ApprovalsService, useValue: approvalsService },
          { provide: SystemWalletResolver, useValue: systemWalletResolver },
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
          { provide: ApprovalsService, useValue: approvalsService },
          { provide: SystemWalletResolver, useValue: systemWalletResolver },
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
          { provide: ApprovalsService, useValue: approvalsService },
          { provide: SystemWalletResolver, useValue: systemWalletResolver },
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
});

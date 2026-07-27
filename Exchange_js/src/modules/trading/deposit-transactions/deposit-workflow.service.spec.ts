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

describe('DepositWorkflowService', () => {
  let service: DepositWorkflowService;
  let depositService: Record<string, jest.Mock>;
  let auditLogsService: Record<string, jest.Mock>;
  let fundsOrders: Record<string, jest.Mock>;
  let withdrawalAddresses: Record<string, jest.Mock>;

  beforeEach(async () => {
    depositService = {
      getOwnerComplianceStatus: jest.fn(),
      initializeComplianceGates: jest.fn(),
      updateStatus: jest.fn(),
      findOne: jest.fn(),
      updateKytStatus: jest.fn(),
      updateTravelRuleStatus: jest.fn(),
      setOnHoldSla: jest.fn().mockResolvedValue(undefined),
    };
    auditLogsService = {
      recordSystem: jest.fn().mockResolvedValue(undefined),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepositWorkflowService,
        { provide: DepositTransactionsService, useValue: depositService },
        { provide: FundsOrderService, useValue: fundsOrders },
        { provide: AuditLogsService, useValue: auditLogsService },
        { provide: AccountingService, useValue: { resolveTbAccountId: jest.fn(), executeTransfer: jest.fn() } },
        { provide: WithdrawalAddressService, useValue: withdrawalAddresses },
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

      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'dep-3',
        expect.objectContaining({ action: DepositTransactionAction.ACTION_PENDING }),
        expect.objectContaining({ extraData: { manualReason: 'EDD_PEP' } }),
      );
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
        expect.objectContaining({ extraData: { manualReason: 'CLIENT_ACTION' } }),
      );
    });

    it('onHold → stays put, sets slaDeadline via setOnHoldSla, records DEPOSIT_ONHOLD', async () => {
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
      expect(depositService.setOnHoldSla).toHaveBeenCalledWith('dep-4', expect.any(Date));
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_ONHOLD', entityId: 'dep-4' }),
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

    it('rejected + RETURN_TO_SENDER (from MANUAL_CHECKING) → RETURNING', async () => {
      const deposit = {
        id: 'dep-8',
        depositNo: 'DEP008',
        status: DepositTransactionStatus.MANUAL_CHECKING,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: null,
      };
      depositService.findOne.mockResolvedValue(deposit);
      depositService.updateStatus.mockResolvedValue({
        ...deposit,
        status: DepositTransactionStatus.RETURNING,
      });

      await service.applyKytVerdict('dep-8', { verdict: 'rejected', dispoTag: 'RETURN_TO_SENDER' });

      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'dep-8',
        expect.objectContaining({ action: DepositTransactionAction.RETURN }),
        expect.anything(),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_RETURN_INITIATED' }),
      );
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
  });
});

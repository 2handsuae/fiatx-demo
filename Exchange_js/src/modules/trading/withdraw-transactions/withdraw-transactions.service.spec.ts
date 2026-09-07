import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WithdrawTransactionsService } from './withdraw-transactions.service';
import { WithdrawWorkflowService } from './withdraw-workflow.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  WithdrawTransactionAction,
  WithdrawTransactionStatus,
} from './dto/withdraw-transaction.dto';
import { WithdrawQuoteService } from '../withdrawal-fee-level/withdraw-quote.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { ApprovalsService } from '../../governance/approvals/approvals.service';

describe('WithdrawTransactionsService', () => {
  let service: WithdrawTransactionsService;
  // create+lock was relocated into WithdrawWorkflowService.createWithdrawal; the
  // create tests below drive it through the workflow (real domain delegate +
  // shared mocks), while updateStatus/findAll/findOne stay on the domain service.
  let workflow: WithdrawWorkflowService;
  let prisma: any;
  let eventEmitter: any;
  let withdrawQuoteService: any;
  let accountingService: any;
  let auditLogsService: any;
  let approvalsService: Record<string, jest.Mock>;
  let module: TestingModule;

  const mockTx: any = {
    withdrawTransaction: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    auditLogEvent: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    approvalsService = {
      list: jest.fn().mockResolvedValue({ total: 0, items: [] }),
    };
    module = await Test.createTestingModule({
      providers: [
        WithdrawTransactionsService,
        {
          provide: ApprovalsService,
          useValue: approvalsService,
        },
        {
          provide: PrismaService,
      useValue: {
        $transaction: jest.fn((cb: any) => cb(mockTx)),
        asset: { findUnique: jest.fn() },
        customerMain: { findUnique: jest.fn() },
        withdrawTransaction: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
        withdrawalAddress: { findFirst: jest.fn() },
        auditLogEvent: {
          findUnique: jest.fn(),
          create: jest.fn(),
          findMany: jest.fn(),
        },
      },
        },
        {
          provide: EventEmitter2,
          useValue: { emit: jest.fn() },
        },
        {
          provide: WithdrawQuoteService,
          useValue: {
            getActiveQuoteOrThrow: jest.fn(),
            consumeQuote: jest.fn(),
            cancelQuote: jest.fn(),
          },
        },
        {
          provide: AuditLogsService,
          useValue: {
            recordByActor: jest.fn().mockResolvedValue({}),
            recordSystem: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: AccountingService,
          useValue: {
            resolveTbAccountId: jest.fn().mockResolvedValue(BigInt(1)),
            executePendingTransfer: jest.fn().mockResolvedValue({ tbTransferId: BigInt(1) }),
            executeTransfer: jest.fn().mockResolvedValue({ tbTransferId: BigInt(2) }),
            voidPendingTransferBestEffort: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compile();

    service = module.get<WithdrawTransactionsService>(WithdrawTransactionsService);
    prisma = module.get<PrismaService>(PrismaService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
    withdrawQuoteService = module.get<WithdrawQuoteService>(WithdrawQuoteService);
    accountingService = module.get<AccountingService>(AccountingService);
    auditLogsService = module.get<AuditLogsService>(AuditLogsService);

    // The create+lock orchestration moved into the workflow. Wire it with the
    // real domain service (for insertRecord/setPendingIds → tx.withdrawTransaction)
    // plus the same shared mocks; downstream deps are inert stubs (createWithdrawal
    // does not touch them).
    workflow = new WithdrawWorkflowService(
      prisma,
      eventEmitter as any,
      service,
      withdrawQuoteService as any,
      auditLogsService as any,
      accountingService as any,
      {} as any, // fundsOrders
      {} as any, // approvalsService
      {} as any, // binanceRateProvider
      {} as any, // systemWalletResolver
      {} as any, // tbEvidenceService
      { evaluate: jest.fn(() => Promise.resolve({ grossAedValue: null, aedRate: null, rateFetchedAt: null, rateFetchFailed: false })) } as any, // limitGateService
      {} as any, // limitRulesService
      {} as any, // sumsubTxnClient
      {} as any, // applicantActions
      { assertCapability: jest.fn(), resolve: jest.fn().mockResolvedValue({ lifecycle: 'ACTIVE', blocked: new Set(), disclosedBlocked: new Set(), disclosed: [], openCount: 0 }) } as any, // customerAccessService
      { open: jest.fn().mockResolvedValue({ restrictionNo: 'CR-TEST', created: true }) } as any, // customerRestrictionsService
      { evaluate: jest.fn().mockResolvedValue({ evaluatedAt: '2026-08-22T00:00:00.000Z', domain: 'WITHDRAW', verdict: 'PASS', holdReason: null, tradingTier: 'BASIC', checks: [] }) } as any, // l1Gate
      {} as any, // supplementEvidence
      {} as any, // reconDisposition
    );

    jest.clearAllMocks();
    mockTx.withdrawTransaction.findUnique.mockReset();
    mockTx.withdrawTransaction.update.mockReset();
    mockTx.auditLogEvent.findUnique.mockReset();
    mockTx.auditLogEvent.create.mockReset();
    mockTx.auditLogEvent.findUnique.mockResolvedValue(null);
    prisma.auditLogEvent.findMany.mockResolvedValue([]);
    withdrawQuoteService.getActiveQuoteOrThrow.mockResolvedValue({
      id: 'wq-1',
      assetId: 'asset-1',
      amount: new Prisma.Decimal(100),
      totalsJson: JSON.stringify({}),
    });
    withdrawQuoteService.consumeQuote.mockResolvedValue({
      id: 'wq-1',
      status: 'USED',
    });
  });

  // V2 balance check removed — migrated to TigerBeetle
  // Balance guard test removed; re-add when TigerBeetle adapter is wired

  it('should create withdraw in COMPLIANCE_PENDING (CRYPTO)', async () => {
    prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', type: 'CRYPTO' });
    prisma.customerMain.findUnique.mockResolvedValue({ customerNo: 'C001', onboardingStatus: 'APPROVED', adminStatus: 'ACTIVE' });
    mockTx.withdrawTransaction.create.mockResolvedValue({
      id: 'wd-create-1',
      ownerType: 'CUSTOMER',
      ownerId: 'user-1',
      assetId: 'asset-1',
      amount: new Prisma.Decimal(100),
      netAmount: new Prisma.Decimal(100),
      feeAmount: new Prisma.Decimal(0),
      withdrawNo: 'WD1001',
      fromWalletId: null,
      fromWalletNo: null,
      toWalletId: null,
      toWalletNo: null,
    });
    mockTx.auditLogEvent.create.mockResolvedValue({ id: 'audit-create-1' });

    await workflow.createWithdrawal(
      {
        assetId: 'asset-1',
        amount: 100,
        quoteId: 'wq-1',
      } as any,
      'user-1',
    );

    expect(mockTx.withdrawTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: WithdrawTransactionStatus.COMPLIANCE_PENDING,
        }),
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        maxWait: 5000,
        timeout: 20000,
      }),
    );
  });

  // B2（第四批）：提现的 assertCapability 快速失败保留不动；这里再跑一次
  // L1GateService 是为了拿到**逐项可回显的快照**落库（assertCapability 抛的是
  // 中性错误，拿不到明细）。
  describe('B2 · 提现 L1 快照', () => {
    const seedCreateRow = () => {
      prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', type: 'CRYPTO' });
      prisma.customerMain.findUnique.mockResolvedValue({ customerNo: 'C001', onboardingStatus: 'APPROVED', adminStatus: 'ACTIVE' });
      mockTx.withdrawTransaction.create.mockResolvedValue({
        id: 'wd-l1-1', ownerType: 'CUSTOMER', ownerId: 'user-1', assetId: 'asset-1',
        amount: new Prisma.Decimal(100), netAmount: new Prisma.Decimal(100),
        feeAmount: new Prisma.Decimal(0), withdrawNo: 'WD1009',
        fromWalletId: null, fromWalletNo: null, toWalletId: null, toWalletNo: null,
      });
      mockTx.auditLogEvent.create.mockResolvedValue({ id: 'audit-l1-1' });
    };

    it('PASS 时快照落进提现行（含档位与逐项 checks）', async () => {
      seedCreateRow();
      ((workflow as any).l1Gate.evaluate as jest.Mock).mockResolvedValue({
        evaluatedAt: '2026-08-22T00:00:00.000Z',
        domain: 'WITHDRAW', verdict: 'PASS', holdReason: null, tradingTier: 'PREMIUM',
        checks: [{ code: 'SINGLE_LIMIT', outcome: 'PASS', detail: '单笔上下限已过（100）' }],
      });

      await workflow.createWithdrawal(
        { assetId: 'asset-1', amount: 100, quoteId: 'wq-1' } as any,
        'user-1',
      );

      const data = mockTx.withdrawTransaction.create.mock.calls[0][0].data;
      expect(JSON.parse(data.l1Snapshot)).toMatchObject({
        domain: 'WITHDRAW', verdict: 'PASS', tradingTier: 'PREMIUM',
      });

      // 调用入参：只传六项 preChecks，绝不传自判的资格/限制两项
      const arg = ((workflow as any).l1Gate.evaluate as jest.Mock).mock.calls[0][0];
      expect(arg.domain).toBe('WITHDRAW');
      expect(arg.customerId).toBe('user-1');
      expect(arg.preChecks.map((c: any) => c.code)).toEqual([
        'SINGLE_LIMIT', 'CUMULATIVE_LIMIT', 'ACCOUNT_READINESS',
        'BALANCE_SUFFICIENCY', 'QUOTE_VALIDITY', 'TRADING_READINESS',
      ]);
    });

    // ── B2 审查 Important 2：快照是给运营/MLRO 看的合规证据。没真查过的项写
    // SKIPPED 是诚实，写 PASS 是伪证 —— 比不记录更糟。下面三条把两格钉死。
    const outcomeOf = (code: string) => {
      const arg = ((workflow as any).l1Gate.evaluate as jest.Mock).mock.calls[0][0];
      return arg.preChecks.find((c: any) => c.code === code);
    };

    it('无出款目的地（地址守卫整段被跳过）→ ACCOUNT_READINESS 必须是 SKIPPED，不许写 PASS', async () => {
      seedCreateRow();

      // 既有行为：crypto 不带 toAddress / fiat 不带 toIban，地址守卫两个分支都不命中
      // → 整段跳过，单子照建（底层洞，本批不修）。快照不许替它盖章。
      await workflow.createWithdrawal(
        { assetId: 'asset-1', amount: 100, quoteId: 'wq-1' } as any,
        'user-1',
      );

      expect(prisma.withdrawalAddress.findFirst).not.toHaveBeenCalled();
      const check = outcomeOf('ACCOUNT_READINESS');
      expect(check.outcome).toBe('SKIPPED');
      expect(check.outcome).not.toBe('PASS');
      expect(check.detail).toContain('No payout destination provided');
    });

    it('带已注册 ACTIVE 地址 → ACCOUNT_READINESS 才是 PASS', async () => {
      seedCreateRow();
      prisma.withdrawalAddress.findFirst.mockResolvedValue({
        id: 'wa-1', address: '0xabc', status: 'ACTIVE', addressType: 'EXTERNAL',
      });

      await workflow.createWithdrawal(
        { assetId: 'asset-1', amount: 100, quoteId: 'wq-1', toAddress: '0xabc' } as any,
        'user-1',
      );

      expect(prisma.withdrawalAddress.findFirst).toHaveBeenCalled();
      expect(outcomeOf('ACCOUNT_READINESS').outcome).toBe('PASS');
    });

    it('BALANCE_SUFFICIENCY 恒 SKIPPED —— 评估点在压 TB pending 之前，这一刻不知道够不够', async () => {
      seedCreateRow();

      await workflow.createWithdrawal(
        { assetId: 'asset-1', amount: 100, quoteId: 'wq-1' } as any,
        'user-1',
      );

      const check = outcomeOf('BALANCE_SUFFICIENCY');
      expect(check.outcome).toBe('SKIPPED');
      expect(check.outcome).not.toBe('PASS');
      expect(check.detail).not.toContain('already passed');
    });

    // ── B2 审查 Important 3：L1 闸必须与紧邻的 assertCapability / limitGate 一样
    // 收窄到 CUSTOMER —— 否则非客户主体走进 CustomerAccessService.resolve() 会撞
    // `Customer not found: <id>`（非中性 + 回显内部 id），且限额两格从未执行。
    it('ownerType 非 CUSTOMER → 整段 L1 闸不执行，也不落快照', async () => {
      seedCreateRow();

      await workflow.createWithdrawal(
        { assetId: 'asset-1', amount: 100, quoteId: 'wq-1' } as any,
        'firm-1',
        'FIRM',
      );

      expect(((workflow as any).l1Gate.evaluate as jest.Mock)).not.toHaveBeenCalled();
      const data = mockTx.withdrawTransaction.create.mock.calls[0][0].data;
      expect(data.l1Snapshot).toBeUndefined();
    });

    it('BLOCK（并发窗口内便签刚开出来）→ 中性拒绝，不建单', async () => {
      seedCreateRow();
      ((workflow as any).l1Gate.evaluate as jest.Mock).mockResolvedValue({
        evaluatedAt: '2026-08-22T00:00:00.000Z',
        domain: 'WITHDRAW', verdict: 'BLOCK', holdReason: null, tradingTier: 'BASIC',
        checks: [{ code: 'CUSTOMER_RESTRICTION', outcome: 'FAIL', detail: '客户被限制账摁住 WITHDRAW 能力' }],
      });

      const err: any = await workflow
        .createWithdrawal({ assetId: 'asset-1', amount: 100, quoteId: 'wq-1' } as any, 'user-1')
        .catch((e) => e);

      const body = err?.getResponse ? err.getResponse() : err;
      expect(body.code).toBe('L1_GATE_BLOCKED');
      expect(body.message).toBe('This operation is not available for your account at the moment.');
      expect(JSON.stringify(body)).not.toMatch(/SANCTION|RESTRICTION|限制|便签/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(mockTx.withdrawTransaction.create).not.toHaveBeenCalled();
    });
  });

  it('should create FIAT withdraw in COMPLIANCE_PENDING', async () => {
    prisma.asset.findUnique.mockResolvedValue({ id: 'asset-fiat-1', type: 'FIAT' });
    prisma.customerMain.findUnique.mockResolvedValue({ customerNo: 'C001', onboardingStatus: 'APPROVED', adminStatus: 'ACTIVE' });
    mockTx.withdrawTransaction.create.mockResolvedValue({
      id: 'wd-create-2',
      ownerType: 'CUSTOMER',
      ownerId: 'user-1',
      assetId: 'asset-fiat-1',
      amount: new Prisma.Decimal(100),
      netAmount: new Prisma.Decimal(100),
      feeAmount: new Prisma.Decimal(0),
      withdrawNo: 'WD1002',
      fromWalletId: null,
      fromWalletNo: null,
      toWalletId: null,
      toWalletNo: null,
    });
    mockTx.auditLogEvent.create.mockResolvedValue({ id: 'audit-create-2' });

    withdrawQuoteService.getActiveQuoteOrThrow.mockResolvedValue({
      id: 'wq-2',
      assetId: 'asset-fiat-1',
      amount: new Prisma.Decimal(100),
      totalsJson: JSON.stringify({}),
    });
    withdrawQuoteService.consumeQuote.mockResolvedValue({
      id: 'wq-2',
      status: 'USED',
    });

    await workflow.createWithdrawal(
      {
        assetId: 'asset-fiat-1',
        amount: 100,
        quoteId: 'wq-2',
      } as any,
      'user-1',
    );

    expect(mockTx.withdrawTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: WithdrawTransactionStatus.COMPLIANCE_PENDING,
        }),
      }),
    );
  });

  // SLA deadline（第三批）：出生态写入（insertRecord）不经过 updateStatus，
  // 收口处覆盖不到 —— insertRecord 必须自己按配置表补 SLA 字段，否则
  // 「进入 COMPLIANCE_PENDING 就开始计时」对提现建单这条路会落空（brief 明确点名
  // 的三条 COMPLIANCE_PENDING 入路之一）。
  it('建单（insertRecord）落 COMPLIANCE_PENDING 时也设 5 分钟 SLA deadline', async () => {
    prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', type: 'CRYPTO' });
    prisma.customerMain.findUnique.mockResolvedValue({ customerNo: 'C001', onboardingStatus: 'APPROVED', adminStatus: 'ACTIVE' });
    mockTx.withdrawTransaction.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'wd-create-sla', fromWalletId: null, ...data }),
    );
    mockTx.auditLogEvent.create.mockResolvedValue({ id: 'audit-create-sla' });
    const before = Date.now();

    await workflow.createWithdrawal(
      { assetId: 'asset-1', amount: 100, quoteId: 'wq-1' } as any,
      'user-1',
    );

    const call = (mockTx.withdrawTransaction.create as jest.Mock).mock.calls[0][0];
    expect(call.data.status).toBe(WithdrawTransactionStatus.COMPLIANCE_PENDING);
    const delta = new Date(call.data.slaDeadline).getTime() - before;
    expect(delta).toBeGreaterThan(4 * 60_000);
    expect(delta).toBeLessThan(6 * 60_000);
    expect(call.data.slaBreached).toBe(false);
  });

  // ── Task 3: address-registration guard + VASP derivation (RED → GREEN) ──
  //
  // createWithdrawal must check the customer's registered withdrawal address
  // BEFORE inserting the row: crypto withdrawals look up toAddress, fiat
  // withdrawals look up toIban. A miss (unregistered / not ACTIVE) throws
  // WITHDRAWAL_ADDRESS_NOT_REGISTERED; a hit derives counterpartyIsVasp from
  // the registered address's addressType (crypto only — fiat always null).
  describe('address-registration guard + VASP derivation', () => {
    it('throws WITHDRAWAL_ADDRESS_NOT_REGISTERED when the crypto toAddress is not registered/ACTIVE', async () => {
      prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', type: 'CRYPTO', network: 'TRON' });
      prisma.customerMain.findUnique.mockResolvedValue({ customerNo: 'C001', onboardingStatus: 'APPROVED', adminStatus: 'ACTIVE' });
      prisma.withdrawalAddress.findFirst.mockResolvedValue(null);

      await expect(
        workflow.createWithdrawal(
          {
            assetId: 'asset-1',
            amount: 100,
            toAddress: '0xUNREGISTERED',
            quoteId: 'wq-1',
          } as any,
          'user-1',
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'WITHDRAWAL_ADDRESS_NOT_REGISTERED' }),
      });

      expect(prisma.withdrawalAddress.findFirst).toHaveBeenCalledWith({
        where: { customerId: 'user-1', network: 'TRON', address: '0xUNREGISTERED', status: 'ACTIVE' },
      });
      // Never reaches insert when the guard rejects.
      expect(mockTx.withdrawTransaction.create).not.toHaveBeenCalled();
    });

    it('crypto: a registered VASP address derives counterpartyIsVasp=true on the inserted record', async () => {
      prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', type: 'CRYPTO', network: 'TRON' });
      prisma.customerMain.findUnique.mockResolvedValue({ customerNo: 'C001', onboardingStatus: 'APPROVED', adminStatus: 'ACTIVE' });
      prisma.withdrawalAddress.findFirst.mockResolvedValue({ addressType: 'VASP' });
      mockTx.withdrawTransaction.create.mockResolvedValue({
        id: 'wd-vasp-1',
        ownerType: 'CUSTOMER',
        ownerId: 'user-1',
        assetId: 'asset-1',
        amount: new Prisma.Decimal(100),
        netAmount: new Prisma.Decimal(100),
        feeAmount: new Prisma.Decimal(0),
        withdrawNo: 'WD-VASP-1',
        fromWalletId: null,
        fromWalletNo: null,
        toWalletId: null,
        toWalletNo: null,
      });

      await workflow.createWithdrawal(
        {
          assetId: 'asset-1',
          amount: 100,
          toAddress: '0xVASPADDR',
          quoteId: 'wq-1',
        } as any,
        'user-1',
      );

      expect(mockTx.withdrawTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ counterpartyIsVasp: true }),
        }),
      );
    });

    it('fiat: a registered BANK address passes the guard with counterpartyIsVasp left null', async () => {
      prisma.asset.findUnique.mockResolvedValue({ id: 'asset-fiat-1', type: 'FIAT', network: 'AED_ZAND' });
      prisma.customerMain.findUnique.mockResolvedValue({ customerNo: 'C001', onboardingStatus: 'APPROVED', adminStatus: 'ACTIVE' });
      prisma.withdrawalAddress.findFirst.mockResolvedValue({ addressType: 'BANK' });
      mockTx.withdrawTransaction.create.mockResolvedValue({
        id: 'wd-bank-1',
        ownerType: 'CUSTOMER',
        ownerId: 'user-1',
        assetId: 'asset-fiat-1',
        amount: new Prisma.Decimal(100),
        netAmount: new Prisma.Decimal(100),
        feeAmount: new Prisma.Decimal(0),
        withdrawNo: 'WD-BANK-1',
        fromWalletId: null,
        fromWalletNo: null,
        toWalletId: null,
        toWalletNo: null,
      });
      withdrawQuoteService.getActiveQuoteOrThrow.mockResolvedValue({
        id: 'wq-2',
        assetId: 'asset-fiat-1',
        amount: new Prisma.Decimal(100),
        totalsJson: JSON.stringify({}),
      });
      withdrawQuoteService.consumeQuote.mockResolvedValue({ id: 'wq-2', status: 'USED' });

      await workflow.createWithdrawal(
        {
          assetId: 'asset-fiat-1',
          amount: 100,
          toIban: 'AE070331234567890123456',
          quoteId: 'wq-2',
        } as any,
        'user-1',
      );

      expect(prisma.withdrawalAddress.findFirst).toHaveBeenCalledWith({
        where: { customerId: 'user-1', network: 'AED_ZAND', iban: 'AE070331234567890123456', status: 'ACTIVE', addressType: 'BANK' },
      });
      expect(mockTx.withdrawTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ counterpartyIsVasp: true }),
        }),
      );
    });
  });

  it('should reject create when quoteId is missing', async () => {
    prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', type: 'CRYPTO' });
    prisma.customerMain.findUnique.mockResolvedValue({ customerNo: 'C001', onboardingStatus: 'APPROVED', adminStatus: 'ACTIVE' });

    await expect(
      workflow.createWithdrawal(
        {
          assetId: 'asset-1',
          amount: 100,
        } as any,
        'user-1',
      ),
    ).rejects.toThrow('quoteId is required for withdrawal');
  });

  // Legacy extreme volatility check removed — no longer applies.

  it('should block admin approve because payout progression is workflow-driven', async () => {
    mockTx.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'wd-1',
      status: WithdrawTransactionStatus.COMPLIANCE_PENDING,
      statusHistory: '[]',
      asset: {
        type: 'CRYPTO',
      },
    });

    await expect(
      service.updateStatus(
        'wd-1',
        {
          action: WithdrawTransactionAction.APPROVE,
        },
        {
          source: 'ADMIN_API',
          actorType: 'ADMIN',

          actorId: 'admin-1',

          actorRole: 'ADMIN',
          sourcePlatform: 'ADMIN_API',
        },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'WITHDRAW_APPROVE_WORKFLOW_ONLY',
      }),
    });
  });

  it.each([
    WithdrawTransactionAction.SUCCESS,
    WithdrawTransactionAction.FAIL,
    WithdrawTransactionAction.RETURN,
  ])('should block admin direct terminal action %s', async (action) => {
    mockTx.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'wd-terminal-1',
      // All three terminal actions (success/fail/return) now share the same single
      // source edge in the 20-edge table: PAYOUT_PENDING. (The old SUCCESS→RETURNED
      // "logging" edge was removed — SUCCESS is now a true zero-out-edge terminal.)
      status: WithdrawTransactionStatus.PAYOUT_PENDING,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      assetId: 'asset-1',
      amount: new Prisma.Decimal(50),
      netAmount: new Prisma.Decimal(50),
      feeAmount: new Prisma.Decimal(0),
      withdrawNo: 'WDTERM1',
      statusHistory: '[]',
      approvedAt: new Date(),
      payoutRequestedAt: new Date(),
      completedAt: null,
      asset: {
        type: 'CRYPTO',
      },
    });

    await expect(
      service.updateStatus(
        'wd-terminal-1',
        { action },
        {
          source: 'ADMIN_API',
          actorType: 'ADMIN',

          actorId: 'admin-1',

          actorRole: 'ADMIN',
          sourcePlatform: 'ADMIN_API',
        },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'WITHDRAW_TERMINAL_ACTION_SYSTEM_ONLY',
      }),
    });
  });

  // NOTE: the CREATED --check--> PENDING_COMPLIANCE edge this test covered was
  // deleted by the 10-state/20-edge rewrite (Task 1) — CHECK is no longer a valid
  // action and CREATED is no longer a valid status. Removed rather than renamed;
  // the birth-state transition is now covered by the guard-rail edge tests below.

  it('should transition crypto approval via external tx', async () => {
    mockTx.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'wd-3',
      status: WithdrawTransactionStatus.COMPLIANCE_PENDING,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      assetId: 'asset-1',
      type: 'crypto',
      amount: new Prisma.Decimal(10),
      netAmount: new Prisma.Decimal(10),
      feeAmount: new Prisma.Decimal(0),
      withdrawNo: 'WD0003',
      statusHistory: '[]',
      approvedAt: null,
      payoutRequestedAt: null,
      completedAt: null,
      asset: {
        type: 'CRYPTO',
      },
    });
    mockTx.withdrawTransaction.update.mockResolvedValue({
      id: 'wd-3',
      status: WithdrawTransactionStatus.PAYOUT_PENDING,
      type: 'crypto',
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      assetId: 'asset-1',
      amount: new Prisma.Decimal(10),
      netAmount: new Prisma.Decimal(10),
      feeAmount: new Prisma.Decimal(0),
      withdrawNo: 'WD0003',
    });
    mockTx.auditLogEvent.create.mockResolvedValue({ id: 'audit-3' });

    const result = await service.updateStatus(
      'wd-3',
      { action: WithdrawTransactionAction.APPROVE },
      {
        source: 'WORKFLOW',
        actorType: 'SYSTEM',

        actorId: 'workflow-1',

        actorRole: 'SYSTEM',
        sourcePlatform: 'SYSTEM',
      },
      mockTx,
    );

    expect(result.status).toBe(WithdrawTransactionStatus.PAYOUT_PENDING);
  });

  it('should transition fiat approval based on asset.type', async () => {
    mockTx.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'wd-4',
      status: WithdrawTransactionStatus.COMPLIANCE_PENDING,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      assetId: 'asset-fiat',
      amount: new Prisma.Decimal(20),
      netAmount: new Prisma.Decimal(20),
      feeAmount: new Prisma.Decimal(0),
      withdrawNo: 'WD0004',
      statusHistory: '[]',
      approvedAt: null,
      payoutRequestedAt: null,
      completedAt: null,
      asset: {
        type: 'FIAT',
      },
    });
    mockTx.withdrawTransaction.update.mockResolvedValue({
      id: 'wd-4',
      status: WithdrawTransactionStatus.PAYOUT_PENDING,
    });
    mockTx.auditLogEvent.create.mockResolvedValue({ id: 'audit-4' });

    const result = await service.updateStatus(
      'wd-4',
      {
        action: WithdrawTransactionAction.APPROVE,
      },
      {
        source: 'WORKFLOW',
        actorType: 'SYSTEM',

        actorId: 'workflow-1',

        actorRole: 'SYSTEM',
        sourcePlatform: 'SYSTEM',
      },
    );

    expect(result.status).toBe(WithdrawTransactionStatus.PAYOUT_PENDING);
  });

  it('should return derivedComplianceStatus in list payload', async () => {
    prisma.withdrawTransaction.findMany = jest.fn().mockResolvedValue([
      {
        id: 'wd-list-1',
        withdrawNo: 'WDLIST1',
        status: WithdrawTransactionStatus.MANUAL_CHECKING,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        asset: { type: 'CRYPTO', code: 'BTC', network: 'BITCOIN' },
        customer: null,
      },
    ]);
    prisma.withdrawTransaction.count = jest.fn().mockResolvedValue(1);

    const result = await service.findAll({});

    expect(result.items[0]).toMatchObject({
      id: 'wd-list-1',
      derivedComplianceStatus: 'HOLD',
    });
  });

  it('should return canonical audit logs in findOne payload', async () => {
    prisma.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'wd-detail-1',
      withdrawNo: 'WDDET1',
      status: WithdrawTransactionStatus.SUCCESS,
      sumsubTxnId: 'txn-1',
      sumsubVerdict: 'approved',
      counterpartyIsVasp: true,
      asset: { type: 'CRYPTO', code: 'BTC', network: 'BITCOIN' },
      customer: null,
      payout: null,
    });
    // 站2-β：新词表行——状态变化在从/到两列，动态迁移码族已废。
    prisma.auditLogEvent.findMany.mockResolvedValue([
      {
        id: 'audit-1',
        action: 'WITHDRAW_SUCCESS',
        fromStatus: 'PAYOUT_PENDING',
        toStatus: 'SUCCESS',
        actorType: 'SYSTEM',
        actorNo: 'SYSTEM',
        actorDisplayName: 'SYSTEM',
        reason: 'closeout',
        occurredAt: '2026-03-28T10:00:00.000Z',
        outcome: 'SUCCESS',
      },
    ]);

    const result = await service.findOne('wd-detail-1');

    expect(result.auditLogs).toEqual([
      expect.objectContaining({
        id: 'audit-1',
        action: 'WITHDRAW_SUCCESS',
        oldStatus: 'PAYOUT_PENDING',
        newStatus: 'SUCCESS',
        operatorId: 'SYSTEM',
      }),
    ]);
    // raw sumsub fields preserved from DB
    expect(result.sumsubTxnId).toBe('txn-1');
    expect(result.sumsubVerdict).toBe('approved');
    expect(result.counterpartyIsVasp).toBe(true);
  });

  // Task 10: admin detail enrichment — mirrors
  // DepositTransactionsService#findOneForAdmin's parseDetail null-defense +
  // verdict fallback + approvals[] reverse lookup.
  describe('findOneForAdmin', () => {
    const sumsubJson = JSON.stringify({
      scoringResult: {
        score: 87,
        matchedRules: [
          { id: 'rule-1', name: 'High risk country', action: 'block', score: 50 },
        ],
        applicantActions: [
          { applicantActionId: 'act-1' },
          { applicantActionId: 'act-2' },
        ],
      },
    });

    beforeEach(() => {
      prisma.withdrawTransaction.findUnique.mockResolvedValue({
        id: 'wd-1',
        withdrawNo: 'WD001',
        sumsubTxnDetailJson: sumsubJson,
        asset: { type: 'CRYPTO', code: 'BTC', network: 'BITCOIN' },
        customer: null,
        fundsOrders: [],
      });
      prisma.auditLogEvent.findMany.mockResolvedValue([]);
    });

    it('parses sumsubTxnDetailJson into sumsubDetail (score/matchedRules/applicantActionIds)', async () => {
      const result: any = await service.findOneForAdmin('wd-1');

      expect(result.sumsubDetail.score).toBe(87);
      expect(result.sumsubDetail.matchedRules).toEqual([
        { id: 'rule-1', name: 'High risk country', action: 'block', score: 50 },
      ]);
      expect(result.sumsubDetail.applicantActionIds).toEqual(['act-1', 'act-2']);
    });

    it('parseDetail: sumsubTxnDetailJson = "null" (valid JSON, value null) does not throw; sumsubDetail is null', async () => {
      prisma.withdrawTransaction.findUnique.mockResolvedValue({
        id: 'wd-1',
        withdrawNo: 'WD001',
        sumsubTxnDetailJson: 'null',
        asset: { type: 'CRYPTO', code: 'BTC', network: 'BITCOIN' },
        customer: null,
        fundsOrders: [],
      });

      const result: any = await service.findOneForAdmin('wd-1');

      expect(result.sumsubDetail).toBeNull();
    });

    it('parseDetail: null elements in matchedRules/applicantActions/typedTags are filtered out', async () => {
      const jsonWithNulls = JSON.stringify({
        scoringResult: {
          score: 87,
          matchedRules: [null, { id: 'A', name: 'x', action: 'reject', score: 5 }],
          applicantActions: [null, { applicantActionId: 'act-1' }],
        },
        typedTags: [null, { label: 'FROZEN_BY_MLRO', type: 'userDefined' }],
      });
      prisma.withdrawTransaction.findUnique.mockResolvedValue({
        id: 'wd-1',
        withdrawNo: 'WD001',
        sumsubTxnDetailJson: jsonWithNulls,
        asset: { type: 'CRYPTO', code: 'BTC', network: 'BITCOIN' },
        customer: null,
        fundsOrders: [],
      });

      const result: any = await service.findOneForAdmin('wd-1');

      expect(result.sumsubDetail.matchedRules).toEqual([
        { id: 'A', name: 'x', action: 'reject', score: 5 },
      ]);
      expect(result.sumsubDetail.applicantActionIds).toEqual(['act-1']);
      expect(result.sumsubDetail.tags).toEqual(['FROZEN_BY_MLRO']);
    });

    it('parseDetail: raw 无顶层 verdict、有 scoringResult.action=reject → verdict 回退取 scoringResult.action', async () => {
      const jsonNoTopLevelVerdict = JSON.stringify({
        scoringResult: { action: 'reject', score: 90 },
      });
      prisma.withdrawTransaction.findUnique.mockResolvedValue({
        id: 'wd-1',
        withdrawNo: 'WD001',
        sumsubTxnDetailJson: jsonNoTopLevelVerdict,
        asset: { type: 'CRYPTO', code: 'BTC', network: 'BITCOIN' },
        customer: null,
        fundsOrders: [],
      });

      const result: any = await service.findOneForAdmin('wd-1');

      expect(result.sumsubDetail.verdict).toBe('reject');
    });

    it('returns approvals as single-header-only (no steps/step), regardless of status', async () => {
      approvalsService.list.mockResolvedValue({
        total: 2,
        items: [
          {
            approvalNo: 'APR-1',
            actionType: 'WITHDRAW_UNFREEZE',
            status: 'APPROVED',
            createdAt: new Date('2026-01-01T00:00:00Z'),
            steps: [{ id: 'step-1', decision: 'APPROVE' }],
          },
        ],
      });

      const result: any = await service.findOneForAdmin('wd-1');

      expect(approvalsService.list).toHaveBeenCalledWith(
        expect.objectContaining({ entityRef: 'WD001' }),
      );
      expect(result.approvals).toEqual([
        {
          approvalNo: 'APR-1',
          actionType: 'WITHDRAW_UNFREEZE',
          status: 'APPROVED',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]);
    });
  });

  // Task 11: customer-facing field whitelist (tipping-off guard). Mirrors
  // DepositTransactionsService's SENSITIVE_FULL_ROW/SENSITIVE_KEYS leak-prevention
  // spec — a mock row carrying every investigation-only column a
  // FROZEN/MANUAL_CHECKING withdrawal would have, asserting none of it survives
  // toCustomerWithdrawView's whitelist projection.
  describe('findAllForCustomer / findOneForCustomer — tipping-off whitelist', () => {
    const SENSITIVE_FULL_ROW = {
      id: 'w-sensitive-1',
      withdrawNo: 'WDR-SENS-1',
      ownerId: 'cust-1',
      ownerType: 'CUSTOMER',
      status: 'FROZEN',
      amount: '500.00',
      feeAmount: '5.00',
      netAmount: '495.00',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      completedAt: null,
      txHash: '0xabc',
      referenceNo: 'REF-1',
      toAddress: 'T_TO',
      toIban: null,
      asset: { currency: 'USDT', code: 'USDT', network: 'TRON', decimals: 6, type: 'CRYPTO' },
      statusHistory: JSON.stringify([
        { status: 'FROZEN', reason: 'Sanction match — sending unfreeze/refund to MLRO for review' },
      ]),
      manualReason: 'EDD_PEP',
      sumsubTxnId: 'sumsub-txn-1',
      sumsubTxnType: 'travelRule',
      sumsubVerdict: 'rejected',
      sumsubScore: 92,
      sumsubTxnDetailJson: '{"verdict":"rejected"}',
      counterpartyIsVasp: true,
      slaDeadline: new Date('2026-01-03T00:00:00Z'),
      slaBreached: true,
      needsReview: true,
      feeSettleAttempts: 2,
      tbPendingNetId: 'tb-net-1',
      tbPendingFeeId: 'tb-fee-1',
      grossAedValue: '1837.50',
      approvalCaseId: 'case-1',
      approvalNo: 'APR-1',
      traceId: 'WITHDRAW:w-sensitive-1',
    };

    const SENSITIVE_KEYS = [
      'statusHistory',
      'manualReason',
      'sumsubTxnId',
      'sumsubTxnType',
      'sumsubVerdict',
      'sumsubScore',
      'sumsubTxnDetailJson',
      'counterpartyIsVasp',
      'slaDeadline',
      'slaBreached',
      'needsReview',
      'feeSettleAttempts',
      'tbPendingNetId',
      'tbPendingFeeId',
      'grossAedValue',
      'approvalCaseId',
      'approvalNo',
      'traceId',
    ];

    const EXPECTED_VIEW = {
      id: 'w-sensitive-1',
      withdrawNo: 'WDR-SENS-1',
      status: 'FROZEN',
      amount: '500.00',
      feeAmount: '5.00',
      netAmount: '495.00',
      createdAt: SENSITIVE_FULL_ROW.createdAt,
      completedAt: null,
      txHash: '0xabc',
      referenceNo: 'REF-1',
      toAddress: 'T_TO',
      toIban: null,
      asset: { currency: 'USDT', code: 'USDT', network: 'TRON', decimals: 6 },
      // Task 3 (action-embed) 开的 `actions` 口子已在 2026-08-18 材料请求账
      // Task 12 随专属子表一起物理删除，见 toCustomerWithdrawView 的文档注释——
      // 不再列出这个键就是在断言它已经不在客户面响应体里。
    };

    describe('findAllForCustomer', () => {
      it('scopes the list query to the caller (ownerId)', async () => {
        prisma.withdrawTransaction.findMany = jest.fn().mockResolvedValue([]);
        prisma.withdrawTransaction.count = jest.fn().mockResolvedValue(0);

        await service.findAllForCustomer('cust-1', {} as any);

        expect(prisma.withdrawTransaction.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ ownerId: 'cust-1' }) }),
        );
      });

      it('strips statusHistory/manualReason/sumsub*/sla*/needsReview/feeSettleAttempts/tbPending*/grossAedValue/approvalCaseId+No/traceId while keeping the fields the client actually renders', async () => {
        prisma.withdrawTransaction.findMany = jest.fn().mockResolvedValue([SENSITIVE_FULL_ROW]);
        prisma.withdrawTransaction.count = jest.fn().mockResolvedValue(1);

        const result = await service.findAllForCustomer('cust-1', {} as any);
        const item = result.items[0] as any;

        for (const key of SENSITIVE_KEYS) {
          expect(item).not.toHaveProperty(key);
        }
        expect(item).toEqual(EXPECTED_VIEW);
      });

    });

    describe('findOneForCustomer', () => {
      it("another customer's withdrawal → ForbiddenException (ownership enforced)", async () => {
        prisma.withdrawTransaction.findUnique.mockResolvedValue({
          id: 'w1',
          ownerId: 'other-cust',
        });

        await expect(service.findOneForCustomer('w1', 'cust-1')).rejects.toThrow(
          ForbiddenException,
        );
      });

      it('strips statusHistory/manualReason/sumsub*/sla*/needsReview/feeSettleAttempts/tbPending*/grossAedValue/approvalCaseId+No/traceId while keeping the fields the client actually renders', async () => {
        prisma.withdrawTransaction.findUnique.mockResolvedValue(SENSITIVE_FULL_ROW);

        const result = (await service.findOneForCustomer('w-sensitive-1', 'cust-1')) as any;

        for (const key of SENSITIVE_KEYS) {
          expect(result).not.toHaveProperty(key);
        }
        expect(result).toEqual(EXPECTED_VIEW);
      });
    });

    describe('findOneForCustomerByWithdrawNo', () => {
      it('IDOR miss（单号存在但不属于该客户）→ 与「单子不存在」完全相同的 404', async () => {
        prisma.withdrawTransaction.findFirst = jest.fn().mockResolvedValue(null);

        await expect(
          service.findOneForCustomerByWithdrawNo('WDR-NOPE', 'cust-1'),
        ).rejects.toThrow('Withdraw transaction not found');
      });

      it('命中 → 走 findOneForCustomer 同一套白名单', async () => {
        prisma.withdrawTransaction.findFirst = jest
          .fn()
          .mockResolvedValue({ id: 'w-sensitive-1' });
        prisma.withdrawTransaction.findUnique.mockResolvedValue(SENSITIVE_FULL_ROW);

        const result = (await service.findOneForCustomerByWithdrawNo(
          'WDR-SENS-1',
          'cust-1',
        )) as any;

        expect(prisma.withdrawTransaction.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { withdrawNo: 'WDR-SENS-1', ownerId: 'cust-1' },
          }),
        );
        for (const key of SENSITIVE_KEYS) {
          expect(result).not.toHaveProperty(key);
        }
        expect(result).toEqual(EXPECTED_VIEW);
      });
    });
  });

  describe('approval-gate transitions', () => {
    const baseItem = {
      id: 'w1',
      withdrawNo: 'WD-1',
      ownerType: 'CUSTOMER',
      ownerId: 'c1',
      asset: { type: 'CRYPTO' },
      statusHistory: '[]',
      approvedAt: null,
      payoutRequestedAt: null,
      completedAt: null,
    };

    function arrangeItem(status: WithdrawTransactionStatus) {
      mockTx.withdrawTransaction.findUnique.mockResolvedValue({ ...baseItem, status });
      mockTx.withdrawTransaction.update.mockImplementation(({ data }: any) =>
        Promise.resolve({ ...baseItem, status: data.status }),
      );
    }

    // NOTE: the CREATED --require_approval--> PENDING_APPROVAL edge this covered
    // was deleted by the 10-state/20-edge rewrite (Task 1) — PENDING_APPROVAL has
    // no incoming edges in the transitions table (REQUIRE_APPROVAL has no edge at
    // all), and is reached only via the sanctioned birth-routing write covered by
    // the `landOnPendingApproval` describe block below (Task 2). Removed rather
    // than renamed.

    it('PENDING_APPROVAL → GATE_APPROVE → COMPLIANCE_PENDING', async () => {
      arrangeItem(WithdrawTransactionStatus.PENDING_APPROVAL);
      const res = await service.updateStatus('w1', { action: WithdrawTransactionAction.GATE_APPROVE }, { source: 'WORKFLOW' });
      expect(res.status).toBe(WithdrawTransactionStatus.COMPLIANCE_PENDING);
    });

    it('PENDING_APPROVAL → REJECT → REJECTED', async () => {
      arrangeItem(WithdrawTransactionStatus.PENDING_APPROVAL);
      const res = await service.updateStatus('w1', { action: WithdrawTransactionAction.REJECT }, { source: 'WORKFLOW' });
      expect(res.status).toBe(WithdrawTransactionStatus.REJECTED);
    });

    // NOTE: 'rejects GATE_APPROVE from CREATED' removed (CREATED no longer exists);
    // the exhaustive negative sweep in the guard-rail describe block below now
    // covers every undocumented (status, action) pair, including this one.
  });

  // Task 2 ("出生即着陆"): landOnPendingApproval is the ONE sanctioned COMPLIANCE_PENDING
  // → PENDING_APPROVAL write that bypasses updateStatus/transitions entirely — the
  // 20-edge table deliberately has no edge for it. Called only by
  // WithdrawWorkflowService.openApprovalGate() after the approval case is linked.
  describe('landOnPendingApproval — sanctioned birth-routing write (bypasses transitions)', () => {
    it('writes status PENDING_APPROVAL directly via prisma.update and appends statusHistory', async () => {
      prisma.withdrawTransaction.findUnique.mockResolvedValue({
        statusHistory: JSON.stringify([
          { status: WithdrawTransactionStatus.COMPLIANCE_PENDING, note: 'Withdrawal created — awaiting approval-gate valuation' },
        ]),
      });
      prisma.withdrawTransaction.update = jest.fn().mockResolvedValue({
        id: 'wd-birth-route-1',
        status: WithdrawTransactionStatus.PENDING_APPROVAL,
      });

      const result = await service.landOnPendingApproval('wd-birth-route-1');

      expect(prisma.withdrawTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'wd-birth-route-1' },
          data: expect.objectContaining({
            status: WithdrawTransactionStatus.PENDING_APPROVAL,
          }),
        }),
      );
      const writtenHistory = JSON.parse(
        (prisma.withdrawTransaction.update as jest.Mock).mock.calls[0][0].data.statusHistory,
      );
      expect(writtenHistory).toHaveLength(2);
      expect(writtenHistory[1]).toMatchObject({ status: WithdrawTransactionStatus.PENDING_APPROVAL });
      expect(result.status).toBe(WithdrawTransactionStatus.PENDING_APPROVAL);
    });

    // SLA deadline（第三批）：这条写入也绕过 updateStatus，收口处覆盖不到 ——
    // landOnPendingApproval 必须自己按配置表重起 SLA 计时（顶掉出生时留下的
    // COMPLIANCE_PENDING deadline），否则一笔大额提现走审批闸这条路，PENDING_APPROVAL
    // 永远不计时。
    it('也按配置表设 1 天（软）SLA deadline，顶掉出生时的 COMPLIANCE_PENDING deadline', async () => {
      prisma.withdrawTransaction.findUnique.mockResolvedValue({
        statusHistory: JSON.stringify([
          { status: WithdrawTransactionStatus.COMPLIANCE_PENDING, note: 'Withdrawal created — awaiting approval-gate valuation' },
        ]),
      });
      prisma.withdrawTransaction.update = jest.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'wd-birth-route-2', ...data }),
      );
      const before = Date.now();

      const result = await service.landOnPendingApproval('wd-birth-route-2');

      expect(result.status).toBe(WithdrawTransactionStatus.PENDING_APPROVAL);
      const delta = new Date(result.slaDeadline).getTime() - before;
      expect(delta).toBeGreaterThan(23 * 60 * 60_000);
      expect(delta).toBeLessThan(25 * 60 * 60_000);
      expect(result.slaBreached).toBe(false);
    });
  });

  it('should transition to FAILED when payout fails', async () => {
    mockTx.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'wd-5',
      status: WithdrawTransactionStatus.PAYOUT_PENDING,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      assetId: 'asset-fiat',
      amount: new Prisma.Decimal(30),
      netAmount: new Prisma.Decimal(30),
      feeAmount: new Prisma.Decimal(0),
      withdrawNo: 'WD0005',
      statusHistory: '[]',
      approvedAt: new Date(),
      payoutRequestedAt: new Date(),
      completedAt: null,
      asset: {
        type: 'FIAT',
      },
    });
    mockTx.withdrawTransaction.update.mockResolvedValue({
      id: 'wd-5',
      status: WithdrawTransactionStatus.FAILED,
    });
    mockTx.auditLogEvent.create.mockResolvedValue({ id: 'audit-5' });

    const result = await service.updateStatus('wd-5', {
      action: WithdrawTransactionAction.FAIL,
    });

    expect(result.status).toBe(WithdrawTransactionStatus.FAILED);
  });

  describe('real-time 1:1 TB accounting on create()', () => {
    function arrangeCreateAsset(assetType: string) {
      prisma.asset.findUnique.mockResolvedValue({
        id: 'asset-tb-1',
        type: assetType,
        currency: 'AED',
        decimals: 8,
      });
      prisma.customerMain.findUnique.mockResolvedValue({
        customerNo: 'C100',
        onboardingStatus: 'APPROVED',
        adminStatus: 'ACTIVE',
      });
      mockTx.withdrawTransaction.create.mockResolvedValue({
        id: 'wd-tb-1',
        ownerType: 'CUSTOMER',
        ownerId: 'user-tb',
        assetId: 'asset-tb-1',
        amount: new Prisma.Decimal(110),
        netAmount: new Prisma.Decimal(100),
        feeAmount: new Prisma.Decimal(10),
        withdrawNo: 'WD9001',
        fromWalletId: null,
        fromWalletNo: null,
        toWalletId: null,
        toWalletNo: null,
        traceId: 'trace-tb-1',
      });
      mockTx.withdrawTransaction.update.mockResolvedValue({});
      mockTx.auditLogEvent.create.mockResolvedValue({ id: 'audit-tb' });
      withdrawQuoteService.getActiveQuoteOrThrow.mockResolvedValue({
        id: 'wq-tb',
        assetId: 'asset-tb-1',
        amount: new Prisma.Decimal(110),
        totalsJson: JSON.stringify({ AED: '10' }),
      });
      withdrawQuoteService.consumeQuote.mockResolvedValue({ id: 'wq-tb', status: 'USED' });
    }

    it('net pending uses CLIENT_ASSET as credit target with WITHDRAW_NET_PENDING code (crypto)', async () => {
      arrangeCreateAsset('CRYPTO');
      const accountingService = module.get<AccountingService>(AccountingService);

      await workflow.createWithdrawal({ assetId: 'asset-tb-1', amount: 110, quoteId: 'wq-tb' } as any, 'user-tb');

      const calls = (accountingService.executePendingTransfer as jest.Mock).mock.calls;
      const netCall = calls.find((c: any[]) => c[0].evidence.eventCode === 'WITHDRAW_LOCK_NET');
      expect(netCall).toBeDefined();
      expect(netCall[0].code).toBe(TB_TRANSFER_CODES.WITHDRAW_NET_PENDING);
      expect(netCall[0].evidence.creditCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET]);
    });

    it('fee pending uses CLIENT_ASSET as credit target with WITHDRAW_FEE_PENDING code (crypto)', async () => {
      arrangeCreateAsset('CRYPTO');
      const accountingService = module.get<AccountingService>(AccountingService);

      await workflow.createWithdrawal({ assetId: 'asset-tb-1', amount: 110, quoteId: 'wq-tb' } as any, 'user-tb');

      const calls = (accountingService.executePendingTransfer as jest.Mock).mock.calls;
      const feeCall = calls.find((c: any[]) => c[0].evidence.eventCode === 'WITHDRAW_LOCK_FEE');
      expect(feeCall).toBeDefined();
      expect(feeCall[0].code).toBe(TB_TRANSFER_CODES.WITHDRAW_FEE_PENDING);
      expect(feeCall[0].evidence.creditCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET]);
    });

    it('net and fee pending both use CLIENT_ASSET (fiat — no branch)', async () => {
      arrangeCreateAsset('FIAT');
      const accountingService = module.get<AccountingService>(AccountingService);

      await workflow.createWithdrawal({ assetId: 'asset-tb-1', amount: 110, quoteId: 'wq-tb' } as any, 'user-tb');

      const calls = (accountingService.executePendingTransfer as jest.Mock).mock.calls;
      for (const call of calls) {
        expect(call[0].evidence.creditCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET]);
      }
    });
  });

  // Task 5 review FIX 1: a FAILED re-valuation must not clobber a good AED
  // birth-value to null (that would zero the row's contribution to the B
  // cumulative window and let a sibling withdrawal slip past the AED cap).
  describe('saveValuationSnapshot — B-sum no-clobber guard', () => {
    beforeEach(() => {
      prisma.withdrawTransaction.update = jest.fn().mockResolvedValue({});
    });

    it('preserves the birth-value: a failed re-valuation does NOT overwrite an existing non-null grossAedValue', async () => {
      prisma.withdrawTransaction.findUnique.mockResolvedValue({
        grossAedValue: new Prisma.Decimal('367000'),
      });

      await service.saveValuationSnapshot('wd-birth', {
        grossAedValue: null,
        aedRate: null,
        rateFetchedAt: null,
        rateFetchFailed: true,
      });

      // No write — the good birth snapshot is left intact.
      expect(prisma.withdrawTransaction.update).not.toHaveBeenCalled();
    });

    it('ADMIN path (no birth-value): a failed re-valuation still writes the failed snapshot', async () => {
      prisma.withdrawTransaction.findUnique.mockResolvedValue({ grossAedValue: null });

      await service.saveValuationSnapshot('wd-admin', {
        grossAedValue: null,
        aedRate: null,
        rateFetchedAt: null,
        rateFetchFailed: true,
      });

      expect(prisma.withdrawTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'wd-admin' },
          data: expect.objectContaining({ grossAedValue: null, rateFetchFailed: true }),
        }),
      );
    });

    it('a successful re-valuation overwrites with the fresher value (no guard, no read)', async () => {
      const fresh = new Prisma.Decimal('999999');

      await service.saveValuationSnapshot('wd-fresh', {
        grossAedValue: fresh,
        aedRate: new Prisma.Decimal('3.67'),
        rateFetchedAt: new Date(),
        rateFetchFailed: false,
      });

      expect(prisma.withdrawTransaction.findUnique).not.toHaveBeenCalled();
      expect(prisma.withdrawTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ grossAedValue: fresh, rateFetchFailed: false }),
        }),
      );
    });
  });

  // 守则性测试(防转移表再次漂移):brief `.superpowers/sdd/task-1-brief.md` Step 1 定稿的
  // 21 条边,2026-08-29 task-B1 补 ACTION_PENDING --resume--> COMPLIANCE_PENDING(补料
  // 回炉)一条,21→22;2026-09-03 平账 B 批③补 SUCCESS --return--> RETURNED 一条,22→23
  // ——逐条列出,多一条、少一条、边指向变了,这里都会红。同时用穷举
  // (10 状态 × 13 动作)反向断言:凡不在这 23 条边名单里的组合,一律必须抛 Invalid
  // action(即没有偷偷长出的第 24 条边)。照抄充值 deposit-transactions.service.spec.ts 的写法。
  describe('state machine integrity guard (23-edge spec)', () => {
    const mockId = 'wd-edge-1';

    function setupMock(status: WithdrawTransactionStatus) {
      mockTx.withdrawTransaction.findUnique.mockResolvedValue({
        id: mockId,
        withdrawNo: 'WD-EDGE',
        ownerType: 'CUSTOMER',
        ownerId: 'cust-edge',
        assetId: 'asset-edge',
        status,
        statusHistory: '[]',
        approvedAt: null,
        payoutRequestedAt: null,
        completedAt: null,
        asset: { type: 'CRYPTO' },
      });
      mockTx.withdrawTransaction.update.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: mockId, status: data.status }),
      );
    }

    const EDGES: Array<
      [WithdrawTransactionStatus, WithdrawTransactionAction, WithdrawTransactionStatus]
    > = [
      [WithdrawTransactionStatus.PENDING_APPROVAL, WithdrawTransactionAction.GATE_APPROVE, WithdrawTransactionStatus.COMPLIANCE_PENDING],
      [WithdrawTransactionStatus.PENDING_APPROVAL, WithdrawTransactionAction.REJECT, WithdrawTransactionStatus.REJECTED],
      // 2026-08-13 新增:大额审批可挂数天,期间客户被冻(材料到期定时任务自动触发)必须冻得住
      [WithdrawTransactionStatus.PENDING_APPROVAL, WithdrawTransactionAction.FREEZE, WithdrawTransactionStatus.FROZEN],

      [WithdrawTransactionStatus.COMPLIANCE_PENDING, WithdrawTransactionAction.APPROVE, WithdrawTransactionStatus.PAYOUT_PENDING],
      [WithdrawTransactionStatus.COMPLIANCE_PENDING, WithdrawTransactionAction.ACTION_PENDING, WithdrawTransactionStatus.ACTION_PENDING],
      [WithdrawTransactionStatus.COMPLIANCE_PENDING, WithdrawTransactionAction.KYT_REJECTED, WithdrawTransactionStatus.MANUAL_CHECKING],
      [WithdrawTransactionStatus.COMPLIANCE_PENDING, WithdrawTransactionAction.SLA_BREACH, WithdrawTransactionStatus.MANUAL_CHECKING],
      [WithdrawTransactionStatus.COMPLIANCE_PENDING, WithdrawTransactionAction.FREEZE, WithdrawTransactionStatus.FROZEN],

      [WithdrawTransactionStatus.ACTION_PENDING, WithdrawTransactionAction.APPROVE, WithdrawTransactionStatus.PAYOUT_PENDING],
      [WithdrawTransactionStatus.ACTION_PENDING, WithdrawTransactionAction.KYT_REJECTED, WithdrawTransactionStatus.MANUAL_CHECKING],
      [WithdrawTransactionStatus.ACTION_PENDING, WithdrawTransactionAction.FREEZE, WithdrawTransactionStatus.FROZEN],
      [WithdrawTransactionStatus.ACTION_PENDING, WithdrawTransactionAction.SLA_BREACH, WithdrawTransactionStatus.MANUAL_CHECKING],
      // 2026-08-29 task-B1 新增:补料审过(GREEN)回合规重跑筛查,充值侧一直有、提现侧此前缺。
      [WithdrawTransactionStatus.ACTION_PENDING, WithdrawTransactionAction.RESUME, WithdrawTransactionStatus.COMPLIANCE_PENDING],

      [WithdrawTransactionStatus.MANUAL_CHECKING, WithdrawTransactionAction.APPROVE, WithdrawTransactionStatus.PAYOUT_PENDING],
      [WithdrawTransactionStatus.MANUAL_CHECKING, WithdrawTransactionAction.ACTION_PENDING, WithdrawTransactionStatus.ACTION_PENDING],
      [WithdrawTransactionStatus.MANUAL_CHECKING, WithdrawTransactionAction.FREEZE, WithdrawTransactionStatus.FROZEN],
      [WithdrawTransactionStatus.MANUAL_CHECKING, WithdrawTransactionAction.REJECT_REFUND, WithdrawTransactionStatus.REJECTED],

      [WithdrawTransactionStatus.FROZEN, WithdrawTransactionAction.RESUME, WithdrawTransactionStatus.COMPLIANCE_PENDING],
      [WithdrawTransactionStatus.FROZEN, WithdrawTransactionAction.REJECT_REFUND, WithdrawTransactionStatus.REJECTED],

      [WithdrawTransactionStatus.PAYOUT_PENDING, WithdrawTransactionAction.SUCCESS, WithdrawTransactionStatus.SUCCESS],
      [WithdrawTransactionStatus.PAYOUT_PENDING, WithdrawTransactionAction.FAIL, WithdrawTransactionStatus.FAILED],
      [WithdrawTransactionStatus.PAYOUT_PENDING, WithdrawTransactionAction.RETURN, WithdrawTransactionStatus.RETURNED],

      // 平账 B 批③(2026-09-03)新增一条：出款成功后被银行退回——唯一出边，SUCCESS
      // 不再是零出边终态（REJECTED/FAILED/RETURNED 三个仍是）。
      [WithdrawTransactionStatus.SUCCESS, WithdrawTransactionAction.RETURN, WithdrawTransactionStatus.RETURNED],
    ];

    it('brief lists exactly the 23 spec edges', () => {
      expect(EDGES).toHaveLength(23);
    });

    it.each(
      EDGES.map(([from, action, to]) => [`${from} --${action}--> ${to}`, from, action, to] as const),
    )('%s', async (_label, from, action, to) => {
      setupMock(from);
      const result = await service.updateStatus(mockId, { action });
      expect(result.status).toBe(to);
    });

    it('rejects every (status,action) pair NOT in the 23-edge list (no undocumented edge exists)', async () => {
      const edgeKeys = new Set(EDGES.map(([from, action]) => `${from}::${action}`));
      const allStatuses = Object.values(WithdrawTransactionStatus);
      const allActions = Object.values(WithdrawTransactionAction);

      for (const status of allStatuses) {
        for (const action of allActions) {
          if (edgeKeys.has(`${status}::${action}`)) continue;
          setupMock(status);
          await expect(
            service.updateStatus(mockId, { action }),
          ).rejects.toThrow(BadRequestException);
        }
      }
    });

    // task-B1(.superpowers/sdd/task-B1-brief.md Step 1)：上面的矩阵测的是「转移表形状
    // 对不对」，这两条测的是「补料回炉」这句业务话对不对——单独具名，方便走查时讲清楚
    // 这条边解决的是什么问题，而不是淹没在穷举列表里。
    it('ACTION_PENDING --RESUME--> COMPLIANCE_PENDING（补料回炉）', async () => {
      setupMock(WithdrawTransactionStatus.ACTION_PENDING);
      const result = await service.updateStatus(mockId, {
        action: WithdrawTransactionAction.RESUME,
        reason: 'material approved — back to compliance',
      });
      expect(result.status).toBe(WithdrawTransactionStatus.COMPLIANCE_PENDING);
    });

    it('非法跃迁仍被显式拒绝：ACTION_PENDING 不能直接 SUCCESS', async () => {
      setupMock(WithdrawTransactionStatus.ACTION_PENDING);
      await expect(
        service.updateStatus(mockId, {
          action: WithdrawTransactionAction.SUCCESS,
          reason: 'x',
        }),
      ).rejects.toThrow(/Invalid action/i);
    });
  });

  // task-7(.superpowers/sdd/reconB/task-7-brief.md Step 1)：与 task-B1 的具名测试同一
  // 用意——上面的矩阵测的是「转移表形状对不对」，这两条单独具名，方便走查时讲清楚
  // SUCCESS 这条新边解决的是什么业务问题（出款成功后被银行退回），而不是淹没在
  // 穷举列表里。
  describe('平账 B 批 ③：SUCCESS 之后的退回', () => {
    const mockId = 'wd-success-return-1';
    function setupMock(status: WithdrawTransactionStatus) {
      mockTx.withdrawTransaction.findUnique.mockResolvedValue({
        id: mockId,
        withdrawNo: 'WD-SUCCESS-RETURN',
        ownerType: 'CUSTOMER',
        ownerId: 'cust-sr',
        assetId: 'asset-sr',
        status,
        statusHistory: '[]',
        approvedAt: null,
        payoutRequestedAt: null,
        completedAt: null,
        asset: { type: 'CRYPTO' },
      });
      mockTx.withdrawTransaction.update.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: mockId, status: data.status }),
      );
    }

    it('SUCCESS —return→ RETURNED；SUCCESS 其余动作仍非法', async () => {
      setupMock(WithdrawTransactionStatus.SUCCESS);
      const result = await service.updateStatus(mockId, { action: WithdrawTransactionAction.RETURN });
      expect(result.status).toBe(WithdrawTransactionStatus.RETURNED);

      setupMock(WithdrawTransactionStatus.SUCCESS);
      await expect(
        service.updateStatus(mockId, { action: WithdrawTransactionAction.APPROVE }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('SLA deadline 在状态机收口处统一设', () => {
    const mockId = 'wd-sla-1';

    function setupMock(status: WithdrawTransactionStatus) {
      const mockRecord = {
        id: mockId,
        withdrawNo: 'WD-SLA',
        ownerType: 'CUSTOMER',
        ownerId: 'cust-sla',
        assetId: 'asset-sla',
        status,
        statusHistory: '[]',
        approvedAt: null,
        payoutRequestedAt: null,
        completedAt: null,
        asset: { type: 'CRYPTO' },
      };
      mockTx.withdrawTransaction.findUnique.mockResolvedValue(mockRecord);
      mockTx.withdrawTransaction.update.mockImplementation(({ data }: any) =>
        Promise.resolve({ ...mockRecord, ...data }),
      );
    }

    it('进入 COMPLIANCE_PENDING 时设 5 分钟 deadline', async () => {
      setupMock(WithdrawTransactionStatus.PENDING_APPROVAL);
      const before = Date.now();

      const updated = await service.updateStatus(mockId, {
        action: WithdrawTransactionAction.GATE_APPROVE,
      });

      expect(updated.status).toBe(WithdrawTransactionStatus.COMPLIANCE_PENDING);
      const delta = new Date(updated.slaDeadline).getTime() - before;
      expect(delta).toBeGreaterThan(4 * 60_000);
      expect(delta).toBeLessThan(6 * 60_000);
      expect(updated.slaBreached).toBe(false);
    });

    it('进入无 SLA 的状态时把 deadline 清空', async () => {
      setupMock(WithdrawTransactionStatus.COMPLIANCE_PENDING);

      const updated = await service.updateStatus(mockId, {
        action: WithdrawTransactionAction.APPROVE,
      });

      expect(updated.status).toBe(WithdrawTransactionStatus.PAYOUT_PENDING);
      expect(updated.slaDeadline).toBeNull();
    });
  });

  describe('setSlaDeadlineByNo (演示用「模拟超时」端点)', () => {
    it('按 withdrawNo 查不到单时抛 NotFoundException', async () => {
      (prisma.withdrawTransaction.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.setSlaDeadlineByNo('WDR-MISSING', new Date(), {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('slaDeadline 为 null（不计时状态）时抛 BadRequestException，不落库不写审计', async () => {
      (prisma.withdrawTransaction.findFirst as jest.Mock).mockResolvedValue({
        id: 'wd-1',
        slaDeadline: null,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
      });

      await expect(
        service.setSlaDeadlineByNo('WDR0001', new Date(), {}),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.withdrawTransaction.update).not.toHaveBeenCalled();
      expect(auditLogsService.recordByActor).not.toHaveBeenCalled();
    });

    it('单据在 SLA 计时状态时把 deadline 拨过去并写审计', async () => {
      const pastDate = new Date(Date.now() - 1000);
      (prisma.withdrawTransaction.findFirst as jest.Mock).mockResolvedValue({
        id: 'wd-1',
        slaDeadline: new Date(Date.now() + 5 * 60_000),
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
      });
      (prisma.withdrawTransaction.update as jest.Mock).mockResolvedValue({
        id: 'wd-1',
        slaDeadline: pastDate,
      });

      const result = await service.setSlaDeadlineByNo('WDR0001', pastDate, {
        actorId: 'admin-1',
        actorRole: 'OPERATOR',
      });

      expect(prisma.withdrawTransaction.update).toHaveBeenCalledWith({
        where: { id: 'wd-1' },
        data: { slaDeadline: pastDate },
      });
      expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'WITHDRAW_SLA_TIMEOUT_SIMULATED',
          primarySubjectType: 'WITHDRAW_TRANSACTION',
          primarySubjectNo: 'WDR0001',
          requestId: expect.stringContaining('SLA_TIMEOUT_SIMULATED'),
        }),
        expect.objectContaining({ actorType: 'ADMIN', actorNo: 'admin-1', actorRolesAtTime: ['OPERATOR'] }),
      );
      expect(result.slaDeadline).toEqual(pastDate);
    });

    it('同一张单连续两次模拟超时，产出不同的 requestId（幂等键不能恒定，否则第二条审计被静默丢弃）', async () => {
      const pastDate = new Date(Date.now() - 1000);
      (prisma.withdrawTransaction.findFirst as jest.Mock).mockResolvedValue({
        id: 'wd-1',
        slaDeadline: new Date(Date.now() + 5 * 60_000),
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
      });
      (prisma.withdrawTransaction.update as jest.Mock).mockResolvedValue({
        id: 'wd-1',
        slaDeadline: pastDate,
      });

      await service.setSlaDeadlineByNo('WDR0001', pastDate, { actorId: 'admin-1', actorRole: 'OPERATOR' });
      await service.setSlaDeadlineByNo('WDR0001', pastDate, { actorId: 'admin-1', actorRole: 'OPERATOR' });

      const calls = auditLogsService.recordByActor.mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][0].requestId).not.toBe(calls[1][0].requestId);
    });
  });
});

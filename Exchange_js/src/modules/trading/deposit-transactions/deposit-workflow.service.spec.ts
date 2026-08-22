import { Test, TestingModule } from '@nestjs/testing';
import { DepositWorkflowService } from './deposit-workflow.service';
import { DepositTransactionsService } from './deposit-transactions.service';
import { DepositApplicantActionsService } from './deposit-applicant-actions.service';
import { FundsOrderService } from '../../funds-orders/funds-order.service';
import { FundsOrderAction } from '../../funds-orders/dto/funds-order.dto';
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
import { PrismaService } from '../../../core/prisma/prisma.service';
import { TransactionLimitRulesService } from '../../asset-treasury/transaction-limits/transaction-limit-rules.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CustomerAccessService } from '../../identity/customers/customer-access.service';
import { CustomerRestrictionsService } from '../../identity/customers/customer-restrictions.service';
import {
  RESTRICTION_CAUSE_POLICY,
  RestrictionCause,
} from '../../identity/customers/constants/restriction-cause.constant';
import { L1GateService } from '../shared/l1-gate/l1-gate.service';
import type { L1Snapshot } from '../shared/l1-gate/l1-gate.types';

/** Task 9：Gate 0 与 checkAutoApproval 改读限制账，不再读已删的 complianceStatus 列。 */
const customerAccessService = {
  resolve: jest.fn(),
  assertCapability: jest.fn(),
  assertOffboardable: jest.fn(),
};
const accessAllowing = () => ({
  lifecycle: 'ACTIVE',
  blocked: new Set<string>(),
  disclosedBlocked: new Set<string>(),
  disclosed: [],
  openCount: 0,
});
const accessBlocking = (...caps: string[]) => ({
  lifecycle: 'ACTIVE',
  blocked: new Set(caps),
  disclosedBlocked: new Set<string>(),
  disclosed: [],
  openCount: 1,
});
/** B4：lifecycle 非 ACTIVE、且**一张便签都没贴**（§4 补的那个真缺口）。 */
const accessLifecycle = (lifecycle: string) => ({
  lifecycle,
  blocked: new Set<string>(),
  disclosedBlocked: new Set<string>(),
  disclosed: [],
  openCount: 0,
});

/**
 * B4：一张 OPEN 便签的 fixture。`scopes` / `releasePolicy` / `visibility` 一律从
 * **真注册表** `RESTRICTION_CAUSE_POLICY` 取，不在这里手打字面量 —— 手打的常量
 * 会在注册表日后改动（新增 MLRO 级 cause、改 scope）之后继续"全过"，测不出任何
 * 东西。分流判据本身就是「按 releasePolicy 派生」，fixture 也必须派生自同一处。
 */
const openRestriction = (cause: RestrictionCause) => {
  const policy = RESTRICTION_CAUSE_POLICY[cause];
  return {
    restrictionNo: `CR-${cause}`,
    customerId: 'cust-1',
    scopes: [...policy.defaultScopes],
    cause,
    visibility: policy.visibility,
    releasePolicy: policy.releasePolicy,
    status: 'OPEN' as const,
    reason: `test ${cause}`,
    caseRef: null,
    releaseOrderRef: null,
    openedAt: new Date('2026-01-01T00:00:00Z'),
    openedBy: 'tester',
    releasedAt: null,
    releasedBy: null,
    releaseApprovalNo: null,
    releaseMode: null,
    traceId: 'trace-r',
  };
};

/** B4：L1GateService.evaluate() 的返回形状（本 spec 里它是 mock，逐格判定由
 *  l1-gate.service.spec.ts 自己钉）。 */
const l1SnapshotFixture = (overrides: Partial<L1Snapshot> = {}): L1Snapshot => ({
  evaluatedAt: '2026-01-01T00:00:00.000Z',
  domain: 'DEPOSIT',
  verdict: 'PASS',
  holdReason: null,
  tradingTier: 'BASIC',
  checks: [],
  ...overrides,
});

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
  let actionsService: Record<string, jest.Mock>;
  let customerRestrictionsService: Record<string, jest.Mock>;
  let l1Gate: Record<string, jest.Mock>;

  beforeEach(async () => {
    // Task 9：access mock 是模块级的，本 spec 无 clearAllMocks —— 逐例复位，
    // 否则调用次数会跨用例累积（「不该被调用」类断言会假红）。
    customerAccessService.resolve.mockReset();
    customerAccessService.resolve.mockResolvedValue(accessAllowing());
    depositService = {
      updateStatus: jest.fn(),
      findOne: jest.fn(),
      updateSumsubVerdict: jest.fn(),
      saveTxnDetail: jest.fn().mockResolvedValue(undefined),
      setSlaDeadline: jest.fn().mockResolvedValue(undefined),
      // reissue 路径(applyKytAwaitUser 的 clearDepositCache 调用点)显式查一次
      // 收口处同一张配置表 —— mock 出一个恒有效的 ACTION_PENDING deadline。
      resolveSlaFields: jest.fn().mockReturnValue({
        slaDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        slaBreached: false,
      }),
      setSumsubTxn: jest.fn().mockResolvedValue(undefined),
      clearLimitHold: jest.fn().mockResolvedValue(undefined),
      findNonTerminalByOwner: jest.fn().mockResolvedValue([]),
      // 生产代码在崩溃分支里对返回值链 .catch(...)（见 A2）——必须 resolve 而非裸
      // jest.fn()(返回 undefined),否则 undefined.catch(...) 同步抛错，会把既有
      // "Fix 2" 崩溃路径用例带崩。
      markNeedsReview: jest.fn().mockResolvedValue(undefined),
      // B4：Gate 0 的 L1 快照落库出口（铁律⑤：workflow 不直接写 domain 表）。
      saveL1Snapshot: jest.fn().mockResolvedValue(undefined),
    };
    actionsService = {
      syncApplicantActions: jest.fn().mockResolvedValue({ added: [], retired: [] }),
      clearDepositCache: jest.fn(),
      listForCustomer: jest.fn().mockResolvedValue([]),
      findBySeq: jest.fn(),
      hasOutstanding: jest.fn().mockResolvedValue(false),
      submitBySeq: jest.fn(),
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
    customerRestrictionsService = {
      open: jest.fn().mockResolvedValue({ restrictionNo: 'CR-TEST-1', created: true }),
      // B4：Gate 0 分流要拿 cause/releasePolicy —— CustomerAccess.resolve() 结构性
      // 给不出（disclosed 只含 DISCLOSED 行，SILENT 的 SANCTION 不在里面）。
      listOpen: jest.fn().mockResolvedValue([]),
    };
    l1Gate = {
      evaluate: jest.fn().mockResolvedValue(l1SnapshotFixture()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: CustomerAccessService, useValue: customerAccessService },
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
        { provide: DepositApplicantActionsService, useValue: actionsService },
        { provide: CustomerRestrictionsService, useValue: customerRestrictionsService },
        { provide: L1GateService, useValue: l1Gate },
      ],
    }).compile();

    service = module.get<DepositWorkflowService>(DepositWorkflowService);
  });

  describe('handleDepositStatusChanged — Gate 0', () => {
    /** Gate 0 现在一进来就 findOne（要拿 limitHoldReason 记 SINGLE_LIMIT、要拿单号写快照/审计）。 */
    const gate0Deposit = (overrides: Record<string, unknown> = {}) => ({
      id: 'dep-1',
      depositNo: 'DEP001',
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      traceId: null,
      amount: '100',
      limitHoldReason: null,
      ...overrides,
    });

    const gate0Event = () =>
      new DepositStatusChangedEvent(
        'dep-1',
        DepositTransactionStatus.PAYIN_PENDING,
        DepositTransactionStatus.COMPLIANCE_PENDING,
        'CUSTOMER', 'cust-1', 'asset-1', '100',
      );

    it('runs Gate 0 when entering COMPLIANCE_PENDING with normal customer', async () => {
      customerAccessService.resolve.mockResolvedValue(accessAllowing());
      depositService.findOne.mockResolvedValue({ id: 'dep-1', depositNo: 'DEP001', ownerType: 'CUSTOMER', ownerId: 'cust-1', traceId: null });

      const event = new DepositStatusChangedEvent(
        'dep-1',
        DepositTransactionStatus.PAYIN_PENDING,
        DepositTransactionStatus.COMPLIANCE_PENDING,
        'CUSTOMER', 'cust-1', 'asset-1', '100',
      );

      await service.handleDepositStatusChanged(event);

      expect(customerAccessService.resolve).toHaveBeenCalledWith('cust-1');
    });

    it('freezes deposit when customer DEPOSIT capability is blocked', async () => {
      customerAccessService.resolve.mockResolvedValue(accessBlocking('DEPOSIT', 'WITHDRAW', 'SWAP'));
      customerRestrictionsService.listOpen.mockResolvedValue([openRestriction('SANCTION')]);
      depositService.findOne.mockResolvedValue(gate0Deposit());

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
          reason: expect.stringContaining('DEPOSIT capability is restricted'),
        }),
      );
    });

    it('freezes deposit when customer all capabilities are blocked', async () => {
      customerAccessService.resolve.mockResolvedValue(accessBlocking('DEPOSIT', 'WITHDRAW', 'SWAP'));
      customerRestrictionsService.listOpen.mockResolvedValue([openRestriction('SANCTION')]);
      depositService.findOne.mockResolvedValue(gate0Deposit());

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
          reason: expect.stringContaining('DEPOSIT capability is restricted'),
        }),
      );
    });

    // ── B4（第四批）· 分流 / lifecycle / 快照 ───────────────────────────────
    // 业主 2026-08-22 裁定一：执法级（MLRO_APPROVAL）→ FROZEN，非执法级
    // （OPS_APPROVAL）→ OPERATION_PENDING。判据按 releasePolicy 派生，不写死
    // cause 名单 —— 将来新增一个 MLRO 级 cause 会自动走对分支。

    it('B4 分流：ADMIN_SUSPENSION（OPS_APPROVAL，行政级）卡住 DEPOSIT → OPERATION_PENDING + 落挂起原因，不冻', async () => {
      customerAccessService.resolve.mockResolvedValue(accessBlocking('DEPOSIT', 'WITHDRAW', 'SWAP'));
      customerRestrictionsService.listOpen.mockResolvedValue([openRestriction('ADMIN_SUSPENSION')]);
      depositService.findOne.mockResolvedValue(gate0Deposit());
      l1Gate.evaluate.mockResolvedValue(
        l1SnapshotFixture({ verdict: 'HOLD', holdReason: 'CAPABILITY_RESTRICTED' }),
      );

      await service.handleDepositStatusChanged(gate0Event());

      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'dep-1',
        expect.objectContaining({ action: DepositTransactionAction.OPERATION_PENDING }),
        expect.objectContaining({
          extraData: expect.objectContaining({ limitHoldReason: 'CAPABILITY_RESTRICTED' }),
        }),
      );
      expect(depositService.updateStatus).not.toHaveBeenCalledWith(
        'dep-1',
        expect.objectContaining({ action: DepositTransactionAction.FREEZE }),
        expect.anything(),
      );
    });

    it('B4 分流：只要有一条 MLRO_APPROVAL 便签卡住 DEPOSIT，混着 OPS 级也照冻（执法级优先）', async () => {
      customerAccessService.resolve.mockResolvedValue(accessBlocking('DEPOSIT', 'WITHDRAW', 'SWAP'));
      customerRestrictionsService.listOpen.mockResolvedValue([
        openRestriction('ADMIN_SUSPENSION'),
        openRestriction('SANCTION'),
      ]);
      depositService.findOne.mockResolvedValue(gate0Deposit());

      await service.handleDepositStatusChanged(gate0Event());

      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'dep-1',
        { action: DepositTransactionAction.FREEZE },
        expect.anything(),
      );
    });

    it('B4 分流：MLRO 级便签的 scope 不含 DEPOSIT（KYT_REJECTED_HARD 只卡 WITHDRAW/SWAP）时不算数 —— scope 必须展开后再判', async () => {
      // 卡住 DEPOSIT 的只有 ADMIN_SUSPENSION(ALL/OPS)；KYT_REJECTED_HARD 虽是 MLRO 级，
      // 但 scope 是 WITHDRAW+SWAP，不该把这笔充值拖进 FROZEN。
      // 若实现少了 scope 过滤（对整张便签表 some(MLRO)），这条会红。
      customerAccessService.resolve.mockResolvedValue(accessBlocking('DEPOSIT', 'WITHDRAW', 'SWAP'));
      customerRestrictionsService.listOpen.mockResolvedValue([
        openRestriction('ADMIN_SUSPENSION'),
        openRestriction('KYT_REJECTED_HARD'),
      ]);
      depositService.findOne.mockResolvedValue(gate0Deposit());
      l1Gate.evaluate.mockResolvedValue(
        l1SnapshotFixture({ verdict: 'HOLD', holdReason: 'CAPABILITY_RESTRICTED' }),
      );

      await service.handleDepositStatusChanged(gate0Event());

      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'dep-1',
        expect.objectContaining({ action: DepositTransactionAction.OPERATION_PENDING }),
        expect.anything(),
      );
    });

    it('B4 分流：便签一张都没有却 blocked（内部不一致，分类不出来）→ 不降级，保持现状 FROZEN', async () => {
      customerAccessService.resolve.mockResolvedValue(accessBlocking('DEPOSIT'));
      customerRestrictionsService.listOpen.mockResolvedValue([]);
      depositService.findOne.mockResolvedValue(gate0Deposit());

      await service.handleDepositStatusChanged(gate0Event());

      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'dep-1',
        { action: DepositTransactionAction.FREEZE },
        expect.anything(),
      );
    });

    // §4：Gate 0 此前只判 blocked，**没判 lifecycle** —— 已销户/停用但没贴便签的
    // 客户，充值一路走得通。lifecycle 非 ACTIVE 属行政性 → OPERATION_PENDING。
    it('B4 §4：lifecycle 非 ACTIVE 且一张便签都没有 → OPERATION_PENDING（此前这种单一路放行）', async () => {
      customerAccessService.resolve.mockResolvedValue(accessLifecycle('OFFBOARDED'));
      customerRestrictionsService.listOpen.mockResolvedValue([]);
      depositService.findOne.mockResolvedValue(gate0Deposit());
      l1Gate.evaluate.mockResolvedValue(
        l1SnapshotFixture({ verdict: 'HOLD', holdReason: 'LIFECYCLE_NOT_ACTIVE' }),
      );

      await service.handleDepositStatusChanged(gate0Event());

      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'dep-1',
        expect.objectContaining({ action: DepositTransactionAction.OPERATION_PENDING }),
        expect.objectContaining({
          extraData: expect.objectContaining({ limitHoldReason: 'LIFECYCLE_NOT_ACTIVE' }),
        }),
      );
    });

    it('B4 §4：lifecycle 非 ACTIVE 的单不进 Sumsub（挂起路径不提交 KYT）', async () => {
      customerAccessService.resolve.mockResolvedValue(accessLifecycle('OFFBOARDED'));
      customerRestrictionsService.listOpen.mockResolvedValue([]);
      depositService.findOne.mockResolvedValue(
        gate0Deposit({ customer: { sumsubApplicantId: 'appl-1' }, asset: { type: 'CRYPTO', currency: 'USDT' } }),
      );

      await service.handleDepositStatusChanged(gate0Event());

      expect(sumsubTxnClient.submitTxn).not.toHaveBeenCalled();
    });

    // §5：快照落库。preChecks 的每一格都必须守 B2 判据 ——「PASS 当且仅当该守卫对
    // 本请求已确凿通过」。写不实的 PASS 是伪证据。
    it('B4 §5：Gate 0 放行时落 l1Snapshot，preChecks 恰为四格且 outcome 守 B2 判据', async () => {
      customerAccessService.resolve.mockResolvedValue(accessAllowing());
      customerRestrictionsService.listOpen.mockResolvedValue([]);
      depositService.findOne.mockResolvedValue(gate0Deposit());
      const snapshot = l1SnapshotFixture();
      l1Gate.evaluate.mockResolvedValue(snapshot);

      await service.handleDepositStatusChanged(gate0Event());

      expect(l1Gate.evaluate).toHaveBeenCalledWith({
        domain: 'DEPOSIT',
        customerId: 'cust-1',
        preChecks: [
          // 建单时 detected() 判过下限（低于则出生带 BELOW_MIN），本单没带 → 确凿过了
          expect.objectContaining({ code: 'SINGLE_LIMIT', outcome: 'PASS' }),
          // 建单时 detected() 无条件校验过收款钱包存在且资产匹配，不过整单不建
          expect.objectContaining({ code: 'ACCOUNT_READINESS', outcome: 'PASS' }),
          // ⚠️ 交易起始就绪（法币提现地址）这一刻**没人判过**：
          //    assertTradingEligibility(customerId,'DEPOSIT') 对 DEPOSIT 刻意跳过
          //    assertTradingReady（onboarding.service.ts:1192-1194），真正判它的
          //    assertTradingReadyOrHold 跑在放行前、在本评估点之后 → 只能 SKIPPED
          expect.objectContaining({ code: 'TRADING_READINESS', outcome: 'SKIPPED' }),
        ],
      });
      // 自判两项（资格/限制）绝不由调用方传 —— B1 的 SELF_OWNED_CHECKS 会丢弃，
      // 传了等于给下一个人埋一个"传了也没用"的坑。
      const passed = l1Gate.evaluate.mock.calls[0][0].preChecks.map((c: any) => c.code);
      expect(passed).not.toContain('CUSTOMER_ELIGIBILITY');
      expect(passed).not.toContain('CUSTOMER_RESTRICTION');
      expect(depositService.saveL1Snapshot).toHaveBeenCalledWith('dep-1', JSON.stringify(snapshot));
    });

    it('B4 §5：单子出生带 BELOW_MIN 时 SINGLE_LIMIT 记 FAIL（那一格确实没过，不许盖 PASS）', async () => {
      customerAccessService.resolve.mockResolvedValue(accessAllowing());
      customerRestrictionsService.listOpen.mockResolvedValue([]);
      depositService.findOne.mockResolvedValue(gate0Deposit({ limitHoldReason: 'BELOW_MIN' }));

      await service.handleDepositStatusChanged(gate0Event());

      expect(l1Gate.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({
          preChecks: expect.arrayContaining([
            expect.objectContaining({ code: 'SINGLE_LIMIT', outcome: 'FAIL' }),
          ]),
        }),
      );
    });

    // ── B4 修复轮 · Critical：`limitHoldReason` 一列两个主人 ──────────────────
    // 「BELOW_MIN 单 + 便签命中」此前是**测试盲区**：本 spec 里 l1Gate 是 mock、
    // holdReason 由 fixture 直接喂，这个组合从没被跑过。所以这一例刻意接**真**
    // L1GateService 求值（只喂 access + 便签），让 holdReason 由真实的 CHECK_ORDER
    // 算出来 —— 用 fixture 写死一个 'BELOW_MIN' 会是自证型绿灯，测不出覆盖。
    it('B4 修复轮：BELOW_MIN 单被 Gate 0 行政级挂起时，列上必须仍是 BELOW_MIN（客户级原因不许覆盖单级原因）', async () => {
      customerAccessService.resolve.mockResolvedValue(
        accessBlocking('DEPOSIT', 'WITHDRAW', 'SWAP'),
      );
      customerRestrictionsService.listOpen.mockResolvedValue([
        openRestriction('ADMIN_SUSPENSION'),
      ]);
      depositService.findOne.mockResolvedValue(gate0Deposit({ limitHoldReason: 'BELOW_MIN' }));

      // 真求值器：holdReason 取 CHECK_ORDER 里第一条 FAIL，而 CUSTOMER_RESTRICTION
      // 排在 SINGLE_LIMIT 前面 → 真实返回值是 CAPABILITY_RESTRICTED，**不是** BELOW_MIN。
      const realGate = new L1GateService(customerAccessService as any, {
        customerMain: {
          findUnique: jest.fn().mockResolvedValue({ tradingTier: 'BASIC' }),
        },
      } as any);
      l1Gate.evaluate.mockImplementation((input: any) => realGate.evaluate(input));

      await service.handleDepositStatusChanged(gate0Event());

      // 前提自证：这一轮真算出来的挂起原因确实是**客户级**那条。没有这两行，
      // 下面那条断言可能只是「碰巧两边相等」而非「没被覆盖」。
      const snapshot: L1Snapshot = JSON.parse(
        depositService.saveL1Snapshot.mock.calls[0][1],
      );
      expect(snapshot.verdict).toBe('HOLD');
      expect(snapshot.holdReason).toBe('CAPABILITY_RESTRICTED');

      // 列上保留单级原因：否则 waive 后这笔低于下限的钱直接入账、
      // DEPOSIT_HELD_BELOW_MIN 审计不写、没收弧（硬钉 BELOW_MIN）永远进不去。
      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'dep-1',
        expect.objectContaining({ action: DepositTransactionAction.OPERATION_PENDING }),
        expect.objectContaining({ extraData: { limitHoldReason: 'BELOW_MIN' } }),
      );
      // 保留 BELOW_MIN ≠ 放过这个客户：单子照样被路由到挂起，且不该被冻。
      expect(depositService.updateStatus).not.toHaveBeenCalledWith(
        'dep-1',
        expect.objectContaining({ action: DepositTransactionAction.FREEZE }),
        expect.anything(),
      );
    });

    it('B4 §5：冻结路径同样落 l1Snapshot（证据不因处置分支而缺失）', async () => {
      customerAccessService.resolve.mockResolvedValue(accessBlocking('DEPOSIT'));
      customerRestrictionsService.listOpen.mockResolvedValue([openRestriction('SANCTION')]);
      depositService.findOne.mockResolvedValue(gate0Deposit());
      const snapshot = l1SnapshotFixture({ verdict: 'HOLD', holdReason: 'CAPABILITY_RESTRICTED' });
      l1Gate.evaluate.mockResolvedValue(snapshot);

      await service.handleDepositStatusChanged(gate0Event());

      expect(depositService.saveL1Snapshot).toHaveBeenCalledWith('dep-1', JSON.stringify(snapshot));
    });

    it('does nothing for non-COMPLIANCE_PENDING transitions', async () => {
      const event = new DepositStatusChangedEvent(
        'dep-1',
        DepositTransactionStatus.COMPLIANCE_PENDING,
        DepositTransactionStatus.SUCCESS,
        'CUSTOMER', 'cust-1', 'asset-1', '100',
      );

      await service.handleDepositStatusChanged(event);

      expect(customerAccessService.resolve).not.toHaveBeenCalled();
    });
  });

  describe('submitSumsub — Task 5: single-txn submit (判定接线,带开关)', () => {
    const baseFiatDeposit = {
      id: 'dep-sub-fiat',
      depositNo: 'DEP-SUB-FIAT-001',
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      traceId: null,
      amount: '500',
      asset: { type: 'FIAT', currency: 'AED' },
      counterpartyIsVasp: null,
      customer: { sumsubApplicantId: 'applicant-1' },
    };

    // crypto + VASP + amount >= USDT 阈值(1000) → resolveKytTxnType 判 travelRule
    const baseCryptoVaspOverThreshold = {
      id: 'dep-sub-crypto-tr',
      depositNo: 'DEP-SUB-CRYPTO-TR-001',
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      traceId: null,
      amount: '1500',
      asset: { type: 'CRYPTO', currency: 'USDT' },
      counterpartyIsVasp: true,
      customer: { sumsubApplicantId: 'applicant-1' },
    };

    // crypto + 非 VASP(counterpartyIsVasp=false) → 恒 finance,即使超阈值
    const baseCryptoNotVasp = {
      id: 'dep-sub-crypto-nonvasp',
      depositNo: 'DEP-SUB-CRYPTO-NONVASP-001',
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      traceId: null,
      amount: '1500',
      asset: { type: 'CRYPTO', currency: 'USDT' },
      counterpartyIsVasp: false,
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

    const ORIGINAL_SWITCH_ENV = process.env.SUMSUB_SINGLE_TXN_SUBMIT;
    const ORIGINAL_MOCK_ENV = process.env.SUMSUB_MOCK_MODE;

    beforeEach(() => {
      customerAccessService.resolve.mockResolvedValue(accessAllowing());
      // 两个开关都会让判定生效,任一残留都会污染"OFF"组。逐个 describe 自己设。
      delete process.env.SUMSUB_MOCK_MODE;
    });

    afterEach(() => {
      if (ORIGINAL_SWITCH_ENV === undefined) {
        delete process.env.SUMSUB_SINGLE_TXN_SUBMIT;
      } else {
        process.env.SUMSUB_SINGLE_TXN_SUBMIT = ORIGINAL_SWITCH_ENV;
      }
      if (ORIGINAL_MOCK_ENV === undefined) {
        delete process.env.SUMSUB_MOCK_MODE;
      } else {
        process.env.SUMSUB_MOCK_MODE = ORIGINAL_MOCK_ENV;
      }
    });

    describe('switch ON (SUMSUB_SINGLE_TXN_SUBMIT=true)', () => {
      beforeEach(() => {
        process.env.SUMSUB_SINGLE_TXN_SUBMIT = 'true';
      });

      it('crypto + VASP + over threshold → submitTxn called once, type=travelRule', async () => {
        depositService.findOne.mockResolvedValue(baseCryptoVaspOverThreshold);
        sumsubTxnClient.submitTxn.mockResolvedValue({ txnId: 'TXN-TR-1' });

        await service.handleDepositStatusChanged(mkEvent('dep-sub-crypto-tr'));

        expect(sumsubTxnClient.submitTxn).toHaveBeenCalledTimes(1);
        expect(sumsubTxnClient.submitTxn).toHaveBeenCalledWith(
          expect.objectContaining({
            applicantId: 'applicant-1',
            clientTxnId: 'DEP-SUB-CRYPTO-TR-001',
            type: 'travelRule',
            direction: 'in',
            amount: 1500,
            currencyCode: 'USDT',
            currencyType: 'crypto',
          }),
        );
        expect(depositService.setSumsubTxn).toHaveBeenCalledWith('dep-sub-crypto-tr', {
          sumsubTxnId: 'TXN-TR-1',
          sumsubTxnType: 'travelRule',
        });
        expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
          expect.objectContaining({
            action: AuditActions.DEPOSIT_SUMSUB_SUBMITTED,
            entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
            entityId: 'dep-sub-crypto-tr',
            entityNo: 'DEP-SUB-CRYPTO-TR-001',
            metadata: { sumsubTxnId: 'TXN-TR-1', txnType: 'travelRule', reason: 'TR_REQUIRED' },
          }),
        );
      });

      it('crypto + non-VASP → submitTxn called once, type=finance', async () => {
        depositService.findOne.mockResolvedValue(baseCryptoNotVasp);
        sumsubTxnClient.submitTxn.mockResolvedValue({ txnId: 'TXN-FIN-2' });

        await service.handleDepositStatusChanged(mkEvent('dep-sub-crypto-nonvasp'));

        expect(sumsubTxnClient.submitTxn).toHaveBeenCalledTimes(1);
        expect(sumsubTxnClient.submitTxn).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'finance', currencyType: 'crypto', currencyCode: 'USDT' }),
        );
        expect(depositService.setSumsubTxn).toHaveBeenCalledWith('dep-sub-crypto-nonvasp', {
          sumsubTxnId: 'TXN-FIN-2',
          sumsubTxnType: 'finance',
        });
        expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: { sumsubTxnId: 'TXN-FIN-2', txnType: 'finance', reason: 'COUNTERPARTY_NOT_VASP' },
          }),
        );
      });

      it('fiat → submitTxn called once, type=finance', async () => {
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
        expect(depositService.setSumsubTxn).toHaveBeenCalledWith('dep-sub-fiat', {
          sumsubTxnId: 'TXN-FIN-1',
          sumsubTxnType: 'finance',
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
            metadata: { sumsubTxnId: 'TXN-FIN-1', txnType: 'finance', reason: 'NOT_CRYPTO' },
          }),
        );
      });
    });

    describe('mock 模式隐含开启 (SUMSUB_MOCK_MODE=true, 开关未设)', () => {
      // 该开关守的是**真实 Sumsub 集成**的筛查真空风险(规则作用域若只含 finance,
      // travelRule 单不进规则)。mock 模式下压根没有真实规则引擎,风险结构性不存在
      // —— 用真实集成的安全阀锁死演示/e2e 是范畴错误,判定器结果必须原样生效。
      beforeEach(() => {
        delete process.env.SUMSUB_SINGLE_TXN_SUBMIT;
        process.env.SUMSUB_MOCK_MODE = 'true';
      });

      it('crypto + VASP + over threshold → type=travelRule(判定生效,不被降级)', async () => {
        depositService.findOne.mockResolvedValue(baseCryptoVaspOverThreshold);
        sumsubTxnClient.submitTxn.mockResolvedValue({ txnId: 'TXN-TR-MOCK' });

        await service.handleDepositStatusChanged(mkEvent('dep-sub-crypto-tr'));

        expect(sumsubTxnClient.submitTxn).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'travelRule' }),
        );
        expect(depositService.setSumsubTxn).toHaveBeenCalledWith('dep-sub-crypto-tr', {
          sumsubTxnId: 'TXN-TR-MOCK',
          sumsubTxnType: 'travelRule',
        });
      });

      it('crypto + non-VASP → type=finance(mock 模式不是无条件 TR)', async () => {
        depositService.findOne.mockResolvedValue(baseCryptoNotVasp);
        sumsubTxnClient.submitTxn.mockResolvedValue({ txnId: 'TXN-FIN-MOCK' });

        await service.handleDepositStatusChanged(mkEvent('dep-sub-crypto-nonvasp'));

        expect(sumsubTxnClient.submitTxn).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'finance' }),
        );
      });
    });

    describe('switch OFF (default — SUMSUB_SINGLE_TXN_SUBMIT unset)', () => {
      it('crypto + VASP + over threshold → still submits ONCE, but forced to type=finance (reason still reflects the real判定)', async () => {
        delete process.env.SUMSUB_SINGLE_TXN_SUBMIT;
        depositService.findOne.mockResolvedValue(baseCryptoVaspOverThreshold);
        sumsubTxnClient.submitTxn.mockResolvedValue({ txnId: 'TXN-FIN-3' });

        await service.handleDepositStatusChanged(mkEvent('dep-sub-crypto-tr'));

        expect(sumsubTxnClient.submitTxn).toHaveBeenCalledTimes(1);
        expect(sumsubTxnClient.submitTxn).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'finance', currencyType: 'crypto', currencyCode: 'USDT' }),
        );
        expect(depositService.setSumsubTxn).toHaveBeenCalledWith('dep-sub-crypto-tr', {
          sumsubTxnId: 'TXN-FIN-3',
          sumsubTxnType: 'finance',
        });
        expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: { sumsubTxnId: 'TXN-FIN-3', txnType: 'finance', reason: 'TR_REQUIRED' },
          }),
        );
      });

      it('fiat → submits once, type=finance (no behavior change)', async () => {
        delete process.env.SUMSUB_SINGLE_TXN_SUBMIT;
        depositService.findOne.mockResolvedValue(baseFiatDeposit);
        sumsubTxnClient.submitTxn.mockResolvedValue({ txnId: 'TXN-FIN-1' });

        await service.handleDepositStatusChanged(mkEvent('dep-sub-fiat'));

        expect(sumsubTxnClient.submitTxn).toHaveBeenCalledTimes(1);
        expect(sumsubTxnClient.submitTxn).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'finance' }),
        );
        expect(depositService.setSumsubTxn).toHaveBeenCalledWith('dep-sub-fiat', {
          sumsubTxnId: 'TXN-FIN-1',
          sumsubTxnType: 'finance',
        });
      });
    });

    it('customer has no sumsubApplicantId → warns and skips submission (stays COMPLIANCE_PENDING for manual handling)', async () => {
      depositService.findOne.mockResolvedValue({
        ...baseFiatDeposit,
        customer: {},
      });

      await service.handleDepositStatusChanged(mkEvent('dep-sub-fiat'));

      expect(sumsubTxnClient.submitTxn).not.toHaveBeenCalled();
      expect(depositService.setSumsubTxn).not.toHaveBeenCalled();
      // No submission happened → no DEPOSIT_SUMSUB_SUBMITTED audit entry.
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.DEPOSIT_SUMSUB_SUBMITTED }),
      );
    });

    it('deposit already has sumsubTxnId → idempotent skip (no re-submit on runGate0 re-entry)', async () => {
      depositService.findOne.mockResolvedValue({
        ...baseFiatDeposit,
        sumsubTxnId: 'TXN-ALREADY-SET',
      });

      await service.handleDepositStatusChanged(mkEvent('dep-sub-fiat'));

      expect(sumsubTxnClient.submitTxn).not.toHaveBeenCalled();
      expect(depositService.setSumsubTxn).not.toHaveBeenCalled();
    });

    it('I2: submitTxn throws (real HTTP failure) → runGate0 does not throw, deposit stays COMPLIANCE_PENDING', async () => {
      depositService.findOne.mockResolvedValue(baseFiatDeposit);
      sumsubTxnClient.submitTxn.mockRejectedValue(new Error('ECONNREFUSED: Sumsub unreachable'));

      await expect(service.handleDepositStatusChanged(mkEvent('dep-sub-fiat'))).resolves.not.toThrow();

      expect(sumsubTxnClient.submitTxn).toHaveBeenCalledTimes(1);
      // Submission failed → no txnId persisted, no DEPOSIT_SUMSUB_SUBMITTED audit.
      expect(depositService.setSumsubTxn).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.DEPOSIT_SUMSUB_SUBMITTED }),
      );
      // Gate 0 must NOT be strand: deposit is not touched via updateStatus
      // (i.e. it stays wherever it already is — COMPLIANCE_PENDING).
      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('checkAutoApproval', () => {
    it('approves when sumsubVerdict=approved (COMPLIANCE_PENDING + ACTIVE + trading-ready)', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-1',
        depositNo: 'DEP001',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        sumsubVerdict: 'approved',
        ownerId: 'cust-1',
        ownerType: 'CUSTOMER',
        assetId: 'asset-1',
        amount: '100',
        payinId: 'payin-1',
        traceId: 'trace-1',
        asset: { currency: 'USDT', tbLedgerId: 2, decimals: 6 },
      });
      customerAccessService.resolve.mockResolvedValue(accessAllowing());
      depositService.updateStatus.mockResolvedValue({});
      withdrawalAddresses.hasActiveFiatWithdrawalAddress.mockResolvedValue(true);

      await service.checkAutoApproval('dep-1');

      expect(depositService.findOne).toHaveBeenCalledWith('dep-1');
      expect(customerAccessService.resolve).toHaveBeenCalledWith('cust-1');
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
        sumsubVerdict: 'approved',
        ownerId: 'cust-1',
        ownerType: 'CUSTOMER',
        assetId: 'asset-1',
        amount: '100',
        payinId: 'payin-1',
        traceId: 'trace-1',
        asset: { currency: 'USDT', tbLedgerId: 2, decimals: 6 },
      });
      customerAccessService.resolve.mockResolvedValue(accessAllowing());
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

    it('holds when limitHoldReason=BELOW_MIN — audits DEPOSIT_HELD_BELOW_MIN, transitions to OPERATION_PENDING, never approves (2026-07-31 口径反转: 金额闸移到 approved 之后; 2026-07-31 闸下沉到 approveDeposit 唯一出口后,断言改为验可观测结果而非"approveDeposit 未被调用"这一实现细节——闸下沉后 checkAutoApproval 仍会调用 approveDeposit,只是 approveDeposit 自己在记账前拦下)', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-1',
        depositNo: 'DEP001',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        sumsubVerdict: 'approved',
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
      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'dep-1',
        expect.objectContaining({ action: DepositTransactionAction.OPERATION_PENDING }),
        expect.anything(),
      );
      // 终态不是 APPROVE/SUCCESS,也没有记账相关审计——闸真的拦住了钱,不只是拦住了某个 helper 调用
      expect(depositService.updateStatus).not.toHaveBeenCalledWith(
        'dep-1',
        { action: DepositTransactionAction.APPROVE },
      );
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.DEPOSIT_APPROVED }),
      );
      expect(fundsOrders.findByParent).not.toHaveBeenCalled();
    });

    it('does not approve when deposit is FROZEN (even if sumsubVerdict is approved)', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-1',
        status: DepositTransactionStatus.FROZEN,
        sumsubVerdict: 'approved',
      });

      await service.checkAutoApproval('dep-1');

      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('does not approve when sumsubVerdict is not approved (e.g. onHold)', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-1',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        sumsubVerdict: 'onHold',
      });

      await service.checkAutoApproval('dep-1');

      expect(customerAccessService.resolve).not.toHaveBeenCalled();
      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('does not approve when sumsubVerdict is absent (webhook not yet received)', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-1',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        sumsubVerdict: null,
      });

      await service.checkAutoApproval('dep-1');

      expect(customerAccessService.resolve).not.toHaveBeenCalled();
      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('does not approve when customer compliance is abnormal', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-1',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        sumsubVerdict: 'approved',
        ownerId: 'cust-1',
      });
      customerAccessService.resolve.mockResolvedValue(accessBlocking('DEPOSIT', 'WITHDRAW', 'SWAP'));

      await service.checkAutoApproval('dep-1');

      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('approves fiat deposit when sumsubVerdict=approved (single type, no separate travel-rule gate)', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-fiat-1',
        depositNo: 'DEP-FIAT-001',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        sumsubVerdict: 'approved',
        ownerId: 'cust-1',
        ownerType: 'CUSTOMER',
        assetId: 'asset-usd',
        amount: '500',
        payinId: 'payin-fiat-1',
        traceId: 'trace-fiat-1',
        asset: { currency: 'USD', tbLedgerId: 3, decimals: 2 },
      });
      customerAccessService.resolve.mockResolvedValue(accessAllowing());
      depositService.updateStatus.mockResolvedValue({});
      withdrawalAddresses.hasActiveFiatWithdrawalAddress.mockResolvedValue(true);

      await service.checkAutoApproval('dep-fiat-1');

      expect(depositService.findOne).toHaveBeenCalledWith('dep-fiat-1');
      
      expect(depositService.updateStatus).toHaveBeenCalledWith('dep-fiat-1', {
        action: DepositTransactionAction.APPROVE,
      });
    });
  });

  describe('applyKytApproved — Bug 2 回归闸: approved 主路径也要过金额闸', () => {
    it('BELOW_MIN 单收到 approved → 转 OPERATION_PENDING,不放行不记账（Bug 2 回归闸；2026-07-31 闸下沉到 approveDeposit 唯一出口后,断言改为验可观测结果而非"approveDeposit 未被调用"这一实现细节——闸下沉后 applyKytApproved 仍会调用 approveDeposit,只是 approveDeposit 自己在记账前拦下）', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-below-min',
        depositNo: 'DEP-BELOW-MIN-001',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        limitHoldReason: 'BELOW_MIN',
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: 'tr-1',
      });
      withdrawalAddresses.hasActiveFiatWithdrawalAddress.mockResolvedValue(true);

      await (service as any).applyKytApproved(await depositService.findOne('dep-below-min'));

      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'dep-below-min',
        expect.objectContaining({ action: DepositTransactionAction.OPERATION_PENDING }),
        expect.anything(),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.DEPOSIT_HELD_BELOW_MIN }),
      );
      // 终态不是 APPROVE/SUCCESS,也没有记账相关审计——闸真的拦住了钱,不只是拦住了某个 helper 调用
      expect(depositService.updateStatus).not.toHaveBeenCalledWith(
        'dep-below-min',
        { action: DepositTransactionAction.APPROVE },
      );
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.DEPOSIT_APPROVED }),
      );
      expect(fundsOrders.findByParent).not.toHaveBeenCalled();
    });

    it('金额达标单收到 approved → 照常 approveDeposit', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-ok',
        depositNo: 'DEP-OK-001',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        limitHoldReason: null,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
      });
      withdrawalAddresses.hasActiveFiatWithdrawalAddress.mockResolvedValue(true);
      const approveSpy = jest.spyOn(service, 'approveDeposit').mockResolvedValue(undefined as any);

      await (service as any).applyKytApproved(await depositService.findOne('dep-ok'));

      expect(approveSpy).toHaveBeenCalledWith('dep-ok');
    });
  });

  describe('approveDeposit — 金额闸下沉到唯一出口(admin 直调 PATCH /status 也必须过闸)', () => {
    it('直调 approveDeposit 于 BELOW_MIN 单 → 转 OPERATION_PENDING + 审计 DEPOSIT_HELD_BELOW_MIN,不记账(缺口本身——admin 绕过 applyKytApproved/checkAutoApproval 直接 PATCH 状态接口时曾完整复现漏洞)', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-admin-below-min',
        depositNo: 'DEP-ADMIN-BM-001',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        limitHoldReason: 'BELOW_MIN',
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: 'tr-admin-1',
        amount: '5',
      });
      const executeAccountingSpy = jest.spyOn(service as any, 'executeDepositAccounting');

      await service.approveDeposit('dep-admin-below-min');

      // 转 OPERATION_PENDING,不是 APPROVE
      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'dep-admin-below-min',
        expect.objectContaining({ action: DepositTransactionAction.OPERATION_PENDING }),
        expect.anything(),
      );
      expect(depositService.updateStatus).not.toHaveBeenCalledWith(
        'dep-admin-below-min',
        { action: DepositTransactionAction.APPROVE },
      );
      // 写 DEPOSIT_HELD_BELOW_MIN 审计,不写 DEPOSIT_APPROVED/DEPOSIT_COMPLETED
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.DEPOSIT_HELD_BELOW_MIN }),
      );
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.DEPOSIT_APPROVED }),
      );
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.DEPOSIT_COMPLETED }),
      );
      // 不记账:资金层完全没被碰
      expect(fundsOrders.findByParent).not.toHaveBeenCalled();
      expect(executeAccountingSpy).not.toHaveBeenCalled();
    });

    it('直调 approveDeposit 于 limitHoldReason=null 单 → 照常入账走 SUCCESS(防止把正常路径改坏)', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-admin-ok',
        depositNo: 'DEP-ADMIN-OK-001',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        limitHoldReason: null,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: 'tr-admin-2',
        amount: '500',
        asset: { currency: 'USDT', tbLedgerId: 2, decimals: 6 },
      });

      await service.approveDeposit('dep-admin-ok');

      expect(depositService.updateStatus).toHaveBeenCalledWith('dep-admin-ok', {
        action: DepositTransactionAction.APPROVE,
      });
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.DEPOSIT_APPROVED }),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.DEPOSIT_COMPLETED }),
      );
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.DEPOSIT_HELD_BELOW_MIN }),
      );
    });

    // 终审"顺带"项:此前注释宣称"已在 OPERATION_PENDING 的单再次进来会被转移表拒掉
    // → fails safe",但表现其实是转移表抛 BadRequestException('Invalid action
    // operation_pending for status OPERATION_PENDING')——语义上没漏钱,但不是干净的
    // no-op,重复点①就能触发。改成显式 no-op(早退 + debug 日志),不再让它掉进
    // holdBelowMinIfNeeded 去撞转移表。
    it('顺带修复:重复 approve 于仍持有 BELOW_MIN 挂起的 OPERATION_PENDING 单 → 显式 no-op,不再落入金额闸重复尝试 operation_pending 动作', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-repeat-1',
        depositNo: 'DEP-REPEAT-001',
        status: DepositTransactionStatus.OPERATION_PENDING,
        limitHoldReason: 'BELOW_MIN',
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: 'tr-repeat-1',
        amount: '5',
      });

      await expect(service.approveDeposit('dep-repeat-1')).resolves.toBeUndefined();

      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
    });

    // B4 §3 的连带闸:上面那条 no-op 此前硬钉 limitHoldReason === 'BELOW_MIN'。
    // Gate 0 开始往 OPERATION_PENDING 上落**非** BELOW_MIN 的挂起原因之后，这个
    // 判据就变得不够宽 —— 一笔被行政级挂起的单,PATCH :id/status {action:approve}
    // 会径直穿过金额闸(它只认 BELOW_MIN,返回 false)落 SUCCESS,而 limitHoldReason
    // 还挂着 → 客户面三处判据(limitHoldReason != null 即隐藏)让这笔已入账的单
    // 对客户永久不可见。挂起未解除时 approve 一律 no-op,解除走 waive。
    it('B4 §3:approve 于仍持有**行政级**挂起的 OPERATION_PENDING 单 → 同样 no-op,不得带着挂起原因入账', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-repeat-2',
        depositNo: 'DEP-REPEAT-002',
        status: DepositTransactionStatus.OPERATION_PENDING,
        limitHoldReason: 'CAPABILITY_RESTRICTED',
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: 'tr-repeat-2',
        amount: '500',
      });

      await expect(service.approveDeposit('dep-repeat-2')).resolves.toBeUndefined();

      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
    });
  });

  describe('waiveLimitHold', () => {
    const adminActor = { actorId: 'admin-1', actorRole: 'OPERATOR' };
    const baseDeposit = (overrides: Record<string, unknown> = {}) => ({
      id: 'dep-1',
      depositNo: 'DEP001',
      // Task 7: a BELOW_MIN hold now lives on OPERATION_PENDING deposits (compliance
      // already passed before the amount gate runs — Task 6's reversal).
      status: DepositTransactionStatus.OPERATION_PENDING,
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

    // Task 7: 没收/放行入口条件从 COMPLIANCE_PENDING 上移到 OPERATION_PENDING(Task 5
    // 已把该边从转移表挪走)。waiveLimitHold 现在只认 OPERATION_PENDING;COMPLIANCE_PENDING
    // (旧入口)必须拒绝,否则会在真实调用中撞上转移表的 'Invalid action'。
    it('waiveLimitHold 只接受 OPERATION_PENDING,COMPLIANCE_PENDING 拒绝', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'd1', limitHoldReason: 'BELOW_MIN',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
      });
      await expect(service.waiveLimitHold('d1', { actorId: 'a1' })).rejects.toThrow(
        // B4：文案随「放宽到任何非空挂起原因」一起从 BELOW_MIN 收窄措辞改成中性。
        /no hold to release/,
      );

      depositService.findOne.mockResolvedValue({
        id: 'd1', depositNo: 'DEP-1', limitHoldReason: 'BELOW_MIN',
        status: DepositTransactionStatus.OPERATION_PENDING,
        ownerType: 'CUSTOMER', ownerId: 'c1',
      });
      // waiveLimitHold has no explicit return (always resolves void) — the meaningful
      // assertion is that it resolves at all (no BadRequestException) rather than a
      // truthy return value, so toBeUndefined() over the brief's literal toBeDefined().
      await expect(service.waiveLimitHold('d1', { actorId: 'a1' })).resolves.toBeUndefined();
      expect(depositService.clearLimitHold).toHaveBeenCalledWith('d1');
    });

    it('waiveLimitHold: KYT 已 approved 的单,豁免后应放行', async () => {
      const dep = {
        id: 'dep-w1', depositNo: 'DEPW1', status: DepositTransactionStatus.OPERATION_PENDING,
        limitHoldReason: 'BELOW_MIN', sumsubVerdict: 'approved', ownerType: 'FIRM', ownerId: 'firm-1', traceId: null,
      };
      // waiveLimitHold's own findOne sees the still-held deposit (to validate the waive);
      // checkAutoApproval's re-fetch afterwards must see clearLimitHold's write already
      // landed (real DB semantics) — a single static mock would wrongly re-trip the
      // BELOW_MIN gate inside checkAutoApproval and mask the sumsubVerdict check entirely.
      depositService.findOne
        .mockResolvedValueOnce(dep)
        .mockResolvedValue({ ...dep, limitHoldReason: null });
      depositService.updateStatus.mockResolvedValue({ status: DepositTransactionStatus.SUCCESS });
      await service.waiveLimitHold('dep-w1', { actorId: 'admin-1' });
      expect(depositService.updateStatus).toHaveBeenCalledWith('dep-w1', { action: DepositTransactionAction.APPROVE });
    });

    it('waiveLimitHold: KYT 未 approved 的单,豁免后不放行', async () => {
      const dep = {
        id: 'dep-w2', depositNo: 'DEPW2', status: DepositTransactionStatus.OPERATION_PENDING,
        limitHoldReason: 'BELOW_MIN', sumsubVerdict: 'onHold', ownerType: 'FIRM', ownerId: 'firm-1', traceId: null,
      };
      depositService.findOne
        .mockResolvedValueOnce(dep)
        .mockResolvedValue({ ...dep, limitHoldReason: null });
      await service.waiveLimitHold('dep-w2', { actorId: 'admin-1' });
      expect(depositService.updateStatus).not.toHaveBeenCalledWith('dep-w2', { action: DepositTransactionAction.APPROVE });
    });

    // ── B4 §3：出场路径 ──────────────────────────────────────────────────────
    // Gate 0 的行政级挂起（CAPABILITY_RESTRICTED / LIFECYCLE_NOT_ACTIVE）落在
    // OPERATION_PENDING 上。若 waive 继续只认 BELOW_MIN，这类单**出场无路** ——
    // waive 拒、confiscate 拒（且没收本就不该给这类单用），钱压在 DEPOSIT_SUSPENSE
    // 里出不来。放宽到「任何非空挂起原因」。
    it('B4 §3：waive 接受 Gate 0 的行政级挂起（CAPABILITY_RESTRICTED）—— 这是这类单的出场路径', async () => {
      depositService.findOne.mockResolvedValue(
        baseDeposit({ limitHoldReason: 'CAPABILITY_RESTRICTED' }),
      );
      const reRun = jest.spyOn(service, 'checkAutoApproval').mockResolvedValue(undefined);

      await expect(service.waiveLimitHold('dep-1', adminActor)).resolves.toBeUndefined();

      expect(depositService.clearLimitHold).toHaveBeenCalledWith('dep-1');
      expect(reRun).toHaveBeenCalledWith('dep-1');
    });

    it('B4 §3：waive 接受 LIFECYCLE_NOT_ACTIVE 挂起', async () => {
      depositService.findOne.mockResolvedValue(
        baseDeposit({ limitHoldReason: 'LIFECYCLE_NOT_ACTIVE' }),
      );
      jest.spyOn(service, 'checkAutoApproval').mockResolvedValue(undefined);

      await expect(service.waiveLimitHold('dep-1', adminActor)).resolves.toBeUndefined();
      expect(depositService.clearLimitHold).toHaveBeenCalledWith('dep-1');
    });

    it('B4 §3：waive 审计把**实际**挂起原因带进 metadata（不新造审计动作常量）', async () => {
      depositService.findOne.mockResolvedValue(
        baseDeposit({ limitHoldReason: 'CAPABILITY_RESTRICTED' }),
      );
      jest.spyOn(service, 'checkAutoApproval').mockResolvedValue(undefined);

      await service.waiveLimitHold('dep-1', adminActor);

      expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEPOSIT_LIMIT_WAIVED',
          metadata: expect.objectContaining({ limitHoldReason: 'CAPABILITY_RESTRICTED' }),
        }),
        expect.anything(),
      );
    });

    it('B4 §3：挂起原因为空串同样拒（放宽的是"非 BELOW_MIN"，不是"没有挂起也能 waive"）', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit({ limitHoldReason: '' }));
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
      // Task 7: confiscation entry moved from COMPLIANCE_PENDING to OPERATION_PENDING
      // in lockstep with waiveLimitHold — see deposit-transactions.service.ts's
      // transition table (OPERATION_PENDING is the only status with a
      // CONFISCATE_START edge since Task 5).
      status: DepositTransactionStatus.OPERATION_PENDING,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      assetId: 'asset-1',
      amount: '5',
      traceId: 'trace-1',
      limitHoldReason: 'BELOW_MIN',
      ...overrides,
    });

    it('initiateConfiscation: below-min OPERATION_PENDING → creates approval, audits REQUESTED', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit({ limitHoldReason: 'BELOW_MIN', status: DepositTransactionStatus.OPERATION_PENDING }));
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

    // B4 §3：waive 放宽到「任何非空挂起原因」，没收**刻意不跟着放宽** —— 没收是
    // 「小额充值转公司收入」的专属处置（T&C handling fee），跟客户被停用/销户
    // 无关。给 Gate 0 的行政级挂起开没收，等于凭「这人账户被停了」把他的钱收进
    // 公司收入，那是新洞不是修洞。
    it('B4 §3：没收仍然只认 BELOW_MIN —— Gate 0 的行政级挂起（CAPABILITY_RESTRICTED）不得走没收', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit({ limitHoldReason: 'CAPABILITY_RESTRICTED' }));
      await expect(
        service.initiateConfiscation('dep-1', { reason: 'x' }, adminActor),
      ).rejects.toThrow(BadRequestException);
      expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
    });

    it('initiateConfiscation: rejects when an open confiscation approval already exists', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit({ limitHoldReason: 'BELOW_MIN', status: DepositTransactionStatus.OPERATION_PENDING }));
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

  // 第四批 C1：OPERATION_PENDING 是可退回状态之一 —— 运营看到 L1 挂起原因(如「客户
  // 账户已暂停」)时,除了放行/上缴/冻结之外必须有「把钱原路退回去」这条路。
  describe('C1 · OPERATION_PENDING 退回', () => {
    const actor = {
      actorType: 'ADMIN' as const,
      userId: 'admin-c1',
      userNo: 'ADM-C1',
      role: 'MLRO',
      roleCodes: ['MLRO'],
    };

    it('OPERATION_PENDING 的单可以开退回审批案', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'd1',
        depositNo: 'DEP001',
        status: DepositTransactionStatus.OPERATION_PENDING,
        fromAddress: 'TX-SENDER',
        fromIban: null,
        ownerType: 'CUSTOMER',
        ownerId: 'c1',
        assetId: 'asset-1',
        amount: '5',
        traceId: 'trace-c1',
      });
      approvalsService.list.mockResolvedValue({ total: 0, items: [] });
      approvalsService.createAndSubmit.mockResolvedValue({ id: 'app-c1', approvalNo: 'APR-C1' });

      await expect(
        service.initiateReturn('d1', { reason: '客户账户已暂停，原路退回' }, actor),
      ).resolves.toBeDefined();

      expect(approvalsService.createAndSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'DEPOSIT_RETURN', entityRef: 'd1' }),
        expect.anything(),
        expect.anything(),
      );
      // 退回是 maker-checker 审批案,不是直推 —— 点下去钱不会立刻退,状态不动。
      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('SUCCESS 的单不能开退回审批案', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'd2',
        depositNo: 'DEP002',
        status: DepositTransactionStatus.SUCCESS,
        fromAddress: 'TX-SENDER',
        fromIban: null,
        ownerType: 'CUSTOMER',
        ownerId: 'c1',
        assetId: 'asset-1',
        amount: '5',
        traceId: 'trace-c2',
      });

      await expect(
        service.initiateReturn('d2', { reason: 'x' }, actor),
      ).rejects.toThrow(/cannot open a return approval/i);
      expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
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
        { provide: CustomerAccessService, useValue: customerAccessService },
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
          { provide: DepositApplicantActionsService, useValue: actionsService },
          { provide: CustomerRestrictionsService, useValue: customerRestrictionsService },
          { provide: L1GateService, useValue: l1Gate },
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
        sceneTag: 'SANCTION_COUNTERPARTY',
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

    it('fix(deposit): FROZEN → approved verdict (e.g. a re-scored/late applicantKytTxnApproved after a sanctions veto) is blocked — no-op, DEPOSIT_KYT_VERDICT_IGNORED audit, deposit stays FROZEN, never reaches approveDeposit/TB', async () => {
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
      // 第一批 (2026-08-19)：FROZEN + 任意 verdict 一律判 IGNORE（含 approved，见
      // decideVerdictLanding），不再单独穿到 applyKytApproved 内部的专属守卫，
      // 统一走通用 DEPOSIT_KYT_VERDICT_IGNORED 审计（spec §2.2）。
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditActions.DEPOSIT_KYT_VERDICT_IGNORED,
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
      actionsService.hasOutstanding.mockResolvedValue(true); // 同步后仍有未提交行,正常推进(I1 guard)

      await service.applyKytVerdict('dep-3', { verdict: 'awaitUser', sceneTag: 'PEP' });

      // 2026-08-21 第三批：slaDeadline/slaBreached 不再由这里的 extraData 传——
      // 进入 ACTION_PENDING 时由 updateStatus 内部的 resolveSlaFields 统一算
      // (收口处),extraData 只带 manualReason + actionSubmittedAt 的清空。
      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'dep-3',
        expect.objectContaining({ action: DepositTransactionAction.ACTION_PENDING }),
        expect.objectContaining({
          extraData: {
            manualReason: 'EDD_PEP',
            actionSubmittedAt: null,
          },
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
      actionsService.hasOutstanding.mockResolvedValue(true); // 同步后仍有未提交行,正常推进(I1 guard)

      await service.applyKytVerdict('dep-3b', { verdict: 'awaitUser' });

      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'dep-3b',
        expect.objectContaining({ action: DepositTransactionAction.ACTION_PENDING }),
        expect.objectContaining({
          extraData: {
            manualReason: 'CLIENT_ACTION',
            actionSubmittedAt: null,
          },
        }),
      );
      expect(depositService.setSlaDeadline).not.toHaveBeenCalled();
    });

    // 2026-08-21 第三批：onHold 与 SLA 解绑（业主裁定「onHold 从来没表达过 SLA，
    // 跟它一点关系都没有」）。SLA 现在只按「状态」计时（进入 COMPLIANCE_PENDING
    // 时由收口处的 resolveSlaFields 设），onHold 回调不再触碰 slaDeadline。
    it('onHold 不改变 slaDeadline —— SLA 按状态计时,与 webhook 无关', async () => {
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

      // mock 化的 spec：没有真 prisma 行可比对 before/after,改用「setSlaDeadline
      // 压根没被调用」证明 —— 这是本方法此前改 slaDeadline 的唯一入口。
      expect(depositService.setSlaDeadline).not.toHaveBeenCalled();
      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('onHold 仍写 DEPOSIT_ONHOLD 审计', async () => {
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

      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.DEPOSIT_ONHOLD, entityId: 'dep-4' }),
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
      // Fix 1（终审 Important）：这个格子此前判定漏了 verdict，会先写证据（writeBackVerdict/
      // saveTxnDetail）再被 applyKytOnHold 自己的守卫静默 return —— 证据被换成迟到的
      // onHold/riskScore，但零审计、零报错。现在必须在写库前就判 IGNORE。
      expect(depositService.updateSumsubVerdict).not.toHaveBeenCalled();
      expect(depositService.saveTxnDetail).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.DEPOSIT_KYT_VERDICT_IGNORED, entityId: 'dep-4b' }),
      );
    });

    it('rejected + SANCTION_COUNTERPARTY (from COMPLIANCE_PENDING) → FROZEN, zero accounting', async () => {
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

      await service.applyKytVerdict('dep-5', { verdict: 'rejected', sceneTag: 'SANCTION_COUNTERPARTY' });

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
      // Task 5：对手方被制裁 ≠ 客户本人被制裁 —— 只冻这一单，绝不冻人。
      expect(customerRestrictionsService.open).not.toHaveBeenCalled();
    });

    it('rejected + SANCTION_APPLICANT (from COMPLIANCE_PENDING) → 先冻人(open cause=SANCTION)再冻单 FROZEN', async () => {
      const deposit = {
        id: 'dep-5b',
        depositNo: 'DEP005B',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-applicant-1',
        traceId: null,
      };
      depositService.findOne.mockResolvedValue(deposit);
      depositService.updateStatus.mockResolvedValue({
        ...deposit,
        status: DepositTransactionStatus.FROZEN,
      });

      await service.applyKytVerdict('dep-5b', { verdict: 'rejected', sceneTag: 'SANCTION_APPLICANT' });

      // 冻人：customerRestrictionsService.open() 必须以 cause: 'SANCTION' 被调用，
      // 且必须发生在 updateStatus(FREEZE) 之前（先冻人、再冻单，顺序 load-bearing）。
      // caseRef 会被 openWithin 顶成 customerNo（SANCTION 是客户级因由），真正承载
      // 「哪笔单牵出来的」取证线索的是 reason —— 必须钉住。
      expect(customerRestrictionsService.open).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'cust-applicant-1',
          cause: 'SANCTION',
          caseRef: 'DEP005B',
          reason: expect.stringContaining('DEP005B'),
        }),
      );
      const openOrder = customerRestrictionsService.open.mock.invocationCallOrder[0];
      const updateStatusOrder = depositService.updateStatus.mock.invocationCallOrder[0];
      expect(openOrder).toBeLessThan(updateStatusOrder);

      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'dep-5b',
        expect.objectContaining({ action: DepositTransactionAction.FREEZE }),
        expect.anything(),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_FROZEN' }),
      );
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
        expect.objectContaining({ action: DepositTransactionAction.KYT_REJECTED }),
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

      await service.applyKytVerdict('dep-9', { verdict: 'rejected', sceneTag: 'SANCTION_COUNTERPARTY' });

      expect(depositService.updateStatus).not.toHaveBeenCalled();
      // A5(2026-08-13):忽略 ≠ 静默——状态机一步不动,但要留一条 IGNORED 标记。
      // 断言口径保持原意「不写任何业务审计」:唯一一条必须是 IGNORED 标记本身。
      expect(auditLogsService.recordSystem).toHaveBeenCalledTimes(1);
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_KYT_VERDICT_IGNORED' }),
      );
    });

    it('no-op when already FROZEN and a duplicate rejected+SANCTION_COUNTERPARTY webhook arrives', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-10',
        depositNo: 'DEP010',
        status: DepositTransactionStatus.FROZEN,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: null,
      });

      await service.applyKytVerdict('dep-10', { verdict: 'rejected', sceneTag: 'SANCTION_COUNTERPARTY' });

      expect(depositService.updateStatus).not.toHaveBeenCalled();
      // 第一批 (2026-08-19)：FROZEN 现在判 IGNORE，忽略 ≠ 静默 —— 状态不动但要留痕。
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.DEPOSIT_KYT_VERDICT_IGNORED }),
      );
    });

    // ── 终审必修 (2026-08-20)：FROZEN 单撞上迟到的 SANCTION_APPLICANT 裁决 ─────
    // 失败场景:客户因 ADMIN_SUSPENSION(等级升级被拒/补料周期终止/admin 手工停用,
    // scope=['ALL'] 广播)被摁住 → 本域 onCustomerRestrictionOpened 把这笔在途单
    // 冻成 FROZEN → 该单自己的 SANCTION_APPLICANT 裁决随后到达 → decideVerdictLanding
    // 对 FROZEN 一律判 IGNORE → 修复前直接 return,制裁命中被整条丢弃:人不被冻,
    // 运营解除 ADMIN_SUSPENSION 便签后客户完全自由。
    it('FROZEN 单 + 迟到 SANCTION_APPLICANT 裁决 → 仍冻人(open cause=SANCTION)+ 写审计,单据状态不变(不推动状态机)', async () => {
      const deposit = {
        id: 'dep-sanction-frozen',
        depositNo: 'DEP-SANCTION-FROZEN',
        status: DepositTransactionStatus.FROZEN,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-frozen-applicant',
        traceId: null,
      };
      depositService.findOne.mockResolvedValue(deposit);

      await service.applyKytVerdict('dep-sanction-frozen', {
        verdict: 'rejected',
        sceneTag: 'SANCTION_APPLICANT',
      });

      // 冻人:customerRestrictionsService.open() 必须以 cause: 'SANCTION' 被调用,
      // 即便单据本身早已是 FROZEN、状态机这一步完全不动。
      expect(customerRestrictionsService.open).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'cust-frozen-applicant',
          cause: 'SANCTION',
          caseRef: 'DEP-SANCTION-FROZEN',
          reason: expect.stringContaining('DEP-SANCTION-FROZEN'),
        }),
      );

      // 写审计:MLRO 要能查到"虽然单子没动,但人被冻了"。
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditActions.DEPOSIT_SANCTION_HIT_ON_IGNORED_VERDICT,
          entityNo: 'DEP-SANCTION-FROZEN',
        }),
      );

      // 「判定先于写库」不变量必须保住:单子本来就该留在 FROZEN,不推动状态机。
      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(deposit.status).toBe(DepositTransactionStatus.FROZEN);
    });

    it('FROZEN 单 + 迟到 SANCTION_COUNTERPARTY 裁决 → 不冻人(对手方命中,只冻单,单早已 FROZEN)', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-counterparty-frozen',
        depositNo: 'DEP-COUNTERPARTY-FROZEN',
        status: DepositTransactionStatus.FROZEN,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: null,
      });

      await service.applyKytVerdict('dep-counterparty-frozen', {
        verdict: 'rejected',
        sceneTag: 'SANCTION_COUNTERPARTY',
      });

      expect(customerRestrictionsService.open).not.toHaveBeenCalled();
      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.DEPOSIT_SANCTION_HIT_ON_IGNORED_VERDICT }),
      );
    });

    it('FROZEN 单 + 迟到普通 rejected(无 sceneTag)→ 不冻人', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-plain-frozen',
        depositNo: 'DEP-PLAIN-FROZEN',
        status: DepositTransactionStatus.FROZEN,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: null,
      });

      await service.applyKytVerdict('dep-plain-frozen', { verdict: 'rejected' });

      expect(customerRestrictionsService.open).not.toHaveBeenCalled();
      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.DEPOSIT_SANCTION_HIT_ON_IGNORED_VERDICT }),
      );
    });

    it('recordVerdictIgnored 的 metadata 里能查到 sceneTag(取证链不再断)', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-metadata-frozen',
        depositNo: 'DEP-METADATA-FROZEN',
        status: DepositTransactionStatus.FROZEN,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-metadata',
        traceId: null,
      });

      await service.applyKytVerdict('dep-metadata-frozen', {
        verdict: 'rejected',
        sceneTag: 'SANCTION_APPLICANT',
      });

      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditActions.DEPOSIT_KYT_VERDICT_IGNORED,
          metadata: expect.objectContaining({ sceneTag: 'SANCTION_APPLICANT' }),
        }),
      );
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
      actionsService.hasOutstanding.mockResolvedValue(true); // 客户仍有未提交行,不是 I1 那种死角

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
      // A5:RETURNING 已进 IGNORED 集合,在 applyKytVerdict 入口就早退(此前是走到
      // applyKytRejected 里的 `status === RETURNING` 防重闸)。净效果同样是状态机不动,
      // 但现在多一条 IGNORED 标记,且**不再先覆写闸门字段/存证**——这正是 A5 要修的。
      expect(auditLogsService.recordSystem).toHaveBeenCalledTimes(1);
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_KYT_VERDICT_IGNORED' }),
      );
    });

    // ── A5 (2026-08-13): 在途处置态收到迟到裁决,证据必须一个字不动 ─────────────
    // 修复前:CONFISCATING/RETURNING/SEIZING 不在忽略集合里 → 先 writeBackVerdict +
    // saveTxnDetail 把原制裁裁决/风险分/原始报文整份覆盖,然后才因为状态机没边而抛错。
    // 最隐蔽的是"迟到的 approved":它连错都不报,静默把上缴中订单的裁决改成通过。
    it.each([
      DepositTransactionStatus.SEIZING,
      DepositTransactionStatus.RETURNING,
      DepositTransactionStatus.CONFISCATING,
    ])('A5: %s 收到迟到 approved → 不覆写裁决/存证 + IGNORED 审计 + 不抛', async (status) => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-a5',
        depositNo: 'DEPA5',
        status,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: null,
        sumsubVerdict: 'rejected',
        sumsubScore: 98,
      });

      await expect(
        service.applyKytVerdict('dep-a5', { verdict: 'approved', riskScore: 5 }),
      ).resolves.toBeUndefined();

      // 关键:原裁决(rejected/98)不能被 approved/5 盖掉
      expect(depositService.updateSumsubVerdict).not.toHaveBeenCalled();
      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_KYT_VERDICT_IGNORED' }),
      );
    });

    // ── 第一批 (2026-08-19): FROZEN 下没有任何 verdict 能合法推动状态机 ─────────
    // 修复前 approvedWillNoOpFrozen 只挡 approved，一条迟到的 onHold 会先把
    // 制裁裁决/风险分/原始报文整份覆盖，然后才因状态守卫静默 no-op —— 零报错、
    // 零审计。这是"先写后判"正在流血的口子。
    it.each(['onHold', 'awaitUser', 'rejected'] as const)(
      'B1: FROZEN 收到迟到 %s → 不覆写裁决/存证 + IGNORED 审计 + 不抛',
      async (verdict) => {
        depositService.findOne.mockResolvedValue({
          id: 'dep-b1',
          depositNo: 'DEPB1',
          status: DepositTransactionStatus.FROZEN,
          ownerType: 'CUSTOMER',
          ownerId: 'cust-1',
          traceId: null,
        });

        await expect(
          service.applyKytVerdict('dep-b1', {
            verdict,
            riskScore: 50,
            detailRaw: { late: true },
          }),
        ).resolves.toBeUndefined();

        expect(depositService.updateSumsubVerdict).not.toHaveBeenCalled();
        expect(depositService.saveTxnDetail).not.toHaveBeenCalled();
        expect(depositService.updateStatus).not.toHaveBeenCalled();
        expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
          expect.objectContaining({
            action: AuditActions.DEPOSIT_KYT_VERDICT_IGNORED,
            entityNo: 'DEPB1',
          }),
        );
      },
    );

    it('B1: 审计写失败不得把 no-op 裁决变成异常（.catch 是 load-bearing）', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-b1b',
        depositNo: 'DEPB1B',
        status: DepositTransactionStatus.SUCCESS,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: null,
      });
      auditLogsService.recordSystem.mockRejectedValueOnce(new Error('audit down'));

      await expect(
        service.applyKytVerdict('dep-b1b', { verdict: 'rejected' }),
      ).resolves.toBeUndefined();
    });

    // ── A2 (2026-08-13): 退回着陆垫 ────────────────────────────────────────────
    // 合规官最标准的操作是「一边打 RETURN_TO_SENDER tag 一边驳回」,此刻单子还在
    // COMPLIANCE_PENDING。修复前 initiateReturn 直接抛 BadRequestException(本方法只
    // catch ConflictException)→ 一路上抛 → webhook 三次重试进死信:不开审批、不流转、
    // 不记审计,界面上"点了没反应",钱一直压在 DEPOSIT_SUSPENSE 里。
    it.each([
      DepositTransactionStatus.COMPLIANCE_PENDING,
      DepositTransactionStatus.ACTION_PENDING,
    ])('A2: %s 收到 RETURN_TO_SENDER tag → 落 MANUAL_CHECKING(tag 进 reason) 不抛', async (status) => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-a2',
        depositNo: 'DEPA2',
        status,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: null,
      });

      await expect(
        service.applyKytVerdict('dep-a2', { verdict: 'rejected', dispoTag: 'RETURN_TO_SENDER' }),
      ).resolves.toBeUndefined();

      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'dep-a2',
        expect.objectContaining({
          action: DepositTransactionAction.KYT_REJECTED,
          // tag 必须留在 reason 里,合规官才能从人工复核队列里重驱这笔退回
          reason: expect.stringContaining('RETURN_TO_SENDER'),
        }),
        expect.anything(),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_MANUAL_CHECKING' }),
      );
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
      // Task 7: onConfiscationDecided's drift guard now requires OPERATION_PENDING
      // (confiscation entry moved off COMPLIANCE_PENDING with the CONFISCATE_START
      // edge in Task 5's transition table).
      status: DepositTransactionStatus.OPERATION_PENDING,
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
        // leg1: DEPOSIT_SUSPENSE, CLIENT_ASSET ; leg2: FIRM_ASSET, INCOME_OTHER
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
        { provide: CustomerAccessService, useValue: customerAccessService },
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
          { provide: DepositApplicantActionsService, useValue: actionsService },
          { provide: CustomerRestrictionsService, useValue: customerRestrictionsService },
          { provide: L1GateService, useValue: l1Gate },
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

      // Leg 2 (pending): DR FIRM_ASSET(SYSTEM) / CR INCOME_OTHER(SYSTEM)
      expect(accountingService.resolveTbAccountId).toHaveBeenNthCalledWith(3, {
        code: TB_ACCOUNT_CODES.FIRM_ASSET, ledger: 2, ownerType: 'SYSTEM',
      });
      expect(accountingService.resolveTbAccountId).toHaveBeenNthCalledWith(4, {
        code: TB_ACCOUNT_CODES.INCOME_OTHER, ledger: 2, ownerType: 'SYSTEM',
      });
      expect(accountingService.executePendingTransfer).toHaveBeenNthCalledWith(2,
        expect.objectContaining({
          debitAccountId: 'tb-firm-asset',
          creditAccountId: 'tb-firm-fee',
          code: TB_TRANSFER_CODES.DEPOSIT_CONFISCATE_INCOME_OTHER,
          timeout: 0,
          legIndex: 1,
          evidence: expect.objectContaining({
            eventCode: 'CONFISCATE_INCOME_OTHER',
            debitCode: 'A.FIRM_ASSET',
            creditCode: 'E.INCOME_OTHER',
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
    // the deposit, so a concurrent waiveLimitHold→approve (SUCCESS) can drift it out of
    // the confiscable state while the approval is PENDING (状态机收窄后 REJECT/adminReject
    // 已删除,OPERATION_PENDING 唯二出边只剩 approve/confiscate_start,SUCCESS 是仅有的
    // 漂移目标). The APPROVED decided event must then post NOTHING (else CLIENT_ASSET is
    // zeroed while CLIENT_PAYABLE still owes the now-credited customer → phantom liability).
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
      voidPendingTransfer: jest.Mock;
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
        voidPendingTransfer: jest.fn().mockResolvedValue(undefined),
      };
      depositService.updateStatus.mockResolvedValue({});

      const module: TestingModule = await Test.createTestingModule({
        providers: [
        { provide: CustomerAccessService, useValue: customerAccessService },
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
          { provide: DepositApplicantActionsService, useValue: actionsService },
          { provide: CustomerRestrictionsService, useValue: customerRestrictionsService },
          { provide: L1GateService, useValue: l1Gate },
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

      await (service as any).settleConfiscation(dep, 'fo2', 1);

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

    // ── A1 (2026-08-13): 没收腿 FAILED/TIMEOUT 此前掉地上 ──────────────────────
    // 旧代码 `if (newStatus !== CONFIRMED) return` 把这两个信号一起吃掉,deposit 永停
    // CONFISCATING、两笔 pending 锁永不释放,且四条恢复路径全堵(资金单已终态不再发事件 /
    // CONFISCATING 只有 settle 一条出边 / ADMIN_API 被 ACCOUNTING_TERMINALS 挡 / 无重结算
    // 入口)。而 admin 资金单详情页的 ⚡失败/⚡超时 红按钮对没收腿照常渲染 —— 一点即死。
    // A3(2026-08-22)改写:A1 那版「一次失败就退回 OPERATION_PENDING」已退役 ——
    // 现在 FAILED/TIMEOUT 走重试三级梯,attempt 1 只 void + 重建 attempt 2,状态一步不动。
    it.each(['FAILED', 'TIMEOUT'])(
      'A3: legSeq2 %s (attempt 1) → voids BOTH pending legs → 重建 attempt 2,状态一步不动',
      async (legStatus) => {
        depositService.findOne.mockResolvedValue(baseDeposit({ status: 'CONFISCATING' }));
        fundsOrders.create.mockResolvedValue({ fundsOrderNo: 'FO-CF-2R' });

        await service.handleFundsOrderChanged(legEvent({ newStatus: legStatus, attempt: 1 }) as any);

        // 两笔 pending 都要解锁——只解一笔等于钱还锁着一半
        expect(accountingService.voidPendingTransfer).toHaveBeenCalledTimes(2);
        expect(accountingService.postPendingTransfer).not.toHaveBeenCalled();
        // 重建:新腿 attempt 2 + 两笔新 pending(legIndex 2)
        expect(fundsOrders.create).toHaveBeenCalledWith(
          expect.objectContaining({ legSeq: 2, attempt: 2 }),
        );
        expect(accountingService.executePendingTransfer).toHaveBeenCalledTimes(2);
        expect(
          accountingService.executePendingTransfer.mock.calls.map((c: any[]) => c[0].legIndex),
        ).toEqual([2, 2]);
        expect(depositService.updateStatus).not.toHaveBeenCalled();
        expect(depositService.markNeedsReview).not.toHaveBeenCalled();
        expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'DEPOSIT_CONFISCATION_RETRIED' }),
        );
      },
    );

    it('A3: void 的 pending id 必须与 pendConfiscationLegs 本次 attempt 逐字一致(两笔 eventCode 各一)', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit({ status: 'CONFISCATING' }));
      fundsOrders.create.mockResolvedValue({ fundsOrderNo: 'FO-CF-2R' });

      await service.handleFundsOrderChanged(legEvent({ newStatus: 'FAILED' }) as any);

      const eventCodes = accountingService.voidPendingTransfer.mock.calls.map(
        (c: any[]) => c[0].evidence.eventCode,
      );
      expect(eventCodes).toEqual([
        'CONFISCATE_REVERSE_SUSPENSE_VOID',
        'CONFISCATE_INCOME_OTHER_VOID',
      ]);
      // pending id 由 eventCode + legIndex(=attempt) 决定,同 attempt 下两笔必须不同
      const pendingIds = accountingService.voidPendingTransfer.mock.calls.map(
        (c: any[]) => c[0].pendingTransferId,
      );
      expect(pendingIds[0]).not.toEqual(pendingIds[1]);
    });

    it('A3: void 抛错 → 不上抛(@OnEvent 里没人接) + 留 CONFISCATING + 红标 + UNLOCK_FAILED 审计', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit({ status: 'CONFISCATING' }));
      accountingService.voidPendingTransfer.mockRejectedValue(new Error('TB unreachable'));

      await expect(
        service.handleFundsOrderChanged(legEvent({ newStatus: 'FAILED' }) as any),
      ).resolves.toBeUndefined();

      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(depositService.markNeedsReview).toHaveBeenCalledWith('dep-1');
      expect(fundsOrders.create).not.toHaveBeenCalled(); // 没走到重建那步
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_CONFISCATION_UNLOCK_FAILED' }),
      );
    });

    // 资金安全线:重建后的 attempt 2 结算,必须 post attempt 2 的 pending id ——
    // 写死 1 会 post 到上一 attempt 已 void 的 id 上(post 恒失败 → 单子卡死 CONFISCATING,
    // 而 attempt 2 的两笔 pending 还锁着)。settleReturn/settleSeize 同样收 event.attempt。
    it('A3: attempt 2 的腿 CONFIRMED → post 的是 attempt 2 的 pending id(不是 attempt 1 的)', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit({ status: 'CONFISCATING' }));

      await service.handleFundsOrderChanged(legEvent({ newStatus: 'CONFIRMED', attempt: 2 }) as any);
      const attempt2Ids = accountingService.postPendingTransfer.mock.calls.map(
        (c: any[]) => c[0].pendingTransferId,
      );

      accountingService.postPendingTransfer.mockClear();
      await service.handleFundsOrderChanged(legEvent({ newStatus: 'CONFIRMED', attempt: 1 }) as any);
      const attempt1Ids = accountingService.postPendingTransfer.mock.calls.map(
        (c: any[]) => c[0].pendingTransferId,
      );

      expect(attempt2Ids).toHaveLength(2);
      expect(attempt1Ids).toHaveLength(2);
      expect(attempt2Ids[0]).not.toEqual(attempt1Ids[0]);
      expect(attempt2Ids[1]).not.toEqual(attempt1Ids[1]);
    });

    describe('A3 · 没收腿重试', () => {
      const deposit = {
        id: 'd3', depositNo: 'DEP003', ownerType: 'CUSTOMER', ownerId: 'c1',
        assetId: 'a1', traceId: 't3', amount: '100', toWalletId: 'w1',
        asset: { decimals: 2, currency: 'AED', tbLedgerId: 1 },
        status: 'CONFISCATING',
      };

      it('第 1 次失败 → 重建 attempt 2,不推状态、不置红标', async () => {
        accountingService.voidPendingTransfer.mockResolvedValue(undefined);
        accountingService.resolveTbAccountId.mockResolvedValue(1n);
        accountingService.executePendingTransfer.mockResolvedValue(undefined);
        fundsOrders.create.mockResolvedValue({ fundsOrderNo: 'FO-C2' });

        await (service as any).onConfiscationLegFailed(deposit, 'fo1', 'FAILED', 1);

        expect(fundsOrders.create).toHaveBeenCalled();
        expect(depositService.updateStatus).not.toHaveBeenCalled();
        expect(depositService.markNeedsReview).not.toHaveBeenCalled();
        // 自证型绿灯防线:显式钉住走的是 RETRIED 分支,而不是 catch 里的 UNLOCK_FAILED。
        expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
          expect.objectContaining({ action: AuditActions.DEPOSIT_CONFISCATION_RETRIED }),
        );
      });

      it('第 3 次失败 → 置红标 + STUCK 审计,状态留在 CONFISCATING', async () => {
        accountingService.voidPendingTransfer.mockResolvedValue(undefined);

        await (service as any).onConfiscationLegFailed(deposit, 'fo1', 'TIMEOUT', 3);

        expect(depositService.markNeedsReview).toHaveBeenCalledWith('d3');
        expect(depositService.updateStatus).not.toHaveBeenCalled();
        expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
          expect.objectContaining({ action: AuditActions.DEPOSIT_CONFISCATION_STUCK }),
        );
        expect(fundsOrders.create).not.toHaveBeenCalled(); // 耗尽后不再重建

        // 资金安全线:void 的两笔 pending id 必须精确等于本次 attempt(=3)推导出的
        // deterministicTransferId,不能是写死的 attempt 1 —— 否则 voidPendingTransfer
        // 会撞上 attempt 1 早已 void 过的 id,被 accounting.service 的
        // pending_transfer_already_voided 豁免吞掉(不抛/不落审计/不置红标),
        // attempt 3 真正的两笔 pending 永久锁死、全程静默。
        const voidedIds = accountingService.voidPendingTransfer.mock.calls.map(
          (c: any[]) => c[0].pendingTransferId,
        );
        expect(voidedIds).toEqual([
          deterministicTransferId('DEPOSIT', 'DEP003', 'CONFISCATE_REVERSE_SUSPENSE', 3),
          deterministicTransferId('DEPOSIT', 'DEP003', 'CONFISCATE_INCOME_OTHER', 3),
        ]);
      });
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
        { provide: CustomerAccessService, useValue: customerAccessService },
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
          { provide: DepositApplicantActionsService, useValue: actionsService },
          { provide: CustomerRestrictionsService, useValue: customerRestrictionsService },
          { provide: L1GateService, useValue: l1Gate },
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

    // 第四批 C1 第二处守卫：initiateReturn 放宽了却漏改这里的话,审批批准了但落地被
    // 拒 —— 单子卡在「审批已通过、状态没动」的残局。
    it('C1: OPERATION_PENDING 的单批准后同样落地(legSeq 3 + RETURNING)', async () => {
      const dep = returnableDeposit({ status: DepositTransactionStatus.OPERATION_PENDING });

      await (service as any).onReturnApproved(dep);

      expect(fundsOrders.create).toHaveBeenCalledWith(
        expect.objectContaining({ depositTransactionId: 'dep-rt-1', legSeq: 3 }),
      );
      expect(accountingService.executePendingTransfer).toHaveBeenCalledTimes(1);
      expect(depositService.updateStatus).toHaveBeenCalledWith('dep-rt-1',
        expect.objectContaining({ action: DepositTransactionAction.RETURN }),
      );
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
        { provide: CustomerAccessService, useValue: customerAccessService },
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
          { provide: DepositApplicantActionsService, useValue: actionsService },
          { provide: CustomerRestrictionsService, useValue: customerRestrictionsService },
          { provide: L1GateService, useValue: l1Gate },
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

    // A2（第四批）：重试三级梯耗尽后原地不动 + 置 needsReview 红标 —— 靠红标让运营
    // 看见「卡住了」，而不是新起一个状态。onSeizeLegFailed 的用例也放在这里，因为
    // 它需要同一份带 voidPendingTransfer 的 accountingService mock（本 describe 的
    // beforeEach 已经建好），两条弧各改各的实现，测试没必要各建一套模块。
    describe('A2 · 处置腿卡死置红标', () => {
      it('退回腿第 3 次仍失败 → 写 STUCK 审计并置 needsReview,状态一步不动', async () => {
        const deposit = {
          id: 'd1', depositNo: 'DEP001', ownerType: 'CUSTOMER', ownerId: 'c1',
          traceId: 't1', amount: '100', asset: { decimals: 2, currency: 'AED' },
          status: 'RETURNING',
        };
        accountingService.voidPendingTransfer.mockResolvedValue(undefined);

        await (service as any).onReturnLegFailed(deposit, 'fo1', 3);

        expect(depositService.markNeedsReview).toHaveBeenCalledWith('d1');
        expect(depositService.updateStatus).not.toHaveBeenCalled();
        expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
          expect.objectContaining({ action: AuditActions.DEPOSIT_RETURN_STUCK }),
        );
      });

      it('退回腿第 1 次失败 → 重建 attempt 2,不置红标', async () => {
        const deposit = {
          id: 'd1', depositNo: 'DEP001', ownerType: 'CUSTOMER', ownerId: 'c1',
          // brief 原始 fixture 缺 tbLedgerId —— pendReturnSuspense 会因此在重建分支里
          // 抛 "Asset AED has no tbLedgerId",落进 catch 崩溃分支而非真正走通重试路径,
          // 断言又恰好在两条分支下都成立,变成一次自证型绿灯（本轮改动前跑过,实测
          // 命中的是 DEPOSIT_RETURN_STUCK,不是 RETRIED）。补上 tbLedgerId 让它真正
          // 走通重试路径,并显式断言 RETRIED 审计,堵死这个假绿灯口子。
          traceId: 't1', amount: '100', asset: { decimals: 2, currency: 'AED', tbLedgerId: 2 },
          status: 'RETURNING',
        };
        accountingService.voidPendingTransfer.mockResolvedValue(undefined);
        fundsOrders.create.mockResolvedValue({ fundsOrderNo: 'FO2' });

        await (service as any).onReturnLegFailed(deposit, 'fo1', 1);

        expect(depositService.markNeedsReview).not.toHaveBeenCalled();
        expect(fundsOrders.create).toHaveBeenCalled();
        expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
          expect.objectContaining({ action: AuditActions.DEPOSIT_RETURN_RETRIED }),
        );
      });

      it('上缴腿第 3 次仍失败 → 置 needsReview,状态一步不动', async () => {
        const deposit = {
          id: 'd2', depositNo: 'DEP002', ownerType: 'CUSTOMER', ownerId: 'c1',
          traceId: 't2', amount: '100', asset: { decimals: 2, currency: 'AED' },
          status: 'SEIZING',
        };
        accountingService.voidPendingTransfer.mockResolvedValue(undefined);

        await (service as any).onSeizeLegFailed(deposit, 'fo9', 3);

        expect(depositService.markNeedsReview).toHaveBeenCalledWith('d2');
        expect(depositService.updateStatus).not.toHaveBeenCalled();
      });
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
        { provide: CustomerAccessService, useValue: customerAccessService },
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
          { provide: DepositApplicantActionsService, useValue: actionsService },
          { provide: CustomerRestrictionsService, useValue: customerRestrictionsService },
          { provide: L1GateService, useValue: l1Gate },
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
        { provide: CustomerAccessService, useValue: customerAccessService },
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
          { provide: DepositApplicantActionsService, useValue: actionsService },
          { provide: CustomerRestrictionsService, useValue: customerRestrictionsService },
          { provide: L1GateService, useValue: l1Gate },
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

    // 2026-08-02 真机发现:FO2608024242(legSeq=4 上缴腿)记账已 POSTED、充值单已 SEIZED,
    // 资金单却永远停在 CONFIRMED。根因是充值域里 FundsOrderAction.CLEAR 只在 payin 确认
    // 那一处被调用,三个处置腿的 settle 都只做「记账 + 业务状态 + 审计」,漏了资金单收口。
    // 守则闸：不针对某一条弧，而是断言「每个 settle*() 都调了 clearDispositionLeg」。
    // 三条处置弧由 C3/A3/A4 三轮分别实现、三次漏同一处，说明这不是手误而是职责边界问题——
    // 所以这里守的是**规则**而非**实例**：将来新增第四条处置弧，若忘了收口资金单，本条即红。
    it('守则：所有 settle*() 结算成功后都必须收口资金单（新增处置弧的防漏闸）', async () => {
      const source = require('fs').readFileSync(
        require('path').join(__dirname, 'deposit-workflow.service.ts'),
        'utf8',
      );
      const settlers = [...source.matchAll(/private async (settle\w+)\s*\(/g)].map((m) => m[1]);
      expect(settlers.length).toBeGreaterThanOrEqual(3); // 没收/退回/上缴

      for (const name of settlers) {
        const body = source.slice(
          source.indexOf(`private async ${name}(`),
          source.indexOf('\n  private async ', source.indexOf(`private async ${name}(`) + 10),
        );
        expect({ settler: name, clearsLeg: body.includes('clearDispositionLeg(') }).toEqual({
          settler: name,
          clearsLeg: true,
        });
      }
    });

    it('settle 成功后必须把处置腿收口到 CLEARED（真机回归闸）', async () => {
      const dep = baseDeposit();

      await (service as any).settleSeize(dep, 'fo-sz-2', 1);

      expect(fundsOrders.advance).toHaveBeenCalledWith('fo-sz-2', FundsOrderAction.CLEAR, 'SYSTEM');
    });

    it('资金单已 CLEARED 时视为幂等成功，不把 settle 拖垮', async () => {
      const dep = baseDeposit();
      fundsOrders.advance.mockRejectedValueOnce(
        new Error('FundsOrder fo-sz-2 already terminal (CLEARED) — invalid transition'),
      );

      await expect((service as any).settleSeize(dep, 'fo-sz-2', 1)).resolves.toBeUndefined();

      // 记账与业务状态照常完成，且不会因为 CLEAR 失败而触发重试重跑
      expect(accountingService.postPendingTransfer).toHaveBeenCalledTimes(1);
      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'dep-sz-2',
        expect.objectContaining({ action: DepositTransactionAction.SEIZED_DONE }),
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
      sumsubTxnId: 'sumsub-txn-1',
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

    // Repro: deposit-workflow.service.ts:2452 used to gate on the deleted
    // `sumsubFinanceTxnId` column (schema now only has `sumsubTxnId`), so this
    // guard was always true in production and rescore silently never ran.
    it('FROZEN → resumes to COMPLIANCE_PENDING (RESUME), DEPOSIT_UNFROZEN audit with orderRef, rescores the sumsub txn once', async () => {
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
      expect(sumsubTxnClient.rescore).toHaveBeenCalledWith('sumsub-txn-1');
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

    it('no sumsubTxnId (never submitted to Sumsub) → skips rescore entirely, does not throw', async () => {
      const dep = frozenDeposit({ sumsubTxnId: undefined });

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

  // 终审发现:前面每个 describe 块都把 DepositTransactionsService 整体 jest.fn() 掉,
  // updateStatus 永远 resolve、从不校验真实转移表——spec 全绿但真实路径是断的
  // (Critical 1/2 都是这样漏过单测的)。这里换上真正的 DepositTransactionsService
  // (只在 Prisma 这一层 mock),让 getNextStatus 的转移表真的跑一遍,复现并验证修复。
  describe('OPERATION_PENDING 状态机缺口 —— 真实 DepositTransactionsService(不 mock 转移表本体)', () => {
    let realService: DepositWorkflowService;
    let prismaDeposit: Record<string, jest.Mock>;
    let realAuditLogsService: Record<string, jest.Mock>;

    const mockRow = (overrides: Record<string, unknown> = {}) => ({
      id: 'dep-real-1',
      depositNo: 'DEP-REAL-001',
      status: DepositTransactionStatus.OPERATION_PENDING,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-real-1',
      assetId: 'asset-usdt',
      amount: '5',
      limitHoldReason: 'BELOW_MIN',
      traceId: 'trace-real-1',
      statusHistory: null,
      ...overrides,
    });

    beforeEach(async () => {
      prismaDeposit = {
        findUnique: jest.fn(),
        update: jest.fn(),
      };
      realAuditLogsService = {
        recordSystem: jest.fn().mockResolvedValue(undefined),
        recordByActor: jest.fn().mockResolvedValue(undefined),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
        { provide: CustomerAccessService, useValue: customerAccessService },
          DepositWorkflowService,
          DepositTransactionsService,
          { provide: PrismaService, useValue: { depositTransaction: prismaDeposit } },
          { provide: EventEmitter2, useValue: { emit: jest.fn() } },
          { provide: FundsOrderService, useValue: fundsOrders },
          { provide: AuditLogsService, useValue: realAuditLogsService },
          { provide: AccountingService, useValue: { resolveTbAccountId: jest.fn(), executeTransfer: jest.fn() } },
          { provide: WithdrawalAddressService, useValue: withdrawalAddresses },
          { provide: SUMSUB_TXN_CLIENT, useValue: sumsubTxnClient },
          { provide: ApprovalsService, useValue: approvalsService },
          { provide: SystemWalletResolver, useValue: systemWalletResolver },
          { provide: TbEvidenceService, useValue: tbEvidenceService },
          { provide: DepositApplicantActionsService, useValue: actionsService },
          { provide: CustomerRestrictionsService, useValue: customerRestrictionsService },
          { provide: L1GateService, useValue: l1Gate },
          {
            provide: TransactionLimitRulesService,
            useValue: { getSingleRule: jest.fn().mockResolvedValue(null) },
          },
        ],
      }).compile();

      realService = module.get<DepositWorkflowService>(DepositWorkflowService);
    });

    // 状态机收窄(业主 2026-07-31 定稿)撤销了上一轮 Critical 1 给 OPERATION_PENDING 补的
    // freeze/kyt_rejected(原 manual_check)/action_pending 三条出边——OPERATION_PENDING
    // 现在只剩 approve/confiscate_start 两条(见 transitions 表)。迟到的制裁裁决/补料
    // webhook 落到 OPERATION_PENDING 上会重新抛 Invalid action,这是业主口径下的已知
    // 行为,记入 BACKLOG(待补 no-op + 落审计),本轮不修——原先验证"必须落地不抛"的
    // 三条 Critical 1 用例连同已删除的 adminReject 用例一并删除,不再改成别的动作硬凑绿。

    it('Critical 2: below-min 单从 ACTION_PENDING 出发调 approveDeposit → 落 OPERATION_PENDING,不抛(此前金额闸自己在转移表抛 Invalid action)', async () => {
      const row = mockRow({ status: DepositTransactionStatus.ACTION_PENDING });
      prismaDeposit.findUnique.mockResolvedValue(row);
      prismaDeposit.update.mockImplementation(({ data }: any) => Promise.resolve({ ...row, ...data }));

      await expect(realService.approveDeposit('dep-real-1')).resolves.toBeUndefined();

      expect(prismaDeposit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: DepositTransactionStatus.OPERATION_PENDING }),
        }),
      );
      expect(realAuditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.DEPOSIT_HELD_BELOW_MIN }),
      );
    });

    it('Critical 2: below-min 单从 MANUAL_CHECKING 出发调 approveDeposit → 落 OPERATION_PENDING,不抛', async () => {
      const row = mockRow({ status: DepositTransactionStatus.MANUAL_CHECKING });
      prismaDeposit.findUnique.mockResolvedValue(row);
      prismaDeposit.update.mockImplementation(({ data }: any) => Promise.resolve({ ...row, ...data }));

      await expect(realService.approveDeposit('dep-real-1')).resolves.toBeUndefined();

      expect(prismaDeposit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: DepositTransactionStatus.OPERATION_PENDING }),
        }),
      );
    });
  });

  describe('applyKytAwaitUser：多条 action 集合比对', () => {
    const ACTIONS = [
      { applicantActionId: 'aa-1', externalActionId: 'EXT-1' },
      { applicantActionId: 'aa-2', externalActionId: 'EXT-2' },
    ];

    it('从 COMPLIANCE_PENDING 首次进态：同步集合 + 状态迁移', async () => {
      const dep = { id: 'd-1', depositNo: 'DEP1', status: 'COMPLIANCE_PENDING', ownerType: 'CUSTOMER', ownerId: 'c-1' };
      depositService.updateStatus.mockResolvedValue({ ...dep, status: 'ACTION_PENDING' });
      actionsService.syncApplicantActions.mockResolvedValue({ added: [1, 2], retired: [] });
      actionsService.hasOutstanding.mockResolvedValue(true); // 同步后还有未提交行，正常推进

      await (service as any).applyKytAwaitUser(dep, undefined, ACTIONS);

      expect(actionsService.syncApplicantActions).toHaveBeenCalledWith('d-1', ACTIONS);
      expect(depositService.updateStatus).toHaveBeenCalled();
      const [, , opts] = depositService.updateStatus.mock.calls[0];
      // 2026-08-21 第三批：extraData 不再带 slaDeadline/slaBreached —— 由
      // updateStatus 内部的 resolveSlaFields(收口处)统一算,extraData 只带
      // manualReason + actionSubmittedAt 的清空。
      expect(opts.extraData).toEqual(
        expect.objectContaining({ actionSubmittedAt: null }),
      );
      expect(opts.extraData).not.toHaveProperty('slaDeadline');
      expect(opts.extraData).not.toHaveProperty('slaBreached');
    });

    // I1：两个 Sumsub client 在 scoringResult.applicantActions 缺席时都返回
    // undefined，handler 组装报文时又把空数组拍成 undefined——incoming 可能是
    // []。同步之后若这笔单零未提交行，绝不能推进到 ACTION_PENDING（那是一个
    // "ACTION_PENDING 但零条可提交项"的死角，客户永久卡死、SLA 还会把锅扣给他）。
    it('I1：跨状态弧收到空 applicantActions（同步后零未提交行）——不推进状态，只记 warn 审计', async () => {
      const dep = { id: 'd-1', depositNo: 'DEP1', status: 'COMPLIANCE_PENDING', ownerType: 'CUSTOMER', ownerId: 'c-1' };
      actionsService.syncApplicantActions.mockResolvedValue({ added: [], retired: [] });
      actionsService.hasOutstanding.mockResolvedValue(false);

      await (service as any).applyKytAwaitUser(dep, undefined, undefined);

      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditActions.DEPOSIT_AWAITUSER_EMPTY_ACTIONS,
          entityId: 'd-1',
        }),
      );
    });

    it('已在 ACTION_PENDING 且集合有新增、缓存里还留着旧的"已交齐"值：不动状态，清缓存，记审计', async () => {
      const dep = {
        id: 'd-1', depositNo: 'DEP1', status: 'ACTION_PENDING', ownerType: 'CUSTOMER', ownerId: 'c-1',
        actionSubmittedAt: new Date('2026-08-01'), // 缓存残留上一轮"已交齐"，需要清
      };
      actionsService.syncApplicantActions.mockResolvedValue({ added: [2], retired: [] });
      actionsService.hasOutstanding.mockResolvedValue(true);

      await (service as any).applyKytAwaitUser(dep, undefined, ACTIONS);

      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(actionsService.clearDepositCache).toHaveBeenCalledWith('d-1', expect.any(Date));
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditActions.DEPOSIT_ACTION_REISSUED,
          entityId: 'd-1',
          metadata: expect.objectContaining({ addedSeqs: [2], retiredSeqs: [] }),
        }),
      );
    });

    it('已在 ACTION_PENDING 且集合完全一致、缓存本就干净：真 no-op', async () => {
      const dep = { id: 'd-1', depositNo: 'DEP1', status: 'ACTION_PENDING', ownerType: 'CUSTOMER', ownerId: 'c-1' };
      actionsService.syncApplicantActions.mockResolvedValue({ added: [], retired: [] });
      actionsService.hasOutstanding.mockResolvedValue(true);

      await (service as any).applyKytAwaitUser(dep, undefined, ACTIONS);

      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(actionsService.clearDepositCache).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.DEPOSIT_ACTION_REISSUED }),
      );
    });

    // I2 的核心回归用例：webhook 重试场景——第一次投递里 syncOnce 已经把子表
    // 同步完（本次 added/retired 因此都是空），但随后的 clearDepositCache/审计写入
    // 抛错（SQLITE_BUSY、进程重启），缓存里 actionSubmittedAt 仍残留旧值。旧判据
    // （added.length===0 && retired.length===0 → return）会在这里提前退出，
    // 缓存永远清不掉；新判据改读持久状态，与本次 diff 是否为空无关，必须清掉。
    it('I2：webhook 重试——diff 为空但缓存里 actionSubmittedAt 残留旧值，仍要清掉', async () => {
      const dep = {
        id: 'd-1', depositNo: 'DEP1', status: 'ACTION_PENDING', ownerType: 'CUSTOMER', ownerId: 'c-1',
        actionSubmittedAt: new Date('2026-08-01'),
      };
      actionsService.syncApplicantActions.mockResolvedValue({ added: [], retired: [] });
      actionsService.hasOutstanding.mockResolvedValue(true);

      await (service as any).applyKytAwaitUser(dep, undefined, ACTIONS);

      expect(actionsService.clearDepositCache).toHaveBeenCalledWith('d-1', expect.any(Date));
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.DEPOSIT_ACTION_REISSUED, entityId: 'd-1' }),
      );
    });

    // 撤回同样要清缓存：3 条里撤掉 1 条未提交的之后，剩下 2 条若已交齐，
    // 缓存该盖上；反之若还有未交的，缓存必须是空。统一靠 clearDepositCache
    // + 下一次 submitBySeq 重算，不在这里各自算一遍。
    it('已在 ACTION_PENDING 且有撤回（仍有其它未提交行）：清缓存并把撤回的 seq 记进审计', async () => {
      const dep = {
        id: 'd-1', depositNo: 'DEP1', status: 'ACTION_PENDING', ownerType: 'CUSTOMER', ownerId: 'c-1',
        actionSubmittedAt: new Date('2026-08-01'),
      };
      actionsService.syncApplicantActions.mockResolvedValue({ added: [], retired: [2] });
      actionsService.hasOutstanding.mockResolvedValue(true);

      await (service as any).applyKytAwaitUser(dep, undefined, ACTIONS);

      expect(actionsService.clearDepositCache).toHaveBeenCalledWith('d-1', expect.any(Date));
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ addedSeqs: [], retiredSeqs: [2] }),
        }),
      );
    });

    // I1 的另一半死角：报文把全部未提交行都撤空了（同步后 hasOutstanding=false）。
    // 不能把这当正常 reissue 处理——不清缓存、不推进，只留痕，
    // 否则一个原本可用的 ACTION_PENDING（还有未提交行）会被改造成死角
    // （还是 ACTION_PENDING，却零条可提交项）。
    it('I1：已在 ACTION_PENDING，报文把全部未提交行撤空——不清缓存不推进，只记 warn 审计', async () => {
      const dep = { id: 'd-1', depositNo: 'DEP1', status: 'ACTION_PENDING', ownerType: 'CUSTOMER', ownerId: 'c-1' };
      actionsService.syncApplicantActions.mockResolvedValue({ added: [], retired: [1, 2] });
      actionsService.hasOutstanding.mockResolvedValue(false);

      await (service as any).applyKytAwaitUser(dep, undefined, []);

      expect(actionsService.clearDepositCache).not.toHaveBeenCalled();
      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditActions.DEPOSIT_AWAITUSER_EMPTY_ACTIONS,
          entityId: 'd-1',
          metadata: expect.objectContaining({ addedSeqs: [], retiredSeqs: [1, 2] }),
        }),
      );
    });

    it('审计带真 applicantActionId（operator 面需要，与客户面相反）', async () => {
      const dep = {
        id: 'd-1', depositNo: 'DEP1', status: 'ACTION_PENDING', ownerType: 'CUSTOMER', ownerId: 'c-1',
        actionSubmittedAt: new Date('2026-08-01'),
      };
      actionsService.syncApplicantActions.mockResolvedValue({ added: [2], retired: [] });
      actionsService.hasOutstanding.mockResolvedValue(true);

      await (service as any).applyKytAwaitUser(dep, undefined, ACTIONS);

      const call = auditLogsService.recordSystem.mock.calls.find(
        ([a]: any[]) => a.action === AuditActions.DEPOSIT_ACTION_REISSUED,
      );
      expect(call[0].metadata.incomingActionIds).toEqual(['aa-1', 'aa-2']);
    });
  });

  // Task 7：批量冻单补审计 + 自咬（本域自己刚冻的单被自己的监听器再冻一次）降级判定。
  describe('onCustomerRestrictionOpened — 批量冻单', () => {
    const baseEvent = {
      customerId: 'cust-1',
      restrictionNo: 'CR-1',
      cause: 'SANCTION',
      blocksAllCapabilities: true as const,
      traceId: 'trace-1',
    };
    const inflightDeposit = {
      id: 'd-inflight-1',
      depositNo: 'DEP-INFLIGHT-1',
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      status: DepositTransactionStatus.COMPLIANCE_PENDING,
      traceId: 'trace-dep-1',
    };

    it('冻结成功时写 DEPOSIT_FROZEN 审计（铁律①：批量冻单此前零审计）', async () => {
      depositService.findNonTerminalByOwner.mockResolvedValue([inflightDeposit]);
      depositService.updateStatus.mockResolvedValue(undefined);

      await service.onCustomerRestrictionOpened(baseEvent);

      expect(depositService.updateStatus).toHaveBeenCalledWith(
        inflightDeposit.id,
        { action: DepositTransactionAction.FREEZE },
        expect.objectContaining({
          reason: expect.stringContaining('CR-1'),
        }),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditActions.DEPOSIT_FROZEN,
          entityId: inflightDeposit.id,
          entityNo: inflightDeposit.depositNo,
          entityOwnerId: inflightDeposit.ownerId,
        }),
      );
    });

    it('自咬：updateStatus 抛异常但复核发现单已是 FROZEN → 降级 debug，不打 warn', async () => {
      depositService.findNonTerminalByOwner.mockResolvedValue([inflightDeposit]);
      depositService.updateStatus.mockRejectedValue(
        new Error("Invalid action 'freeze' for status 'FROZEN'"),
      );
      depositService.findOne.mockResolvedValue({ ...inflightDeposit, status: DepositTransactionStatus.FROZEN });
      const warnSpy = jest.spyOn((service as any).logger, 'warn');
      const debugSpy = jest.spyOn((service as any).logger, 'debug');

      await service.onCustomerRestrictionOpened(baseEvent);

      expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining(inflightDeposit.depositNo));
      expect(warnSpy).not.toHaveBeenCalled();
      // 自咬时没有真正冻结成功（updateStatus 抛了）——不该补一条虚假审计。
      expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
    });

    it('真失败：updateStatus 抛异常且复核显示单不是 FROZEN → 照旧打 warn', async () => {
      depositService.findNonTerminalByOwner.mockResolvedValue([inflightDeposit]);
      depositService.updateStatus.mockRejectedValue(new Error('DB connection lost'));
      depositService.findOne.mockResolvedValue({ ...inflightDeposit, status: DepositTransactionStatus.COMPLIANCE_PENDING });
      const warnSpy = jest.spyOn((service as any).logger, 'warn');
      const debugSpy = jest.spyOn((service as any).logger, 'debug');

      await service.onCustomerRestrictionOpened(baseEvent);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(inflightDeposit.depositNo));
      expect(debugSpy).not.toHaveBeenCalled();
    });

    // 审计写入独立 catch 的非空性：updateStatus 成功（单确实冻上了），但审计写入
    // 抛异常——必须以 logger.error 现身，不能被外层 catch 的回读判据吃成「良性
    // 自咬」（外层 catch 根本不该被触发，因为审计调用自带 .catch 不再向上抛）。
    it('审计写入独立 catch：updateStatus 成功但 recordSystem 抛异常 → logger.error 现身，不判成良性自咬', async () => {
      depositService.findNonTerminalByOwner.mockResolvedValue([inflightDeposit]);
      depositService.updateStatus.mockResolvedValue(undefined);
      auditLogsService.recordSystem.mockRejectedValue(new Error('audit db unavailable'));
      const warnSpy = jest.spyOn((service as any).logger, 'warn');
      const debugSpy = jest.spyOn((service as any).logger, 'debug');
      const errorSpy = jest.spyOn((service as any).logger, 'error');

      await service.onCustomerRestrictionOpened(baseEvent);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to write DEPOSIT_FROZEN audit for ${inflightDeposit.depositNo}`),
      );
      // 不得只打 debug（良性自咬的降级路径不该被触发——updateStatus 本身没抛）。
      expect(debugSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});

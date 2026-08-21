import { DepositSlaService } from './deposit-sla.service';
import { DepositTransactionsService } from '../trading/deposit-transactions/deposit-transactions.service';
import { AuditLogsService } from '../audit-logging/audit-logs.service';
import { DepositTransactionAction, DepositTransactionStatus } from '../trading/deposit-transactions/dto/deposit-transaction.dto';

describe('DepositSlaService', () => {
  let depositService: jest.Mocked<DepositTransactionsService>;
  let auditLogsService: jest.Mocked<AuditLogsService>;
  let service: DepositSlaService;

  beforeEach(() => {
    depositService = {
      findSlaBreachCandidates: jest.fn().mockResolvedValue([]),
      updateStatus: jest.fn(),
      markSlaBreached: jest.fn(),
    } as unknown as jest.Mocked<DepositTransactionsService>;

    auditLogsService = {
      recordSystem: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditLogsService>;

    service = new DepositSlaService(depositService, auditLogsService);
  });

  it('onHold (COMPLIANCE_PENDING) past its slaDeadline → MANUAL_CHECKING + slaBreached=true + DEPOSIT_SLA_BREACHED audit', async () => {
    const pastDeadline = new Date(Date.now() - 60_000);
    const deposit = {
      id: 'dep-1',
      depositNo: 'DEP001',
      status: DepositTransactionStatus.COMPLIANCE_PENDING,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      traceId: null,
      slaDeadline: pastDeadline,
      slaBreached: false,
    };
    depositService.findSlaBreachCandidates.mockResolvedValue([deposit] as any);
    depositService.updateStatus.mockResolvedValue({
      ...deposit,
      status: DepositTransactionStatus.MANUAL_CHECKING,
    } as any);

    await service.checkSlaBreaches();

    expect(depositService.updateStatus).toHaveBeenCalledWith(
      'dep-1',
      expect.objectContaining({ action: DepositTransactionAction.SLA_BREACH }),
      expect.anything(),
    );
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DEPOSIT_SLA_BREACHED',
        entityId: 'dep-1',
        requestId: expect.any(String),
      }),
    );
  });

  it('ACTION_PENDING past its slaDeadline → MANUAL_CHECKING + slaBreached=true + DEPOSIT_SLA_BREACHED audit', async () => {
    const pastDeadline = new Date(Date.now() - 60_000);
    const deposit = {
      id: 'dep-2',
      depositNo: 'DEP002',
      status: DepositTransactionStatus.ACTION_PENDING,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      traceId: null,
      slaDeadline: pastDeadline,
      slaBreached: false,
    };
    depositService.findSlaBreachCandidates.mockResolvedValue([deposit] as any);
    depositService.updateStatus.mockResolvedValue({
      ...deposit,
      status: DepositTransactionStatus.MANUAL_CHECKING,
    } as any);

    await service.checkSlaBreaches();

    expect(depositService.updateStatus).toHaveBeenCalledWith(
      'dep-2',
      expect.objectContaining({ action: DepositTransactionAction.SLA_BREACH }),
      expect.anything(),
    );
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DEPOSIT_SLA_BREACHED',
        entityId: 'dep-2',
        requestId: expect.any(String),
      }),
    );
  });

  it('no candidates (future slaDeadline, or slaBreached already true, or unrelated status) → scan is a no-op', async () => {
    depositService.findSlaBreachCandidates.mockResolvedValue([]);

    await service.checkSlaBreaches();

    expect(depositService.updateStatus).not.toHaveBeenCalled();
    expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
  });

  it('queries findSlaBreachCandidates with a Date (now) — the finder owns the where-clause filtering', async () => {
    await service.checkSlaBreaches();

    expect(depositService.findSlaBreachCandidates).toHaveBeenCalledWith(expect.any(Date));
  });

  it('processes multiple candidates independently', async () => {
    const past = new Date(Date.now() - 60_000);
    const depositA = {
      id: 'dep-a', depositNo: 'DEPA', status: DepositTransactionStatus.COMPLIANCE_PENDING,
      ownerType: 'CUSTOMER', ownerId: 'cust-a', traceId: null, slaDeadline: past, slaBreached: false,
    };
    const depositB = {
      id: 'dep-b', depositNo: 'DEPB', status: DepositTransactionStatus.ACTION_PENDING,
      ownerType: 'CUSTOMER', ownerId: 'cust-b', traceId: null, slaDeadline: past, slaBreached: false,
    };
    depositService.findSlaBreachCandidates.mockResolvedValue([depositA, depositB] as any);
    depositService.updateStatus.mockImplementation(async (id: string) => ({
      id,
      status: DepositTransactionStatus.MANUAL_CHECKING,
    }) as any);

    await service.checkSlaBreaches();

    expect(depositService.updateStatus).toHaveBeenCalledTimes(2);
    expect(auditLogsService.recordSystem).toHaveBeenCalledTimes(2);
  });

  describe('breach 理由按客户是否已提交分岔', () => {
    it('未提交 → 理由指向客户未响应', async () => {
      depositService.findSlaBreachCandidates.mockResolvedValue([
        { id: 'd-1', depositNo: 'DEP1', status: 'ACTION_PENDING', actionSubmittedAt: null },
      ] as any);

      await service.checkSlaBreaches();

      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'd-1',
        expect.objectContaining({
          reason: 'SLA breached: no compliance action before deadline',
        }),
        expect.anything(),
      );
    });

    it('已提交 → 理由指向 Provider 重评超时，不冤枉客户', async () => {
      depositService.findSlaBreachCandidates.mockResolvedValue([
        {
          id: 'd-2', depositNo: 'DEP2', status: 'ACTION_PENDING',
          actionSubmittedAt: new Date('2026-08-01T00:00:00Z'),
        },
      ] as any);

      await service.checkSlaBreaches();

      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'd-2',
        expect.objectContaining({
          reason:
            'SLA breached: provider re-review exceeded deadline after customer submission',
        }),
        expect.anything(),
      );
    });

    it('已提交的单，审计理由里不得出现"no compliance action"字样', async () => {
      depositService.findSlaBreachCandidates.mockResolvedValue([
        {
          id: 'd-3', depositNo: 'DEP3', status: 'ACTION_PENDING',
          actionSubmittedAt: new Date('2026-08-01T00:00:00Z'),
        },
      ] as any);

      await service.checkSlaBreaches();

      // 项目 tsconfig target 为 ES2021，Array.prototype.at() 需要 ES2022 lib，
      // 编译期会报 TS2550；改用等价的下标写法拿最后一次调用，语义不变。
      const calls = auditLogsService.recordSystem.mock.calls;
      const call = calls[calls.length - 1][0];
      expect(call.reason).not.toMatch(/no compliance action/i);
    });
  });

  describe('硬/软两类破线', () => {
    it('硬 SLA(COMPLIANCE_PENDING) 破线 → 推 MANUAL_CHECKING', async () => {
      depositService.findSlaBreachCandidates.mockResolvedValue([
        { id: 'd1', depositNo: 'DEP1', status: 'COMPLIANCE_PENDING', ownerType: 'CUSTOMER', ownerId: 'c1', slaDeadline: new Date(0) },
      ] as any);
      await service.checkSlaBreaches();
      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'd1',
        expect.objectContaining({ action: DepositTransactionAction.SLA_BREACH }),
        expect.anything(),
      );
      expect(depositService.markSlaBreached).not.toHaveBeenCalled();
    });

    it('软 SLA(MANUAL_CHECKING) 破线 → 只置标记,状态一步不动,审计带 requestId', async () => {
      depositService.findSlaBreachCandidates.mockResolvedValue([
        { id: 'd2', depositNo: 'DEP2', status: 'MANUAL_CHECKING', ownerType: 'CUSTOMER', ownerId: 'c1', slaDeadline: new Date(0) },
      ] as any);
      await service.checkSlaBreaches();
      expect(depositService.markSlaBreached).toHaveBeenCalledWith('d2');
      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEPOSIT_SLA_BREACHED',
          entityId: 'd2',
          requestId: expect.any(String),
        }),
      );
    });

    it('软 SLA(OPERATION_PENDING) 同样只置标记', async () => {
      depositService.findSlaBreachCandidates.mockResolvedValue([
        { id: 'd3', depositNo: 'DEP3', status: 'OPERATION_PENDING', ownerType: 'CUSTOMER', ownerId: 'c1', slaDeadline: new Date(0) },
      ] as any);
      await service.checkSlaBreaches();
      expect(depositService.markSlaBreached).toHaveBeenCalledWith('d3');
      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('硬破线不传 slaBreached —— 否则进 MANUAL_CHECKING 后的软计时器一出生就被标成已破线', async () => {
      depositService.findSlaBreachCandidates.mockResolvedValue([
        { id: 'd4', depositNo: 'DEP4', status: 'COMPLIANCE_PENDING', ownerType: 'CUSTOMER', ownerId: 'c1', slaDeadline: new Date(0) },
      ] as any);
      await service.checkSlaBreaches();
      const opts = depositService.updateStatus.mock.calls[0][2];
      expect(opts?.extraData?.slaBreached).toBeUndefined();
    });
  });
});

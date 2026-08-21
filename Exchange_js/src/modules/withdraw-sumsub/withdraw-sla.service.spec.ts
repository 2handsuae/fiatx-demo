import { WithdrawSlaService } from './withdraw-sla.service';
import { WithdrawTransactionsService } from '../trading/withdraw-transactions/withdraw-transactions.service';
import { AuditLogsService } from '../audit-logging/audit-logs.service';
import {
  WithdrawTransactionAction,
  WithdrawTransactionStatus,
} from '../trading/withdraw-transactions/dto/withdraw-transaction.dto';

describe('WithdrawSlaService', () => {
  let withdrawService: jest.Mocked<WithdrawTransactionsService>;
  let auditLogsService: jest.Mocked<AuditLogsService>;
  let service: WithdrawSlaService;

  beforeEach(() => {
    withdrawService = {
      findSlaBreachCandidates: jest.fn().mockResolvedValue([]),
      updateStatus: jest.fn(),
      markSlaBreached: jest.fn(),
    } as unknown as jest.Mocked<WithdrawTransactionsService>;

    auditLogsService = {
      recordSystem: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditLogsService>;

    service = new WithdrawSlaService(withdrawService, auditLogsService);
  });

  it('onHold (COMPLIANCE_PENDING) past its slaDeadline → MANUAL_CHECKING + slaBreached=true + WITHDRAW_SLA_BREACHED audit', async () => {
    const pastDeadline = new Date(Date.now() - 60_000);
    const withdraw = {
      id: 'wd-1',
      withdrawNo: 'WD001',
      status: WithdrawTransactionStatus.COMPLIANCE_PENDING,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      traceId: null,
      slaDeadline: pastDeadline,
      slaBreached: false,
    };
    withdrawService.findSlaBreachCandidates.mockResolvedValue([withdraw] as any);
    withdrawService.updateStatus.mockResolvedValue({
      ...withdraw,
      status: WithdrawTransactionStatus.MANUAL_CHECKING,
    } as any);

    await service.checkSlaBreaches();

    expect(withdrawService.updateStatus).toHaveBeenCalledWith(
      'wd-1',
      expect.objectContaining({ action: WithdrawTransactionAction.SLA_BREACH }),
      expect.anything(),
    );
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WITHDRAW_SLA_BREACHED',
        entityId: 'wd-1',
        requestId: expect.any(String),
      }),
    );
  });

  it('ACTION_PENDING past its slaDeadline → MANUAL_CHECKING + slaBreached=true + WITHDRAW_SLA_BREACHED audit', async () => {
    const pastDeadline = new Date(Date.now() - 60_000);
    const withdraw = {
      id: 'wd-2',
      withdrawNo: 'WD002',
      status: WithdrawTransactionStatus.ACTION_PENDING,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      traceId: null,
      slaDeadline: pastDeadline,
      slaBreached: false,
    };
    withdrawService.findSlaBreachCandidates.mockResolvedValue([withdraw] as any);
    withdrawService.updateStatus.mockResolvedValue({
      ...withdraw,
      status: WithdrawTransactionStatus.MANUAL_CHECKING,
    } as any);

    await service.checkSlaBreaches();

    expect(withdrawService.updateStatus).toHaveBeenCalledWith(
      'wd-2',
      expect.objectContaining({ action: WithdrawTransactionAction.SLA_BREACH }),
      expect.anything(),
    );
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WITHDRAW_SLA_BREACHED',
        entityId: 'wd-2',
        requestId: expect.any(String),
      }),
    );
  });

  it('no candidates (future slaDeadline, or slaBreached already true, or unrelated status) → scan is a no-op', async () => {
    withdrawService.findSlaBreachCandidates.mockResolvedValue([]);

    await service.checkSlaBreaches();

    expect(withdrawService.updateStatus).not.toHaveBeenCalled();
    expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
  });

  it('queries findSlaBreachCandidates with a Date (now) — the finder owns the where-clause filtering', async () => {
    await service.checkSlaBreaches();

    expect(withdrawService.findSlaBreachCandidates).toHaveBeenCalledWith(expect.any(Date));
  });

  it('processes multiple candidates independently', async () => {
    const past = new Date(Date.now() - 60_000);
    const withdrawA = {
      id: 'wd-a', withdrawNo: 'WDA', status: WithdrawTransactionStatus.COMPLIANCE_PENDING,
      ownerType: 'CUSTOMER', ownerId: 'cust-a', traceId: null, slaDeadline: past, slaBreached: false,
    };
    const withdrawB = {
      id: 'wd-b', withdrawNo: 'WDB', status: WithdrawTransactionStatus.ACTION_PENDING,
      ownerType: 'CUSTOMER', ownerId: 'cust-b', traceId: null, slaDeadline: past, slaBreached: false,
    };
    withdrawService.findSlaBreachCandidates.mockResolvedValue([withdrawA, withdrawB] as any);
    withdrawService.updateStatus.mockImplementation(async (id: string) => ({
      id,
      status: WithdrawTransactionStatus.MANUAL_CHECKING,
    }) as any);

    await service.checkSlaBreaches();

    expect(withdrawService.updateStatus).toHaveBeenCalledTimes(2);
    expect(auditLogsService.recordSystem).toHaveBeenCalledTimes(2);
  });

  describe('硬/软两类破线', () => {
    it('硬 SLA(COMPLIANCE_PENDING) 破线 → 推 MANUAL_CHECKING', async () => {
      const w = { id: 'w1', withdrawNo: 'WD1', status: 'COMPLIANCE_PENDING', ownerType: 'CUSTOMER', ownerId: 'c1', slaDeadline: new Date(0) };
      withdrawService.findSlaBreachCandidates.mockResolvedValue([w] as any);
      await service.checkSlaBreaches();
      expect(withdrawService.updateStatus).toHaveBeenCalledWith(
        'w1',
        expect.objectContaining({ action: WithdrawTransactionAction.SLA_BREACH }),
        expect.anything(),
      );
      expect(withdrawService.markSlaBreached).not.toHaveBeenCalled();
    });

    it('软 SLA(MANUAL_CHECKING) 破线 → 只置标记,状态一步不动,审计带 requestId', async () => {
      const w = { id: 'w2', withdrawNo: 'WD2', status: 'MANUAL_CHECKING', ownerType: 'CUSTOMER', ownerId: 'c1', slaDeadline: new Date(0) };
      withdrawService.findSlaBreachCandidates.mockResolvedValue([w] as any);
      await service.checkSlaBreaches();
      expect(withdrawService.markSlaBreached).toHaveBeenCalledWith('w2');
      expect(withdrawService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'WITHDRAW_SLA_BREACHED',
          entityId: 'w2',
          requestId: expect.any(String),
        }),
      );
    });

    it('软 SLA(PENDING_APPROVAL) 同样只置标记', async () => {
      const w = { id: 'w3', withdrawNo: 'WD3', status: 'PENDING_APPROVAL', ownerType: 'CUSTOMER', ownerId: 'c1', slaDeadline: new Date(0) };
      withdrawService.findSlaBreachCandidates.mockResolvedValue([w] as any);
      await service.checkSlaBreaches();
      expect(withdrawService.markSlaBreached).toHaveBeenCalledWith('w3');
      expect(withdrawService.updateStatus).not.toHaveBeenCalled();
    });

    it('硬破线不传 slaBreached —— 否则进 MANUAL_CHECKING 后的软计时器一出生就被标成已破线', async () => {
      const w = { id: 'w4', withdrawNo: 'WD4', status: 'COMPLIANCE_PENDING', ownerType: 'CUSTOMER', ownerId: 'c1', slaDeadline: new Date(0) };
      withdrawService.findSlaBreachCandidates.mockResolvedValue([w] as any);
      await service.checkSlaBreaches();
      const opts = withdrawService.updateStatus.mock.calls[0][2];
      expect(opts?.extraData?.slaBreached).toBeUndefined();
    });
  });
});

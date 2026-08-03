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
      expect.objectContaining({ extraData: { slaBreached: true } }),
    );
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WITHDRAW_SLA_BREACHED', entityId: 'wd-1' }),
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
      expect.objectContaining({ extraData: { slaBreached: true } }),
    );
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WITHDRAW_SLA_BREACHED', entityId: 'wd-2' }),
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
});

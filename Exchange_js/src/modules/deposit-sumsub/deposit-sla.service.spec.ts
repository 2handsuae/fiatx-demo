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
      expect.objectContaining({ extraData: { slaBreached: true } }),
    );
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DEPOSIT_SLA_BREACHED', entityId: 'dep-1' }),
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
      expect.objectContaining({ extraData: { slaBreached: true } }),
    );
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DEPOSIT_SLA_BREACHED', entityId: 'dep-2' }),
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
});

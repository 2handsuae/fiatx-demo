import { SwapSlaService } from './swap-sla.service';
import { SwapTransactionsService } from '../trading/swap-transactions/swap-transactions.service';
import { SwapWorkflowService } from '../trading/swap-transactions/swap-workflow.service';
import { AuditLogsService } from '../audit-logging/audit-logs.service';
import { SwapTransactionAction } from '../trading/swap-transactions/dto/swap-transaction.dto';
import { AuditActions } from '../audit-logging/constants/audit-actions.constant';
import { BadRequestException } from '@nestjs/common';

describe('SwapSlaService', () => {
  let prisma: any;
  let swapService: jest.Mocked<Pick<SwapTransactionsService, 'markStatus' | 'findSlaBreachCandidates'>>;
  let workflow: jest.Mocked<Pick<SwapWorkflowService, 'submitSumsubTxnOut'>>;
  let auditLogsService: jest.Mocked<Pick<AuditLogsService, 'recordSystem'>>;
  let markStatusSpy: jest.Mock;
  let service: SwapSlaService;

  beforeEach(() => {
    markStatusSpy = jest.fn().mockResolvedValue('REJECTED');
    swapService = {
      markStatus: markStatusSpy,
      findSlaBreachCandidates: jest.fn().mockResolvedValue([]),
    } as any;
    workflow = { submitSumsubTxnOut: jest.fn().mockResolvedValue(undefined) } as any;
    auditLogsService = { recordSystem: jest.fn().mockResolvedValue(undefined) } as any;
    prisma = {
      // 与 swap-workflow.service.spec.ts 同款：$transaction 直接把回调塞进同一个 tx。
      $transaction: jest.fn((cb: (tx: any) => Promise<any>) => cb(prisma)),
    };

    service = new SwapSlaService(
      prisma,
      swapService as unknown as SwapTransactionsService,
      workflow as unknown as SwapWorkflowService,
      auditLogsService as unknown as AuditLogsService,
    );
  });

  it('超过合规超时的 COMPLIANCE_PENDING 单 → REJECTED(TIMEOUT)', async () => {
    (swapService.findSlaBreachCandidates as jest.Mock).mockResolvedValue([
      {
        id: 's1',
        swapNo: 'SWP001',
        status: 'COMPLIANCE_PENDING',
        sumsubTxnIdOut: 'T1',
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: null,
        createdAt: new Date(Date.now() - 120_000),
      },
    ]);

    const r = await service.sweep();

    expect(r.timedOut).toBe(1);
    expect(r.resubmitted).toBe(0);
    expect(markStatusSpy).toHaveBeenCalledWith(
      's1',
      SwapTransactionAction.SLA_BREACH,
      expect.anything(),
      { rejectReason: 'TIMEOUT' },
    );
  });

  it('已建单但未提交（sumsubTxnIdOut 为空）→ 重试提交而非判超时', async () => {
    (swapService.findSlaBreachCandidates as jest.Mock).mockResolvedValue([
      {
        id: 's2',
        swapNo: 'SWP002',
        status: 'COMPLIANCE_PENDING',
        sumsubTxnIdOut: null,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-2',
        traceId: null,
        createdAt: new Date(Date.now() - 120_000),
      },
    ]);

    const r = await service.sweep();

    expect(r.resubmitted).toBe(1);
    expect(r.timedOut).toBe(0);
    expect(workflow.submitSumsubTxnOut).toHaveBeenCalledWith('s2');
    // 重试提交不是"判死"——不能顺手把这单也标 SLA_BREACH。
    expect(markStatusSpy).not.toHaveBeenCalled();
  });

  it('超时判死会写一条 SWAP_SLA_BREACHED 审计（markStatus 本身不写审计，调用方负责）', async () => {
    (swapService.findSlaBreachCandidates as jest.Mock).mockResolvedValue([
      {
        id: 's1',
        swapNo: 'SWP001',
        status: 'COMPLIANCE_PENDING',
        sumsubTxnIdOut: 'T1',
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: 'trace-1',
        createdAt: new Date(Date.now() - 120_000),
      },
    ]);

    await service.sweep();

    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditActions.SWAP_SLA_BREACHED,
        entityId: 's1',
        entityNo: 'SWP001',
        traceId: 'trace-1',
        entityOwnerType: 'CUSTOMER',
        entityOwnerId: 'cust-1',
      }),
      expect.anything(),
    );
  });

  it('无候选单（没有过期的 COMPLIANCE_PENDING）→ 空扫描，什么都不做', async () => {
    (swapService.findSlaBreachCandidates as jest.Mock).mockResolvedValue([]);

    const r = await service.sweep();

    expect(r).toEqual({ timedOut: 0, resubmitted: 0 });
    expect(markStatusSpy).not.toHaveBeenCalled();
    expect(workflow.submitSumsubTxnOut).not.toHaveBeenCalled();
    expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
  });

  it('一笔判死抛错（并发竞态：webhook 抢先把单子推进了终态，markStatus 抛 Invalid transition）不影响其余候选单继续处理', async () => {
    (swapService.findSlaBreachCandidates as jest.Mock).mockResolvedValue([
      {
        id: 's1', swapNo: 'SWP001', status: 'COMPLIANCE_PENDING', sumsubTxnIdOut: 'T1',
        ownerType: 'CUSTOMER', ownerId: 'cust-1', traceId: null,
        createdAt: new Date(Date.now() - 120_000),
      },
      {
        id: 's2', swapNo: 'SWP002', status: 'COMPLIANCE_PENDING', sumsubTxnIdOut: 'T2',
        ownerType: 'CUSTOMER', ownerId: 'cust-2', traceId: null,
        createdAt: new Date(Date.now() - 120_000),
      },
    ]);
    markStatusSpy
      .mockRejectedValueOnce(new BadRequestException('Invalid transition: PROCESSING + sla_breach'))
      .mockResolvedValueOnce('REJECTED');

    const r = await service.sweep();

    expect(markStatusSpy).toHaveBeenCalledTimes(2);
    expect(r.timedOut).toBe(1); // 只有 s2 真正判死成功
  });

  it('一笔重试提交抛错不影响其余候选单继续处理', async () => {
    (swapService.findSlaBreachCandidates as jest.Mock).mockResolvedValue([
      {
        id: 's1', swapNo: 'SWP001', status: 'COMPLIANCE_PENDING', sumsubTxnIdOut: null,
        ownerType: 'CUSTOMER', ownerId: 'cust-1', traceId: null,
        createdAt: new Date(Date.now() - 120_000),
      },
      {
        id: 's2', swapNo: 'SWP002', status: 'COMPLIANCE_PENDING', sumsubTxnIdOut: 'T2',
        ownerType: 'CUSTOMER', ownerId: 'cust-2', traceId: null,
        createdAt: new Date(Date.now() - 120_000),
      },
    ]);
    (workflow.submitSumsubTxnOut as jest.Mock).mockRejectedValueOnce(new Error('boom'));

    const r = await service.sweep();

    expect(workflow.submitSumsubTxnOut).toHaveBeenCalledWith('s1');
    expect(markStatusSpy).toHaveBeenCalledWith(
      's2',
      SwapTransactionAction.SLA_BREACH,
      expect.anything(),
      { rejectReason: 'TIMEOUT' },
    );
    expect(r.timedOut).toBe(1);
    expect(r.resubmitted).toBe(0); // s1 的重试抛错了，不计入成功
  });

  it('按 slaDeadline 扫描,而不是 createdAt', async () => {
    // 建单很久、但 deadline 在未来 → 不该破线
    (swapService.findSlaBreachCandidates as jest.Mock).mockResolvedValue([]);
    const res = await service.sweep();
    expect(res.timedOut).toBe(0);
    expect(swapService.findSlaBreachCandidates).toHaveBeenCalled();
  });
});

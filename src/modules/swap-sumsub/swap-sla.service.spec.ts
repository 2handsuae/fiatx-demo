import { SwapSlaService } from './swap-sla.service';
import { SwapTransactionsService } from '../trading/swap-transactions/swap-transactions.service';
import { SwapWorkflowService } from '../trading/swap-transactions/swap-workflow.service';
import { AuditLogsService } from '../audit-logging/audit-logs.service';
import { NotificationsService } from '../../core/notifications/notifications.service';
import { SwapTransactionAction } from '../trading/swap-transactions/dto/swap-transaction.dto';
import { AuditActions } from '../audit-logging/constants/audit-actions.constant';
import { BadRequestException } from '@nestjs/common';

describe('SwapSlaService', () => {
  let prisma: any;
  let swapService: jest.Mocked<Pick<SwapTransactionsService, 'markStatus' | 'findSlaBreachCandidates' | 'extendComplianceSla' | 'toCustomerSwapStatus'>>;
  let workflow: jest.Mocked<Pick<SwapWorkflowService, 'submitSumsubTxnOut'>>;
  let auditLogsService: jest.Mocked<Pick<AuditLogsService, 'recordSystem'>>;
  // 战役丙波一 T7 修2（复审逮，第 9 个 markStatus 调用点）。
  let notificationsService: jest.Mocked<Pick<NotificationsService, 'notifyOrderStatusChange'>>;
  let markStatusSpy: jest.Mock;
  let service: SwapSlaService;

  beforeEach(() => {
    markStatusSpy = jest.fn().mockResolvedValue('REJECTED');
    swapService = {
      markStatus: markStatusSpy,
      findSlaBreachCandidates: jest.fn().mockResolvedValue([]),
      extendComplianceSla: jest.fn().mockResolvedValue(undefined),
      // 恒等直通，专属 notify 用例自行覆盖。
      toCustomerSwapStatus: jest.fn((status: string) => status),
    } as any;
    workflow = { submitSumsubTxnOut: jest.fn().mockResolvedValue(undefined), releaseBirthLock: jest.fn().mockResolvedValue('100') } as any;
    auditLogsService = { recordSystem: jest.fn().mockResolvedValue(undefined) } as any;
    notificationsService = { notifyOrderStatusChange: jest.fn().mockResolvedValue(undefined) } as any;
    prisma = {
      // 与 swap-workflow.service.spec.ts 同款：$transaction 直接把回调塞进同一个 tx。
      $transaction: jest.fn((cb: (tx: any) => Promise<any>) => cb(prisma)),
    };

    service = new SwapSlaService(
      prisma,
      swapService as unknown as SwapTransactionsService,
      workflow as unknown as SwapWorkflowService,
      auditLogsService as unknown as AuditLogsService,
      notificationsService as unknown as NotificationsService,
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
      { rejectReason: 'TIMEOUT', operator: 'SLA_SWEEP' },
    );
  });

  // 战役丙波一 T7 修2（复审逮，第 9 个 markStatus 调用点）：sweep 打出的
  // SLA_BREACH 拒单也是一次客户可见的状态迁移——notify 必须在本文件自己的
  // $transaction resolve 之后才调用，同 T7 fix round 1 的时序性质。
  //
  // 写法与 swap-workflow.service.spec.ts 的 8 个时序用例不同：那边在
  // $transaction mock 内部直接 `expect(...).not.toHaveBeenCalled()`，抛出
  // 即失败。本文件的 sweep() 对每笔候选单都有自己的 try/catch（"单笔处理失败
  // 不能拖垮整个 sweep"，见类注释），若照搬那种写法，断言失败被当成候选单
  // 处理失败吞掉、只在 logger.error 里现身，测试本身会假绿（真实验证：曾经
  // 这样写过，故意在事务回调内提前调用 notify 复现假绿——测试仍然通过）。
  // 改成记录调用顺序到一个不会抛错的数组，在 sweep() 之外（试/catch 外）断言
  // 顺序——不依赖抛出，吞不掉。
  describe('T7 修2：notifyOrderStatusChange 只在 $transaction resolve 之后才调用', () => {
    it('SLA 破线拒单成功：resolve 之后才调用（顺序断言），传参真值', async () => {
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
      const order: string[] = [];
      prisma.$transaction = jest.fn(async (cb: any) => {
        const result = await cb(prisma);
        order.push('tx-callback-settled');
        return result;
      });
      (notificationsService.notifyOrderStatusChange as jest.Mock).mockImplementation(async () => {
        order.push('notify-called');
      });

      await service.sweep();

      // 若 notify 被错放回事务回调内部，'notify-called' 会先于
      // 'tx-callback-settled' 入列（回调里调完 notify 才 return，'settled' 是
      // 回调返回之后才 push 的）。
      expect(order).toEqual(['tx-callback-settled', 'notify-called']);
      expect(notificationsService.notifyOrderStatusChange).toHaveBeenCalledTimes(1);
      expect(notificationsService.notifyOrderStatusChange).toHaveBeenCalledWith({
        domain: 'SWAP',
        orderNo: 'SWP001',
        owner: { customerId: 'cust-1' },
        collapsedFrom: 'COMPLIANCE_PENDING',
        collapsedTo: 'REJECTED',
      });
    });

    // 反面封条：这正是 T10 走查逮住的真实故障形态——tx 内跨连接自锁导致外层
    // 事务回滚，notify 必须零调用（调用点在 `await this.prisma.$transaction(...)`
    // 之后，事务 reject 时那一行永远执行不到）。
    it('$transaction 回调抛错（模拟提交失败/回滚）：notifyOrderStatusChange 零调用，且不影响 timedOut 计数为 0', async () => {
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
      prisma.$transaction = jest.fn(async (cb: any) => {
        await cb(prisma); // markStatus 等内部调用先跑完，模拟"迁移已尝试"
        throw new Error('simulated commit failure — outer transaction rolls back');
      });

      const r = await service.sweep();

      // sweep 逐笔 try/catch——这笔失败不上抛，只是不计入 timedOut。
      expect(r.timedOut).toBe(0);
      expect(notificationsService.notifyOrderStatusChange).not.toHaveBeenCalled();
    });
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

  it('resubmit branch pushes the SLA window after a successful re-submit (E5)', async () => {
    const swap = {
      id: 's2',
      swapNo: 'SWP002',
      status: 'COMPLIANCE_PENDING',
      sumsubTxnIdOut: null,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-2',
      traceId: null,
      createdAt: new Date(Date.now() - 120_000),
    };
    (swapService.findSlaBreachCandidates as jest.Mock).mockResolvedValue([swap]);

    await service.sweep();

    expect(workflow.submitSumsubTxnOut).toHaveBeenCalledWith('s2');
    expect(swapService.extendComplianceSla).toHaveBeenCalledWith(swap.id);
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
        primarySubjectNo: 'SWP001',
        traceId: 'trace-1',
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
      { rejectReason: 'TIMEOUT', operator: 'SLA_SWEEP' },
    );
    expect(r.timedOut).toBe(1);
    expect(r.resubmitted).toBe(0); // s1 的重试抛错了，不计入成功
  });
});

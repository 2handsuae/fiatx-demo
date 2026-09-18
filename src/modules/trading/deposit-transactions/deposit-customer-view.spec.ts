import { Test, TestingModule } from '@nestjs/testing';
import { DepositTransactionsService } from './deposit-transactions.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FundsOrderService } from '../../funds-orders/funds-order.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { TransactionLimitRulesService } from '../../asset-treasury/transaction-limits/transaction-limit-rules.service';
import { ApprovalsService } from '../../governance/approvals/approvals.service';

describe('DepositTransactionsService.toCustomerDepositView', () => {
  let service: DepositTransactionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepositTransactionsService,
        { provide: PrismaService, useValue: {} },
        { provide: EventEmitter2, useValue: {} },
        { provide: FundsOrderService, useValue: {} },
        { provide: AuditLogsService, useValue: {} },
        { provide: TransactionLimitRulesService, useValue: {} },
        { provide: ApprovalsService, useValue: {} },
      ],
    }).compile();

    service = module.get<DepositTransactionsService>(DepositTransactionsService);
  });

  it('exposes toAddress/toIban/effectiveDate/timeline and keeps the tipping-off whitelist intact', () => {
    const row = {
      id: 'uuid-x',
      depositNo: 'DEP1',
      status: 'FROZEN',
      amount: '100',
      createdAt: new Date('2026-09-15T10:00:00.000Z'),
      completedAt: new Date(),
      txHash: '0xabc',
      referenceNo: null,
      fromAddress: 'Txyz',
      fromIban: null,
      toAddress: 'Tplatform',
      toIban: null,
      effectiveDate: '2026-09-15',
      statusHistory: JSON.stringify([
        { status: 'COMPLIANCE_PENDING', timestamp: '2026-09-15T10:00:01.000Z' },
        { status: 'FROZEN', timestamp: '2026-09-15T10:01:00.000Z' },
      ]),
      manualReason: 'EDD_PEP',
      limitHoldReason: 'BELOW_MIN',
      slaDeadline: new Date(),
      slaBreached: true,
      sumsubTxnId: 'st-1',
      asset: { code: 'USDT-TRON', currency: 'USDT', network: 'TRON', decimals: 6 },
    };

    const view = (service as any).toCustomerDepositView(row);

    // 新字段
    expect(view.toAddress).toBe('Tplatform');
    expect(view.toIban).toBeNull();
    expect(view.effectiveDate).toBe('2026-09-15');
    // 时间线：FROZEN 收敛后被吞，只剩出生 PAYIN_PENDING → COMPLIANCE_PENDING
    expect(view.timeline).toEqual([
      { status: 'PAYIN_PENDING', at: '2026-09-15T10:00:00.000Z' },
      { status: 'COMPLIANCE_PENDING', at: '2026-09-15T10:00:01.000Z' },
    ]);
    // 禁入清单（Global Constraints）逐个 not.toHaveProperty
    for (const k of [
      'statusHistory',
      'manualReason',
      'limitHoldReason',
      'slaDeadline',
      'slaBreached',
      'sumsubTxnId',
    ]) {
      expect(view).not.toHaveProperty(k);
    }
    // FROZEN 单 status 收敛 + completedAt 门控吞掉
    expect(view.status).toBe('COMPLIANCE_PENDING');
    expect(view.completedAt).toBeNull();
  });
});

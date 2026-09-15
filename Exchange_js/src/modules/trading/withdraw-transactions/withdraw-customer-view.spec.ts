import { Test, TestingModule } from '@nestjs/testing';
import { WithdrawTransactionsService } from './withdraw-transactions.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { ApprovalsService } from '../../governance/approvals/approvals.service';

describe('WithdrawTransactionsService customer view enrichment (Task 3)', () => {
  let service: WithdrawTransactionsService;
  let prisma: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WithdrawTransactionsService,
        {
          provide: PrismaService,
          useValue: {
            withdrawalAddress: { findFirst: jest.fn() },
          },
        },
        { provide: EventEmitter2, useValue: {} },
        { provide: AuditLogsService, useValue: {} },
        { provide: ApprovalsService, useValue: {} },
      ],
    }).compile();

    service = module.get<WithdrawTransactionsService>(WithdrawTransactionsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('toCustomerWithdrawView', () => {
    it('出生 COMPLIANCE_PENDING + 冻结吞没进 timeline；禁入清单一个不漏', () => {
      const row = {
        id: 'w-1',
        withdrawNo: 'WDR1',
        status: 'FROZEN',
        amount: '100',
        feeAmount: '1',
        netAmount: '99',
        createdAt: new Date('2026-09-15T10:00:00.000Z'),
        completedAt: new Date(),
        txHash: '0xabc',
        referenceNo: null,
        toAddress: 'Taddr',
        toIban: null,
        // 两条：出生态显式一条 + FROZEN 一条。FROZEN 收敛后与「上一条同态」
        // 规则无关——它本身就是禁入清单外的态，收敛成 COMPLIANCE_PENDING 后
        // 与出生态同态被吞没，时间线上只剩出生一条（tipping-off 不变式）。
        statusHistory: JSON.stringify([
          { status: 'COMPLIANCE_PENDING', timestamp: '2026-09-15T10:00:01.000Z' },
          { status: 'FROZEN', timestamp: '2026-09-15T10:01:00.000Z' },
        ]),
        manualReason: 'EDD_PEP',
        sumsubTxnId: 'st-1',
        sumsubTxnType: 'travelRule',
        sumsubVerdict: 'rejected',
        sumsubScore: 90,
        sumsubTxnDetailJson: '{}',
        counterpartyIsVasp: true,
        slaDeadline: new Date(),
        slaBreached: true,
        needsReview: true,
        feeSettleAttempts: 1,
        tbPendingNetId: 'tb-1',
        tbPendingFeeId: 'tb-2',
        grossAedValue: '100',
        approvalCaseId: 'case-1',
        approvalNo: 'APR-1',
        traceId: 'trace-1',
        asset: { code: 'USDT-TRON', currency: 'USDT', network: 'TRON', decimals: 6 },
      };

      const view = (service as any).toCustomerWithdrawView(row);

      // 出生 COMPLIANCE_PENDING（显式一条，与出生态同值）+ FROZEN 收敛后同态
      // 被吞没：时间线只剩出生一条。
      expect(view.timeline).toEqual([
        { status: 'COMPLIANCE_PENDING', at: '2026-09-15T10:00:00.000Z' },
      ]);
      expect(view.status).toBe('COMPLIANCE_PENDING');
      expect(view.completedAt).toBeNull();

      // 禁入清单（白名单放行制）：statusHistory 原文 / manualReason /
      // sumsub* / kyt* / travelRule* / limitHoldReason* / sla* 等一个不漏；
      // quote/addressLabel 只属于详情路径（findOneForCustomer），列表/同步
      // 视图构造函数本身不应带出这两个键。
      for (const k of [
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
        'quote',
        'addressLabel',
      ]) {
        expect(view).not.toHaveProperty(k);
      }
    });
  });

  describe('findOneForCustomer — 详情路径专属富化（quote/addressLabel，列表不背 N+1）', () => {
    const baseRow = {
      id: 'w-detail-1',
      ownerId: 'cust-1',
      withdrawNo: 'WDR-DETAIL-1',
      status: 'SUCCESS',
      amount: '100',
      feeAmount: '1',
      netAmount: '99',
      createdAt: new Date('2026-09-15T10:00:00.000Z'),
      completedAt: new Date('2026-09-15T10:05:00.000Z'),
      txHash: '0xabc',
      referenceNo: null,
      toAddress: 'Taddr',
      toIban: null,
      statusHistory: '[]',
      asset: { code: 'USDT-TRON', currency: 'USDT', network: 'TRON', decimals: 6 },
    };

    it('pricingQuote 命中 → view.quote 三键；withdrawalAddress 命中 → addressLabel', async () => {
      jest.spyOn(service, 'findOneInternal').mockResolvedValue({
        ...baseRow,
        pricingQuote: {
          quoteNo: 'WQT1',
          feeLevelCode: 'STD-USDT',
          matchedTierName: 'Tier 1 (0-500)',
        },
      } as any);
      prisma.withdrawalAddress.findFirst.mockResolvedValue({ label: 'My cold wallet' });

      const view: any = await service.findOneForCustomer('w-detail-1', 'cust-1');

      expect(view.quote).toEqual({
        quoteNo: 'WQT1',
        feeLevelCode: 'STD-USDT',
        tierName: 'Tier 1 (0-500)',
      });
      expect(view.addressLabel).toBe('My cold wallet');
    });

    it('pricingQuote 为 null → view.quote 为 null（不抛，不臆造字段）', async () => {
      jest.spyOn(service, 'findOneInternal').mockResolvedValue({
        ...baseRow,
        pricingQuote: null,
      } as any);
      prisma.withdrawalAddress.findFirst.mockResolvedValue(null);

      const view: any = await service.findOneForCustomer('w-detail-1', 'cust-1');

      expect(view.quote).toBeNull();
    });

    it('withdrawalAddress 查不到（findFirst 回 null）→ addressLabel 为 null', async () => {
      jest.spyOn(service, 'findOneInternal').mockResolvedValue({
        ...baseRow,
        pricingQuote: null,
      } as any);
      prisma.withdrawalAddress.findFirst.mockResolvedValue(null);

      const view: any = await service.findOneForCustomer('w-detail-1', 'cust-1');

      expect(view.addressLabel).toBeNull();
    });
  });
});

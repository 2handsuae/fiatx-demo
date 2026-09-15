import { Test, TestingModule } from '@nestjs/testing';
import { SwapTransactionsService } from './swap-transactions.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SwapQuoteService } from '../swap-fee-level/swap-quote.service';
import { BinanceRateProvider } from '../pricing-center/providers/binance-rate.provider';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { CustomerAccessService } from '../../identity/customers/customer-access.service';

describe('SwapTransactionsService customer view enrichment (Task 4)', () => {
  let service: SwapTransactionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SwapTransactionsService,
        { provide: PrismaService, useValue: {} },
        { provide: SwapQuoteService, useValue: {} },
        { provide: BinanceRateProvider, useValue: {} },
        { provide: EventEmitter2, useValue: {} },
        { provide: AuditLogsService, useValue: {} },
        { provide: CustomerAccessService, useValue: {} },
      ],
    }).compile();

    service = module.get<SwapTransactionsService>(SwapTransactionsService);
  });

  describe('toCustomerSwapView', () => {
    const feeBreakdown = JSON.stringify([
      {
        policyRef: { policyCode: 'LEVEL:STD-USDT', policyId: 'pol-1', business: 'SWAP', channel: 'ONLINE' },
        matched: { pairId: 'pair-uuid-1', pairName: 'USDT/AED', tierId: 'tier-uuid-1', tierName: 'Tier 1 (0-500)' },
        fx: {
          baseProvider: 'BINANCE',
          baseRate: '3.6725',
          quotedRate: '3.6688',
          markupBps: 10,
          endpoint: 'api/v3/ticker/bookTicker',
          symbol: 'USDTAED',
          bid: '3.6720',
          ask: '3.6730',
        },
        fees: [
          { itemCode: 'SWAP_SPREAD_FEE', calcType: 'PERCENTAGE', currency: 'AED', amount: '3.67' },
          { itemCode: 'SWAP_FLAT_FEE', calcType: 'FIXED', currency: 'AED', amount: '2.00' },
        ],
        totals: { amountIn: '100', amountOutGross: '366.88', amountOutNet: '361.21', feeTotal: '5.67', feeCurrency: 'AED' },
      },
    ]);

    it('出生 COMPLIANCE_PENDING + 冻结吞没进 timeline；报价号/费用明细/市场价点差拆净；禁入清单一个不漏', () => {
      const row = {
        id: 'swp-1',
        swapNo: 'SWP0001',
        quoteNo: 'SQT1',
        status: 'FROZEN',
        fromAmount: '100',
        toAmount: '366.88',
        netToAmount: '361.21',
        feeAmount: '5.67',
        feeCurrency: 'AED',
        exchangeRate: '3.6688',
        createdAt: new Date('2026-09-15T10:00:00.000Z'),
        completedAt: new Date(),
        feeBreakdown,
        // 出生态显式一条 + FROZEN 一条，两条收敛后同为 COMPLIANCE_PENDING，
        // 与 withdraw 域同一条 tipping-off 不变式：FROZEN 单时间线上看不出
        // 曾经冻结过，只剩出生一条。
        statusHistory: JSON.stringify([
          { status: 'COMPLIANCE_PENDING', timestamp: '2026-09-15T10:00:01.000Z' },
          { status: 'FROZEN', timestamp: '2026-09-15T10:01:00.000Z' },
        ]),
        needsReview: true,
        currentStage: 'SELL_LEG_KYT',
        correlationId: 'corr-1',
        l1Snapshot: '{}',
        slaDeadline: new Date(),
        slaBreached: true,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        ownerNo: 'C0001',
        quoteId: 'quote-uuid-1',
        quoteSnapshotRef: 'ref-1',
        sumsubTxnIdOut: 'st-out-1',
        sumsubTxnIdIn: 'st-in-1',
        complianceVerdict: 'GREEN',
        complianceAction: 'allow',
        complianceRuleNames: 'rule-a,rule-b',
        sumsubDetailJson: '{}',
        rejectReason: 'SANCTIONS_MATCH',
        sumsubScore: 90,
        sumsubScoredAt: new Date(),
        sumsubTxnType: 'finance',
        spreadAmount: '1.23',
        grossAedValue: '366.88',
        failureReason: null,
        tbFromTransferId: 'tb-1',
        tbToTransferId: 'tb-2',
        tbFeeTransferId: 'tb-3',
        tbSpreadTransferId: 'tb-4',
        traceId: 'trace-1',
        fromAsset: { code: 'USDT-TRON', currency: 'USDT', network: 'TRON', decimals: 6 },
        toAsset: { code: 'AED', currency: 'AED', network: null, decimals: 2 },
      };

      const view: any = (service as any).toCustomerSwapView(row);

      // 出生 COMPLIANCE_PENDING（显式一条，与出生态同值）+ FROZEN 收敛后同态
      // 被吞没：时间线只剩出生一条。
      expect(view.timeline).toEqual([
        { status: 'COMPLIANCE_PENDING', at: '2026-09-15T10:00:00.000Z' },
      ]);
      expect(view.status).toBe('COMPLIANCE_PENDING');
      expect(view.completedAt).toBeNull();

      // 报价号原样透传。
      expect(view.quoteNo).toBe('SQT1');

      // 费用明细只剩三键（fees[] 逐条投影，itemCode/amount/currency）。
      expect(view.feeLines).toEqual([
        { itemCode: 'SWAP_SPREAD_FEE', amount: '3.67', currency: 'AED' },
        { itemCode: 'SWAP_FLAT_FEE', amount: '2.00', currency: 'AED' },
      ]);
      for (const line of view.feeLines) {
        expect(Object.keys(line).sort()).toEqual(['amount', 'currency', 'itemCode']);
      }

      // 市场价 = fx.baseRate 原样字符串；点差 = fx.markupBps / 100（10bp = 0.1%）。
      expect(view.marketRate).toBe('3.6725');
      expect(view.spreadPercent).toBe(0.1);

      // fx 技术字段（endpoint/symbol/bid/ask）+ matched 内部 UUID（pairId/tierId）
      // 禁止透传：整个 feeBreakdown 原包都不应出现在视图里。
      expect(view).not.toHaveProperty('feeBreakdown');
      expect(JSON.stringify(view)).not.toContain('bookTicker');
      expect(JSON.stringify(view)).not.toContain('USDTAED');
      expect(JSON.stringify(view)).not.toContain('pair-uuid-1');
      expect(JSON.stringify(view)).not.toContain('tier-uuid-1');

      // 禁入清单（白名单放行制）：statusHistory 原文 / 合规调查字段 / TB 内部
      // 转账 id / traceId / owner 内部字段等一个不漏。
      for (const k of [
        'statusHistory',
        'needsReview',
        'currentStage',
        'correlationId',
        'l1Snapshot',
        'slaDeadline',
        'slaBreached',
        'ownerType',
        'ownerId',
        'ownerNo',
        'quoteId',
        'quoteSnapshotRef',
        'sumsubTxnIdOut',
        'sumsubTxnIdIn',
        'complianceVerdict',
        'complianceAction',
        'complianceRuleNames',
        'sumsubDetailJson',
        'rejectReason',
        'sumsubScore',
        'sumsubScoredAt',
        'sumsubTxnType',
        'spreadAmount',
        'grossAedValue',
        'failureReason',
        'tbFromTransferId',
        'tbToTransferId',
        'tbFeeTransferId',
        'tbSpreadTransferId',
        'traceId',
      ]) {
        expect(view).not.toHaveProperty(k);
      }
    });

    it('feeBreakdown 为 null → feeLines/marketRate/spreadPercent 均为空/null（不抛）', () => {
      const row = {
        id: 'swp-2',
        swapNo: 'SWP0002',
        quoteNo: null,
        status: 'SUCCESS',
        fromAmount: '100',
        toAmount: '366.88',
        netToAmount: '361.21',
        feeAmount: '5.67',
        feeCurrency: 'AED',
        exchangeRate: '3.6688',
        createdAt: new Date('2026-09-15T10:00:00.000Z'),
        completedAt: new Date('2026-09-15T10:05:00.000Z'),
        feeBreakdown: null,
        statusHistory: '[]',
        fromAsset: { code: 'USDT-TRON', currency: 'USDT', network: 'TRON', decimals: 6 },
        toAsset: { code: 'AED', currency: 'AED', network: null, decimals: 2 },
      };

      const view: any = (service as any).toCustomerSwapView(row);

      expect(view.feeLines).toEqual([]);
      expect(view.marketRate).toBeNull();
      expect(view.spreadPercent).toBeNull();
      expect(view.quoteNo).toBeNull();
    });

    it('feeBreakdown 是坏 JSON → 不抛，三键都是空/null 兜底', () => {
      const row = {
        id: 'swp-3',
        swapNo: 'SWP0003',
        quoteNo: 'SQT3',
        status: 'REJECTED',
        fromAmount: '100',
        toAmount: '366.88',
        netToAmount: '361.21',
        feeAmount: '5.67',
        feeCurrency: 'AED',
        exchangeRate: '3.6688',
        createdAt: new Date('2026-09-15T10:00:00.000Z'),
        completedAt: new Date('2026-09-15T10:05:00.000Z'),
        feeBreakdown: '{not valid json',
        statusHistory: '[]',
        fromAsset: { code: 'USDT-TRON', currency: 'USDT', network: 'TRON', decimals: 6 },
        toAsset: { code: 'AED', currency: 'AED', network: null, decimals: 2 },
      };

      const view: any = (service as any).toCustomerSwapView(row);

      expect(view.feeLines).toEqual([]);
      expect(view.marketRate).toBeNull();
      expect(view.spreadPercent).toBeNull();
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditLogsService } from '../audit-logging/audit-logs.service';
import { AccessControlService } from '../identity/access-control/access-control.service';
import { AdminPermissionGuard } from '../identity/access-control/admin-permission.guard';
import { AccountingService } from '../accounting/tigerbeetle/accounting.service';
import { FundsFlowAggregatorPort } from './domain/funds-flow-aggregator.port';
import { FundsFlowService } from './domain/funds-flow.service';
import { InternalTransferService } from './domain/internal-transfer.service';
import { WhitelistGuard } from './guards/whitelist.guard';
import { FundsAccountingService } from './accounting/funds-accounting.service';
import { MockCustodianExecutionAdapter } from './adapters/mock-custodian-execution.adapter';
import { InternalTransferWorkflowService } from './workflow/internal-transfer-workflow.service';
import { FiatSettlementWorkflowService } from './workflow/fiat-settlement-workflow.service';
import { FiatFeeCollectionWorkflowService } from './workflow/fiat-fee-collection-workflow.service';
import { EodSettlementWorkflowService } from './workflow/eod-settlement-workflow.service';
import { FeeAccrualService } from './domain/fee-accrual.service';
import { FxEodService } from './accounting/fx-eod.service';
import { BinanceRateProvider } from '../trading/pricing-center/providers/binance-rate.provider';
import { SettlementBatchService } from './domain/settlement-batch.service';
import { OutstandingConsumerService } from './domain/outstanding-consumer.service';
import { SystemWalletResolver } from './domain/system-wallet-resolver.service';
import { InternalTransferAdminController } from './controllers/internal-transfer-admin.controller';
import { FundsSimulateController } from './controllers/funds-simulate.controller';
import { WalletBalanceService } from '../asset-treasury/wallets/wallet-balance.service';

/**
 * DI boot smoke test for the funds-layer module wiring.
 *
 * Booting the real FundsLayerModule would pull in PrismaService's DB connection
 * plus the app-global AuditLogsModule / AccessControlModule / EventEmitterModule
 * which are out of scope in an isolated TestingModule. Instead we replicate the
 * module's EXACT provider + controller arrays here, overriding only the leaf
 * externals with light mocks. The real `{ provide: FundsFlowAggregatorPort,
 * useExisting: InternalTransferService }` binding and the real service classes
 * are kept — so this still catches the port-binding / circular-DI mistakes the
 * wiring could introduce.
 */
describe('FundsLayerModule wiring', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      controllers: [InternalTransferAdminController, FundsSimulateController],
      providers: [
        FundsFlowService,
        InternalTransferService,
        WhitelistGuard,
        FundsAccountingService,
        MockCustodianExecutionAdapter,
        InternalTransferWorkflowService,
        FiatSettlementWorkflowService,
        FiatFeeCollectionWorkflowService,
        // Real EOD workflow + FeeAccrualService prove the settle-on-CLEAR wiring
        // edge (EodSettlementWorkflowService → FeeAccrualService) resolves with
        // no circular DI.
        EodSettlementWorkflowService,
        FeeAccrualService,
        FxEodService,
        SettlementBatchService,
        OutstandingConsumerService,
        SystemWalletResolver,
        { provide: FundsFlowAggregatorPort, useExisting: InternalTransferService },
        // Leaf externals (app-global in production) mocked here:
        { provide: PrismaService, useValue: {} },
        { provide: AuditLogsService, useValue: {} },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: AccessControlService, useValue: {} },
        { provide: AccountingService, useValue: {} },
        { provide: WalletBalanceService, useValue: { adjust: jest.fn() } },
        { provide: BinanceRateProvider, useValue: {} },
        AdminPermissionGuard,
      ],
    }).compile();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('resolves InternalTransferWorkflowService (so @OnEvent listener registers)', () => {
    expect(moduleRef.get(InternalTransferWorkflowService)).toBeDefined();
  });

  it('resolves FundsFlowService with the aggregator port bound', () => {
    expect(moduleRef.get(FundsFlowService)).toBeDefined();
  });

  it('binds FundsFlowAggregatorPort to the concrete InternalTransferService (useExisting, no circular DI)', () => {
    expect(moduleRef.get(FundsFlowAggregatorPort)).toBe(
      moduleRef.get(InternalTransferService),
    );
  });

  it('provides FiatSettlementWorkflowService', () => {
    expect(moduleRef.get(FiatSettlementWorkflowService)).toBeDefined();
  });

  it('provides FiatFeeCollectionWorkflowService', () => {
    expect(moduleRef.get(FiatFeeCollectionWorkflowService)).toBeDefined();
  });

  it('resolves EodSettlementWorkflowService with FeeAccrualService injected (no circular DI)', () => {
    expect(moduleRef.get(EodSettlementWorkflowService)).toBeDefined();
    expect(moduleRef.get(FeeAccrualService)).toBeDefined();
  });
});

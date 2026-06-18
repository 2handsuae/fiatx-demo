import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import {
  EXTERNAL_BALANCE_PROVIDER,
  EXTERNAL_TX_PROVIDER,
  ExternalBalanceProvider,
  ExternalTxProvider,
} from '../adapters/external-data.provider';
import { BalanceSnapshotService } from '../engine/balance-snapshot.service';
import { InvariantCheckerService } from '../engine/invariant-checker.service';
import { InTransitService } from '../engine/in-transit.service';
import { BalanceReconService } from '../engine/balance-recon.service';
import { MatchEngineService } from '../engine/match-engine.service';
import { ClassifierService } from '../engine/classifier.service';
import { InternalActionsService } from '../engine/internal-actions.service';
import { ReconciliationRunService } from '../domain/reconciliation-run.service';
import { ReconciliationCaseService } from '../domain/reconciliation-case.service';
import { ReconciliationRecordService } from '../domain/reconciliation-record.service';
import { AuditLogsService } from '../../../audit-logging/audit-logs.service';
import { AuditActions, AuditEntityTypes, AuditBusinessWorkflowTypes } from '../../../audit-logging/constants/audit-actions.constant';
import { LAYER_ASSET_CODE } from '../constants/reconciliation.constants';

export interface RunInput { businessDate: string; layer: 'CRYPTO' | 'FIAT'; triggerType: string; mode: 'DRY_RUN' | 'APPLY'; }

@Injectable()
export class ReconciliationRunWorkflowService {
  private readonly logger = new Logger(ReconciliationRunWorkflowService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshot: BalanceSnapshotService,
    private readonly invariants: InvariantCheckerService,
    private readonly inTransit: InTransitService,
    @Inject(EXTERNAL_BALANCE_PROVIDER) private readonly balanceProvider: ExternalBalanceProvider,
    @Inject(EXTERNAL_TX_PROVIDER) private readonly txProvider: ExternalTxProvider,
    private readonly balanceRecon: BalanceReconService,
    private readonly matchEngine: MatchEngineService,
    private readonly classifier: ClassifierService,
    private readonly internalActions: InternalActionsService,
    private readonly runSvc: ReconciliationRunService,
    private readonly caseSvc: ReconciliationCaseService,
    private readonly recordSvc: ReconciliationRecordService,
    private readonly audit: AuditLogsService,
  ) {}

  async run(input: RunInput) {
    // 0 守门：V7 EOD 完成
    const batch = await this.prisma.settlementBatch.findFirst({
      where: { status: 'COMPLETED' }, orderBy: { createdAt: 'desc' },
    });
    if (!batch && input.layer === 'CRYPTO') {
      this.logger.warn(`V7 EOD not complete for ${input.businessDate}; skip`);
      return { skipped: true, cases: [] as any[] };
    }

    const cutoff = new Date(`${input.businessDate}T00:00:00.000Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() + 1); // T+1 00:00 = T+0 24:00

    const assets = await this.prisma.asset.findMany({
      where: { type: input.layer }, select: { id: true, currency: true, type: true },
    });

    // DRY_RUN 不落库（spec §6.3）：只在 APPLY 时创建 run 行，dry-run 全程在内存计算。
    const run = input.mode === 'APPLY' ? await this.runSvc.createRun(input) : null;
    const results: any[] = [];
    let invariantFail = false, openedCount = 0;

    for (const asset of assets) {
      const ccy = asset.currency;
      // 1 snapshot
      const bal = await this.snapshot.balancesAtCutoff(ccy, cutoff);
      // 2 invariant I1–I4
      const i14 = this.invariants.check(ccy, input.layer, bal);
      // 3 external + 4 in-transit
      const externalActual = await this.balanceProvider.balanceAt(ccy, asset.id, cutoff);
      const inTransitAdj = input.layer === 'CRYPTO'
        ? await this.inTransit.computeCrypto(ccy, asset.id, cutoff)
        : await this.inTransit.computeFiat(ccy, asset.id, cutoff);
      const tb = bal[LAYER_ASSET_CODE[input.layer]] ?? new Prisma.Decimal(0);
      // 5 I5
      const i5 = this.balanceRecon.computeI5(ccy, tb, externalActual, inTransitAdj);
      // 6 match + 7 classify
      const internal = await this.internalActions.collect(asset.id, input.businessDate, cutoff);
      const external = await this.txProvider.txsForDate(ccy, asset.id, input.businessDate);
      const matchRes = this.matchEngine.match(internal, external);
      const drafts = this.classifier.classify(matchRes);
      // 8 闭合自检
      const sumUnmatched = drafts.reduce((s, d) => s.plus(d.signedDelta), new Prisma.Decimal(0));
      const closes = sumUnmatched.minus(i5.delta).abs().lessThan('0.01');
      if (!closes) {
        this.logger.error(`CLOSURE FAIL ${ccy}: Σunmatched=${sumUnmatched} I5delta=${i5.delta}`);
      }
      const allChecks = [...i14, i5];
      if (allChecks.some(c => c.status === 'FAIL' && c.invariantCode !== 'I5')) invariantFail = true;

      results.push({ asset, ccy, bal, checks: allChecks, i5, drafts, closes, externalActual, inTransitAdj, tb });
    }

    // APPLY：落库；DRY_RUN：跳过
    if (input.mode === 'APPLY' && run) {
      await this.prisma.$transaction(async (tx) => {
        for (const r of results) {
          for (const c of r.checks) await this.recordSvc.saveInvariantCheck(run.id, c, tx);
          const hasBreak = !r.i5.delta.abs().lessThan('0.000001') || r.drafts.length > 0;
          if (hasBreak) {
            const kase = await this.caseSvc.upsertOpen({
              businessDate: input.businessDate, assetId: r.asset.id, assetCode: r.ccy, layer: input.layer,
              tbAmount: r.tb, inTransitAmount: r.inTransitAdj, expectedExternal: r.i5.expectedExternal,
              actualExternal: r.externalActual, deltaAmount: r.i5.delta, openedByRunId: run.id,
            }, tx);
            await this.recordSvc.saveLineItems(kase.id, run.id, r.drafts, tx);
            openedCount += 1;
          }
        }
        await this.runSvc.finish(run.id, {
          status: 'COMPLETED', invariantStatus: invariantFail ? 'FAIL' : 'PASS',
          openedCount, reObservedCount: 0, closedCount: 0,
        }, tx);
      });
      await this.audit.recordSystem({
        action: AuditActions.RECON_RUN_COMPLETED,
        entityType: AuditEntityTypes.RECONCILIATION_RUN_V8,
        entityId: run.id, entityNo: run.runNo,
        workflowType: AuditBusinessWorkflowTypes.V8_RECONCILIATION,
        traceId: run.traceId ?? undefined,
        reason: `Reconciliation ${input.layer} ${input.businessDate}: opened=${openedCount}`,
        metadata: { businessDate: input.businessDate, layer: input.layer, openedCount },
        sourcePlatform: 'SYSTEM',
      });
    }

    return { runNo: run?.runNo ?? '(dry-run)', mode: input.mode, cases: results.map(r => ({ ccy: r.ccy, delta: r.i5.delta, lineItems: r.drafts.length, closes: r.closes })) };
  }
}

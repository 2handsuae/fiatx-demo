import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { FormulaReconService, FormulaReconCurrencyResult } from './formula-recon.service';
import { DrilldownMatchService, DrilldownResult } from '../engine/drilldown-match.service';
import { ClassifiedLineItem } from '../engine/anomaly-classifier.service';
import { FormulaResult } from '../engine/formula-checker.service';
import { ReconciliationRunService } from '../domain/reconciliation-run.service';
import { ReconciliationCaseService } from '../domain/reconciliation-case.service';
import { ReconciliationRedesignRecordService } from '../domain/reconciliation-redesign-record.service';
import { AuditLogsService } from '../../../audit-logging/audit-logs.service';
import { WalletReconRunService } from './wallet-recon-run.service';

export interface RedesignReconInput {
  /** 业务日 D（YYYY-MM-DD）。 */
  businessDate: string;
  /** SCHEDULED | MANUAL | POST_FIX。 */
  triggerType: string;
  /** DRY_RUN（默认，0 落库）| APPLY（落库）。 */
  mode: 'DRY_RUN' | 'APPLY';
  /** external_balances.cutoff_date（默认 = businessDate）。 */
  cutoffDateForExternal?: string;
  /** 演示模式 manifest（recon-demo 脚本注入）；APPLY 时 JSON 序列化后落 ReconciliationRun.demoManifest。 */
  demoManifest?: unknown;
}

/** 单币种装配结果（五公式 G4 + 下钻四桶 G5）。已废弃；保留以满足历史调用方的类型签名。 */
export interface RedesignCurrencyResult {
  currency: string;
  assetId: string;
  layer: 'CRYPTO' | 'FIAT';
  /** 五公式（式1..式5）逐式 PASS/FAIL + delta。 */
  formulas: FormulaResult[];
  /** 下钻四桶定性（PASS / AMOUNT_MISMATCH / ORPHAN_INTERNAL / ORPHAN_EXTERNAL / MANUAL）。 */
  drilldown: DrilldownResult;
  /** 是否有 break：式4/式5 FAIL（账外 delta>容差）或任一桶有 break line item。 */
  hasBreak: boolean;
  /** 净差（式5 公司账外 delta 优先，回落式4）—— Case.deltaAmount 来源 + Reimbursement 判别。 */
  netDelta: Prisma.Decimal;
}

export interface RedesignReconRunResult {
  runNo: string;
  mode: 'DRY_RUN' | 'APPLY';
  businessDate: string;
  /** Legacy V8 per-currency assembly. Always empty under the wallet engine — see service-class JSDoc. */
  currencies: RedesignCurrencyResult[];
  openedCount: number;
}

/**
 * @deprecated V8 five-formula engine; replaced by WalletReconRunService (Phase B, 2026-06-26). Phase C will remove.
 *
 * Phase B (T9) shim: this orchestrator no longer runs the five-formula engine. All public `run(...)` calls are
 * routed to {@link WalletReconRunService} (engineVersion='WALLET_V1'). The original constructor dependencies
 * (FormulaReconService / DrilldownMatchService / RunService / CaseService / RecordService / Audit) remain
 * declared but unused so the DI graph in `reconciliation.module.ts` is undisturbed and the module exports
 * keep their existing shape until Phase C removes this file outright.
 *
 * Return-shape adapter: the wallet engine returns a leaner result
 * (`{ runId, status, walletsChecked, casesOpened, ... }`). We re-read the persisted ReconciliationRun row
 * by id to recover `runNo`, then synthesize the legacy envelope `{ runNo, mode, businessDate, currencies: [],
 * openedCount }`. The legacy per-currency `currencies[]` slot is intentionally empty — V8 five-formula
 * results have no equivalent in the per-wallet world. The `/admin/reconciliation/redesign/latest` page
 * reads from DB (layer='REDESIGN'), so it surfaces historical V8 runs untouched; any new run created via
 * this shim shows up under layer='WALLET' instead.
 */
@Injectable()
export class RedesignReconRunService {
  private readonly logger = new Logger(RedesignReconRunService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Legacy V8 collaborators retained for DI-graph stability; intentionally unused by `run()`.
    private readonly formulaRecon: FormulaReconService,
    private readonly drilldown: DrilldownMatchService,
    private readonly runSvc: ReconciliationRunService,
    private readonly caseSvc: ReconciliationCaseService,
    private readonly recordSvc: ReconciliationRedesignRecordService,
    private readonly audit: AuditLogsService,
    private readonly walletReconRun: WalletReconRunService,
  ) {}

  /** layer 标签：五公式跑全币种，run 行 layer 用 REDESIGN 区分于旧 CRYPTO/FIAT 分层路径。 */
  private static readonly RUN_LAYER = 'REDESIGN';

  async run(input: RedesignReconInput): Promise<RedesignReconRunResult> {
    this.logger.warn(
      `[V8 deprecated] RedesignReconRunService.run called (businessDate=${input.businessDate}, mode=${input.mode}); ` +
        `delegating to WalletReconRunService.`,
    );

    // Map legacy input → wallet input. We use `cutoffDateForExternal` (when provided) as the cutoff date,
    // otherwise the business date. Either way we pin to T+1 00:00 UTC so the cutoff covers the full
    // business day — matches the original V8 orchestrator's `cutoff.setUTCDate(+1)` semantics.
    const cutoffDay = input.cutoffDateForExternal ?? input.businessDate;
    const cutoff = new Date(`${cutoffDay}T00:00:00.000Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() + 1);

    // DRY_RUN: legacy contract is "0 落库, 纯内存返回". The wallet engine always persists, so we honor
    // DRY_RUN by short-circuiting before the delegation — return the legacy stub envelope.
    if (input.mode !== 'APPLY') {
      return {
        runNo: '(dry-run)',
        mode: 'DRY_RUN',
        businessDate: input.businessDate,
        currencies: [],
        openedCount: 0,
      };
    }

    // APPLY: delegate. The new run row gets engineVersion='WALLET_V1' automatically (stamped by
    // WalletReconRunService.createRun in T7).
    const walletRes = await this.walletReconRun.run({ cutoff, manifest: input.demoManifest });

    // Re-read the run row to recover runNo (the wallet result returns id only).
    const runRow = await (this.prisma as any).reconciliationRun.findUnique({
      where: { id: walletRes.runId },
      select: { runNo: true },
    });

    return {
      runNo: runRow?.runNo ?? walletRes.runId,
      mode: 'APPLY',
      businessDate: input.businessDate,
      currencies: [],
      openedCount: walletRes.casesOpened,
    };
  }

  // ── Legacy helpers retained for tests / historical reads. Not invoked by `run()`. ──────────────

  /** @deprecated V8 helper; retained only to avoid breaking imports. Never called by `run()`. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private assemble(_fr: FormulaReconCurrencyResult, _drilldown: DrilldownResult): RedesignCurrencyResult {
    throw new Error('V8 deprecated: RedesignReconRunService.assemble is no longer used.');
  }

  /** @deprecated V8 helper; retained only to avoid breaking imports. Never called by `run()`. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private bookSlice(
    _c: RedesignCurrencyResult,
    _book: 'CLIENT' | 'FIRM',
  ): { hasBreak: boolean; items: ClassifiedLineItem[]; lhs: Prisma.Decimal; rhs: Prisma.Decimal; netDelta: Prisma.Decimal } {
    throw new Error('V8 deprecated: RedesignReconRunService.bookSlice is no longer used.');
  }
}

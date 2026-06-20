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
import {
  AuditActions,
  AuditEntityTypes,
  AuditBusinessWorkflowTypes,
} from '../../../audit-logging/constants/audit-actions.constant';

export interface RedesignReconInput {
  /** 业务日 D（YYYY-MM-DD）。 */
  businessDate: string;
  /** SCHEDULED | MANUAL | POST_FIX。 */
  triggerType: string;
  /** DRY_RUN（默认，0 落库）| APPLY（落库）。 */
  mode: 'DRY_RUN' | 'APPLY';
  /** external_balances.cutoff_date（默认 = businessDate）。 */
  cutoffDateForExternal?: string;
}

/** 单币种装配结果（五公式 G4 + 下钻四桶 G5）。 */
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
  currencies: RedesignCurrencyResult[];
  openedCount: number;
}

const TOLERANCE = new Prisma.Decimal('0.000001');

/**
 * 对账重构编排器（spec 2026-06-20 收口组 G6）。**编排 + 持久化**，不重造引擎：
 *   ① G4 五公式（FormulaReconService）— 每币种 式1..式5（credit-net 口径，§3）。
 *   ② G5 下钻四桶（DrilldownMatchService）— 每币种 投影→匹配→定性（§4）。
 * 装配成 per-currency 结果，DRY_RUN 默认 0 落库（与旧 workflow §6.3 一致）；APPLY 落到既有 recon 表：
 *   - ReconciliationRun（run 行 + invariantStatus = 五公式整体 PASS/FAIL）。
 *   - ReconciliationInvariantCheck（每币种 5 行：式1..式5，复用既有表，invariantCode 承载 式N）。
 *   - 式4/式5 FAIL 或桶有 break → ReconciliationCase（per businessDate+asset，净差落 deltaAmount）。
 *   - bucketed line items（六类下钻输出）→ ReconciliationLineItem（串链 traceId，§4.4）。
 *
 * 串链 + Reimbursement（§4.4）：净差 > 容差建 Case；公司欠/被欠走 ReimbursementObligation。
 *   ⚠ ReimbursementObligation 模型已于 migration 20260617203304 整表 DROP（无 prisma delegate / 无 service）。
 *   本编排器只**保留 hook**：在 Case 上标注是否需要 reimbursement（needsReimbursement），Case.reimbursementObligationId
 *   列保留为 null + 明确 TODO；不重建已废弃的模型（避免半拉子）。详见 maybeFlagReimbursement()。
 */
@Injectable()
export class RedesignReconRunService {
  private readonly logger = new Logger(RedesignReconRunService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly formulaRecon: FormulaReconService,
    private readonly drilldown: DrilldownMatchService,
    private readonly runSvc: ReconciliationRunService,
    private readonly caseSvc: ReconciliationCaseService,
    private readonly recordSvc: ReconciliationRedesignRecordService,
    private readonly audit: AuditLogsService,
  ) {}

  /** layer 标签：五公式跑全币种，run 行 layer 用 REDESIGN 区分于旧 CRYPTO/FIAT 分层路径。 */
  private static readonly RUN_LAYER = 'REDESIGN';

  async run(input: RedesignReconInput): Promise<RedesignReconRunResult> {
    const businessDate = input.businessDate;
    const cutoff = new Date(`${businessDate}T00:00:00.000Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() + 1); // T+1 00:00 = D 24:00（与 G4/G5 cutoff 口径一致）

    // ── ① G4 五公式（全币种） ──
    const formulaResults = await this.formulaRecon.runFormulas(businessDate, input.cutoffDateForExternal);

    // ── ② G5 下钻四桶（逐币种） + 装配 ──
    const currencies: RedesignCurrencyResult[] = [];
    for (const fr of formulaResults) {
      const drilldown = await this.drilldown.run({
        currency: fr.currency,
        businessDate,
        cutoff,
        assetId: fr.assetId,
      });
      currencies.push(this.assemble(fr, drilldown));
    }

    const overallPass = currencies.every((c) => c.formulas.every((f) => f.status === 'PASS'));

    // ── DRY_RUN：0 落库，纯内存返回（默认） ──
    if (input.mode !== 'APPLY') {
      return {
        runNo: '(dry-run)',
        mode: 'DRY_RUN',
        businessDate,
        currencies,
        openedCount: currencies.filter((c) => c.hasBreak).length,
      };
    }

    // ── APPLY：落到既有 recon 表（单事务） ──
    const run = await this.runSvc.createRun({
      businessDate,
      layer: RedesignReconRunService.RUN_LAYER,
      triggerType: input.triggerType,
      mode: 'APPLY',
    });

    let openedCount = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const c of currencies) {
        // 五公式 → invariant_checks（每币种 5 行）。
        await this.recordSvc.saveFormulaChecks(run.id, c.formulas, tx);

        if (c.hasBreak) {
          const kase = await this.caseSvc.upsertOpen(
            {
              businessDate,
              assetId: c.assetId,
              assetCode: c.currency,
              layer: c.layer,
              // 五公式世界没有旧 I5 的 expected/actual 三段；把净差落 deltaAmount，其余置 0（schema 默认）。
              tbAmount: this.formulaLhs(c, '式5') ?? new Prisma.Decimal(0),
              inTransitAmount: new Prisma.Decimal(0),
              expectedExternal: this.formulaRhs(c, '式5') ?? new Prisma.Decimal(0),
              actualExternal: this.formulaRhs(c, '式4') ?? new Prisma.Decimal(0),
              deltaAmount: c.netDelta,
              openedByRunId: run.id,
            },
            tx,
          );
          // 六类桶 line items（含串链 traceId）→ line_items。
          await this.recordSvc.saveBucketedLineItems(kase.id, run.id, this.collectBreakItems(c), tx);
          // Reimbursement hook（§4.4）：仅标注，不建已废弃模型。
          await this.maybeFlagReimbursement(kase.id, c, tx);
          openedCount += 1;
        }
      }

      await this.runSvc.finish(
        run.id,
        {
          status: 'COMPLETED',
          invariantStatus: overallPass ? 'PASS' : 'FAIL',
          openedCount,
          reObservedCount: 0,
          closedCount: 0,
        },
        tx,
      );
    });

    await this.audit.recordSystem({
      action: AuditActions.RECON_RUN_COMPLETED,
      entityType: AuditEntityTypes.RECONCILIATION_RUN_V8,
      entityId: run.id,
      entityNo: run.runNo,
      workflowType: AuditBusinessWorkflowTypes.V8_RECONCILIATION,
      traceId: run.traceId ?? undefined,
      reason: `Redesign reconciliation ${businessDate}: formulas=${overallPass ? 'PASS' : 'FAIL'} opened=${openedCount}`,
      metadata: { businessDate, layer: RedesignReconRunService.RUN_LAYER, openedCount, mode: 'APPLY' },
      sourcePlatform: 'SYSTEM',
    });

    return { runNo: run.runNo, mode: 'APPLY', businessDate, currencies, openedCount };
  }

  /* ── 装配 helpers ──────────────────────────────────────────── */

  private assemble(fr: FormulaReconCurrencyResult, drilldown: DrilldownResult): RedesignCurrencyResult {
    const s = drilldown.classified.summary;
    const bucketBreaks = s.amountMismatch + s.orphanInternal + s.orphanExternal;
    // 账外失衡：式4(客户) / 式5(公司) FAIL。
    const f4 = fr.results.find((r) => r.formula === '式4');
    const f5 = fr.results.find((r) => r.formula === '式5');
    const offBookFail =
      (f4?.status === 'FAIL') || (f5?.status === 'FAIL');
    const hasBreak = offBookFail || bucketBreaks > 0;
    // 净差：式5 公司账外 delta 优先（公司欠/被欠口径），无则回落式4。
    const netDelta = f5?.delta ?? f4?.delta ?? new Prisma.Decimal(0);
    return {
      currency: fr.currency,
      assetId: fr.assetId,
      layer: fr.layer,
      formulas: fr.results,
      drilldown,
      hasBreak,
      netDelta,
    };
  }

  /** 把四桶 break line items 拍平成一串（PASS/INTERNAL_BOOK_LEG 非 break，不入 Case）。 */
  private collectBreakItems(c: RedesignCurrencyResult): ClassifiedLineItem[] {
    const cl = c.drilldown.classified;
    return [...cl.amountMismatch, ...cl.orphanInternal, ...cl.orphanExternal, ...cl.manual];
  }

  private formulaLhs(c: RedesignCurrencyResult, code: FormulaResult['formula']): Prisma.Decimal | undefined {
    return c.formulas.find((f) => f.formula === code)?.lhs;
  }
  private formulaRhs(c: RedesignCurrencyResult, code: FormulaResult['formula']): Prisma.Decimal | undefined {
    return c.formulas.find((f) => f.formula === code)?.rhs;
  }

  /**
   * Reimbursement hook（§4.4：公司欠/被欠走 ReimbursementObligation，CFO/MLRO 审批 + TB 补 CLIENT_PAYABLE）。
   *
   * TODO(reimbursement): ReimbursementObligation 模型已于 migration 20260617203304 整表 DROP（无 prisma
   *   delegate、无 service、无 controller）。重建是独立的一大块（模型 + 迁移 + 审批流 + 资金侧内部转账 + TB 补
   *   分录），不在本收口组范围。当前只保留 hook：
   *     - 判别「需要 reimbursement」= 净差 > 容差（公司侧账外失衡 → 公司欠客户 或 客户欠公司）。
   *     - Case.reimbursementObligationId 列已在 schema 保留（FK 占位），此处置 null + 记一条 audit 标注。
   *   待 ReimbursementObligation 复活后，把这里替换成：创建 obligation → 回填 reimbursementObligationId。
   */
  private async maybeFlagReimbursement(
    caseId: string,
    c: RedesignCurrencyResult,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const needsReimbursement = c.netDelta.abs().greaterThan(TOLERANCE);
    if (!needsReimbursement) return;
    // hook：仅记录意图，不建已废弃模型。reimbursementObligationId 保持 null。
    this.logger.warn(
      `[reimbursement-hook] Case ${caseId} (${c.currency}) netDelta=${c.netDelta} > tol — ` +
        `company owes/owed; ReimbursementObligation model retired (migration 20260617203304), TODO wire when revived.`,
    );
    await tx.reconciliationCase.update({
      where: { id: caseId },
      data: { reimbursementObligationId: null }, // 显式 hook：占位 FK，待 obligation 复活回填
    });
  }
}

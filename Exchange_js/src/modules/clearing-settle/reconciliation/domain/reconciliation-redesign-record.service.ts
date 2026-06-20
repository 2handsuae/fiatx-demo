import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { FormulaResult } from '../engine/formula-checker.service';
import { ClassifiedLineItem } from '../engine/anomaly-classifier.service';

/**
 * 对账重构持久化 writer（spec 2026-06-20 G6）。复用既有 recon 表，把五公式 + 四桶世界落进去：
 *   - 五公式（式1..式5）→ ReconciliationInvariantCheck（invariantCode 承载 式N，复用既有表，避免新表）。
 *   - 四桶 break line items → ReconciliationLineItem（matchStatus=bucket，串链 traceId 入 txHash 列）。
 *
 * 与旧 ReconciliationRecordService 区分：旧 writer 吃 InvariantResult/I5Result/LineItemDraft（I1-I5 世界）；
 * 本 writer 吃 FormulaResult/ClassifiedLineItem（五公式/四桶世界）。两套并存、各自纯增不互扰。
 */
@Injectable()
export class ReconciliationRedesignRecordService {
  constructor(private readonly prisma: PrismaService) {}

  /** 五公式逐式落 invariant_checks（每币种 5 行：式1..式5）。 */
  async saveFormulaChecks(
    runId: string,
    formulas: FormulaResult[],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    for (const f of formulas) {
      await db.reconciliationInvariantCheck.create({
        data: {
          runId,
          invariantCode: f.formula, // 式1 | 式2 | 式3 | 式4 | 式5
          currency: f.currency,
          lhsLabel: f.label,
          lhsValue: f.lhs,
          rhsLabel: 'RHS',
          rhsValue: f.rhs,
          delta: f.delta,
          status: f.status, // PASS | FAIL
          // 式1-3 账内（试算/勾稽）；式4-5 账外（vs 外部余额）。映射到既有 severity 语义。
          severity: f.formula === '式4' || f.formula === '式5' ? 'ACCOUNT_ACTUAL' : 'ATTESTATION',
        },
      });
    }
  }

  /**
   * 四桶 break line items 落 line_items（PASS/INTERNAL_BOOK_LEG 不入，由 orchestrator 过滤）。
   * 串链（§4.4）：externalRef（txHash/银行回显号）写入 internalTxHash/externalTxHash 列，回链源头流水。
   */
  async saveBucketedLineItems(
    caseId: string,
    runId: string,
    items: ClassifiedLineItem[],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    let lineNo = 0;
    for (const it of items) {
      lineNo += 1;
      await db.reconciliationLineItem.create({
        data: {
          caseId,
          foundByRunId: runId,
          lineNo,
          matchStatus: it.bucket, // PASS | AMOUNT_MISMATCH | ORPHAN_INTERNAL | ORPHAN_EXTERNAL | MANUAL
          status: 'OPEN',
          // 内部侧
          internalSourceType: it.internalSource ?? null,
          internalSourceId: it.internalSourceId ?? null,
          internalSourceNo: it.internalSourceNo ?? null,
          internalAmount: it.internalAmount ?? null,
          internalDirection: it.internalDirection ?? null,
          internalTxHash: it.externalRef ?? null, // 串链：内部腿 external_ref（txHash/referenceNo）
          // 外部侧
          externalSource: it.externalSource ?? null,
          externalTxId: it.externalId ?? null,
          externalTxHash: it.externalRef ?? null, // 串链：外部行 external_ref
          externalAmount: it.externalAmount ?? null,
          externalDirection: it.externalDirection ?? null,
          // resolutionMemo 承载定性（qualifier）+ sub_account 下钻 + 退汇 channel_ref。
          resolutionMemo: this.buildMemo(it),
        },
      });
    }
  }

  /** 定性 + 下钻定位摘要：qualifier / sub_account / channel_ref（退汇回链）/ signedDelta。 */
  private buildMemo(it: ClassifiedLineItem): string {
    const parts: string[] = [`qualifier=${it.qualifier}`, `signedδ=${it.signedDelta.toString()}`];
    const sub = it.internalSubAccount ?? it.externalSubAccount;
    if (sub) parts.push(`sub_account=${sub}`);
    if (it.channelRef) parts.push(`channel_ref=${it.channelRef}`);
    if (it.externalDescription) parts.push(`desc=${it.externalDescription}`);
    if (it.candidateCount != null) parts.push(`candidates=${it.candidateCount}`);
    return parts.join(' | ');
  }
}

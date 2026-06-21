// src/modules/funds-layer/accounting/fx-eod.service.ts
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { BinanceRateProvider } from '../../trading/pricing-center/providers/binance-rate.provider';
import { decimalToTbUnits, bigintToDecimal } from './tb-amount.util';
import { hexToBigint } from '../../accounting/tigerbeetle/utils/tb-id.util';

const BASE_CURRENCY = 'AED';
const EOD_ACCOUNTING_SOURCE = 'EOD_ACCOUNTING';
const FX_REALIZE_SOURCE = 'FX_REALIZE';

export interface InvariantViolation { invariant: string; currency: string; detail: string; }
export interface EodAccountingReport {
  sweeps: Array<{ currency: string; amountUnits: string; direction: 'OUT' | 'IN' }>;
  revals: Array<{ currency: string; fixing: string; deltaUnits: string; direction: 'LOSS' | 'GAIN' }>;
  violations: InvariantViolation[];
}

/**
 * Two-book EOD accounting: bridge sweep + daily FX revaluation + LP realize +
 * reconciliation invariants. All amounts are signed TB nets
 * (creditsPosted − debitsPosted) in integer units unless noted otherwise.
 *
 * Sweep and reval amounts are always recomputed from live TB balances, so a
 * replay with unchanged state computes 0 and posts nothing (semantic
 * idempotency). On top of that, the deterministic transfer id carries an
 * evidence-count sequence (`<EVENT>#<seq>`): a concurrent duplicate of the
 * SAME state dedupes in TB (`exists`), while a later incremental run of the
 * same batch (CLEAR handler firing as more swaps settle) gets a fresh id
 * instead of colliding with `exists_with_different_amount`.
 */
@Injectable()
export class FxEodService {
  private readonly logger = new Logger(FxEodService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly rateProvider: BinanceRateProvider,
  ) {}

  /**
   * Process-level serialization latch. CLEAR events are emitted without awaiting
   * async handlers, so two runs can interleave between the bridge-balance read and
   * the evidence-count id allocation — both would book the same sweep under
   * different seq ids (double booking). All entry points funnel through here.
   */
  private runChain: Promise<unknown> = Promise.resolve();

  /**
   * Combined sweep + reval entry point — retained for direct/legacy callers.
   * Settlement-triggered paths should use `runSweepOnly` (cost-basis sweep only,
   * no FX mark-to-market) or `runReval` (EOD mark-to-market after full batch
   * settlement) instead. The workflow no longer calls this method directly.
   *
   * EOD 物理结算完成后调用。batchNo 进 evidence sourceNo → 同批次幂等。
   */
  async runEodAccounting(batchNo: string): Promise<EodAccountingReport> {
    const run = this.runChain.then(
      () => this.doRunEodAccounting(batchNo),
      () => this.doRunEodAccounting(batchNo),
    );
    this.runChain = run.catch(() => {});
    return run;
  }

  private async doRunEodAccounting(batchNo: string): Promise<EodAccountingReport> {
    const report: EodAccountingReport = { sweeps: [], revals: [], violations: [] };
    await this.sweepBridges(batchNo, report);
    await this.revalueFxPositions(batchNo, report);
    await this.checkInvariants(report);
    this.logger.log(`EOD accounting ${batchNo}: ${JSON.stringify(report)}`);
    return report;
  }

  /** sweep-only (settlement-triggered path): cost-basis bridge sweep + invariants, NO reval. Serialized via runChain. */
  async runSweepOnly(batchNo: string): Promise<EodAccountingReport> {
    const run = this.runChain.then(
      () => this.doSweepOnly(batchNo),
      () => this.doSweepOnly(batchNo),
    );
    this.runChain = run.catch(() => {});
    return run;
  }

  private async doSweepOnly(batchNo: string): Promise<EodAccountingReport> {
    const report: EodAccountingReport = { sweeps: [], revals: [], violations: [] };
    await this.sweepBridges(batchNo, report);
    await this.checkInvariants(report);
    this.logger.log(`Sweep-only ${batchNo}: ${JSON.stringify(report)}`);
    return report;
  }

  /** reval (EOD-only): bridge sweep (catch stragglers) + mark-to-market + invariants. Serialized via runChain. */
  async runReval(batchNo: string): Promise<EodAccountingReport> {
    const run = this.runChain.then(
      () => this.doReval(batchNo),
      () => this.doReval(batchNo),
    );
    this.runChain = run.catch(() => {});
    return run;
  }

  private async doReval(batchNo: string): Promise<EodAccountingReport> {
    const report: EodAccountingReport = { sweeps: [], revals: [], violations: [] };
    await this.sweepBridges(batchNo, report);
    await this.revalueFxPositions(batchNo, report);
    await this.checkInvariants(report);
    this.logger.log(`Reval ${batchNo}: ${JSON.stringify(report)}`);
    return report;
  }

  /** 清桥:每币种 sweep = 桥净额 − open swap 桥贡献;转入 FX_POSITION。 */
  async sweepBridges(batchNo: string, report: EodAccountingReport): Promise<void> {
    const assets = await (this.prisma as any).asset.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, currency: true, decimals: true },
    });
    const openByCurrency = await this.computeOpenBridgeContributions();

    for (const asset of assets) {
      const ledger = (TB_LEDGERS as Record<string, number>)[asset.currency];
      if (!ledger) continue;

      const bridgeId = await this.accounting.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.TRADE_CLEARING, ledger, ownerType: 'SYSTEM',
      });
      const bal = await this.accounting.lookupBalance(bridgeId);
      const bridgeNet = bal.creditsPosted - bal.debitsPosted;
      const openNet = openByCurrency.get(asset.currency) ?? 0n;
      const sweep = bridgeNet - openNet;
      if (sweep === 0n) continue;

      const fxId = await this.accounting.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.FX_POSITION, ledger, ownerType: 'SYSTEM',
      });
      const out = sweep > 0n;
      const eventCode = await this.nextEventCode(batchNo, `BRIDGE_SWEEP_${asset.currency}`);
      await this.accounting.executeTransfer({
        debitAccountId: out ? bridgeId : fxId,
        creditAccountId: out ? fxId : bridgeId,
        amount: out ? sweep : -sweep,
        ledger,
        code: out ? TB_TRANSFER_CODES.BRIDGE_SWEEP_OUT : TB_TRANSFER_CODES.BRIDGE_SWEEP_IN,
        evidence: {
          sourceType: EOD_ACCOUNTING_SOURCE,
          sourceNo: batchNo,
          eventCode,
          debitCode: TB_CODE_TO_COA[out ? TB_ACCOUNT_CODES.TRADE_CLEARING : TB_ACCOUNT_CODES.FX_POSITION],
          creditCode: TB_CODE_TO_COA[out ? TB_ACCOUNT_CODES.FX_POSITION : TB_ACCOUNT_CODES.TRADE_CLEARING],
          assetCurrency: asset.currency,
          traceId: `EODACC:${batchNo}`,
          actorType: 'SYSTEM', actorId: 'SYSTEM',
          memo: 'Bridge sweep into FX position (settled swaps only)',
        },
      });
      report.sweeps.push({ currency: asset.currency, amountUnits: (out ? sweep : -sweep).toString(), direction: out ? 'OUT' : 'IN' });
    }
  }

  /**
   * open swap 桥贡献(signed,credits−debits 口径,units):
   * from 币 +fromAmount;to 币 −(toAmount(gross)+spreadAmount)。
   * open = swap 存在任一 Outstanding 状态 ≠ SETTLED。
   */
  private async computeOpenBridgeContributions(): Promise<Map<string, bigint>> {
    const openRows = await (this.prisma as any).outstanding.findMany({
      where: { status: { not: 'SETTLED' }, swapTransactionId: { not: null } },
      select: { swapTransactionId: true },
      distinct: ['swapTransactionId'],
    });
    const ids = openRows.map((o: any) => o.swapTransactionId);
    const map = new Map<string, bigint>();
    if (ids.length === 0) return map;

    const swaps = await (this.prisma as any).swapTransaction.findMany({
      where: { id: { in: ids } },
      select: {
        fromAmount: true, toAmount: true, spreadAmount: true,
        fromAsset: { select: { currency: true, decimals: true } },
        toAsset: { select: { currency: true, decimals: true } },
      },
    });
    for (const s of swaps) {
      const fromUnits = decimalToTbUnits(new Prisma.Decimal(s.fromAmount), s.fromAsset.decimals);
      const toUnits = decimalToTbUnits(
        new Prisma.Decimal(s.toAmount).add(new Prisma.Decimal(s.spreadAmount ?? 0)),
        s.toAsset.decimals,
      );
      map.set(s.fromAsset.currency, (map.get(s.fromAsset.currency) ?? 0n) + fromUnits);
      map.set(s.toAsset.currency, (map.get(s.toAsset.currency) ?? 0n) - toUnits);
    }
    return map;
  }

  /**
   * 重估:target AED 腿净额 = −Σ(非AED FX 腿净额 × fixing);差额 → FX_UNREALIZED_PNL(AED)。
   * delta = targetUnits − currentAedNetUnits;delta>0 = 亏(借 FX_UNREALIZED / 贷 FX_POSITION(AED)),
   * delta<0 = 赚(反向)。每日整仓重标,昨日 mark 被本次 delta 覆盖。
   */
  async revalueFxPositions(batchNo: string, report: EodAccountingReport): Promise<void> {
    const assets = await (this.prisma as any).asset.findMany({
      where: { status: 'ACTIVE' },
      select: { currency: true, decimals: true },
    });
    const aedLedger = (TB_LEDGERS as Record<string, number>)[BASE_CURRENCY];
    const aedAsset = assets.find((a: any) => a.currency === BASE_CURRENCY);
    if (!aedLedger || !aedAsset) return;

    let targetSum = new Prisma.Decimal(0);
    const fixings: Array<{ currency: string; fixing: string }> = [];

    for (const asset of assets) {
      if (asset.currency === BASE_CURRENCY) continue;
      const ledger = (TB_LEDGERS as Record<string, number>)[asset.currency];
      if (!ledger) continue;

      const fxId = await this.accounting.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.FX_POSITION, ledger, ownerType: 'SYSTEM',
      });
      const bal = await this.accounting.lookupBalance(fxId);
      const net = bal.creditsPosted - bal.debitsPosted;
      if (net === 0n) continue;

      const { rate } = await this.rateProvider.fetchRate(asset.currency, BASE_CURRENCY);
      targetSum = targetSum.add(bigintToDecimal(net, asset.decimals).mul(rate));
      fixings.push({ currency: asset.currency, fixing: rate.toString() });
    }

    const targetUnits = decimalToTbUnits(targetSum.neg(), aedAsset.decimals);

    const fxAedId = await this.accounting.resolveTbAccountId({
      code: TB_ACCOUNT_CODES.FX_POSITION, ledger: aedLedger, ownerType: 'SYSTEM',
    });
    const aedBal = await this.accounting.lookupBalance(fxAedId);
    const currentAedNetUnits = aedBal.creditsPosted - aedBal.debitsPosted;
    const delta = targetUnits - currentAedNetUnits;
    if (delta === 0n) return;

    const loss = delta > 0n;
    const unrealizedId = await this.accounting.resolveTbAccountId({
      code: TB_ACCOUNT_CODES.FX_UNREALIZED_PNL, ledger: aedLedger, ownerType: 'SYSTEM',
    });
    const eventCode = await this.nextEventCode(batchNo, 'FX_REVAL');
    await this.accounting.executeTransfer({
      debitAccountId: loss ? unrealizedId : fxAedId,
      creditAccountId: loss ? fxAedId : unrealizedId,
      amount: loss ? delta : -delta,
      ledger: aedLedger,
      code: loss ? TB_TRANSFER_CODES.FX_REVAL_LOSS : TB_TRANSFER_CODES.FX_REVAL_GAIN,
      evidence: {
        sourceType: EOD_ACCOUNTING_SOURCE,
        sourceNo: batchNo,
        eventCode,
        debitCode: TB_CODE_TO_COA[loss ? TB_ACCOUNT_CODES.FX_UNREALIZED_PNL : TB_ACCOUNT_CODES.FX_POSITION],
        creditCode: TB_CODE_TO_COA[loss ? TB_ACCOUNT_CODES.FX_POSITION : TB_ACCOUNT_CODES.FX_UNREALIZED_PNL],
        assetCurrency: BASE_CURRENCY,
        traceId: `EODACC:${batchNo}`,
        actorType: 'SYSTEM', actorId: 'SYSTEM',
        memo: `Daily FX reval to fixing (${fixings.map((f) => `${f.currency}@${f.fixing}`).join(',') || 'flat'})`,
      },
    });

    const deltaUnits = (loss ? delta : -delta).toString();
    const direction = loss ? 'LOSS' as const : 'GAIN' as const;
    if (fixings.length === 0) {
      // All foreign legs flat but a residual AED leg was re-marked.
      report.revals.push({ currency: BASE_CURRENCY, fixing: '1', deltaUnits, direction });
    } else {
      // Single aggregate AED entry; report one row per contributing currency
      // (in practice there is exactly one non-AED ledger).
      for (const f of fixings) {
        report.revals.push({ currency: f.currency, fixing: f.fixing, deltaUnits, direction });
      }
    }
  }

  /**
   * 平盘(demo/手动):全量平掉一个非 AED 头寸,fillRate=LP 成交价。
   * ① 币腿对 FIRM_TREASURY(currency ledger)清零;② AED 腿按 proceeds 对 FIRM_TREASURY(AED) 清,
   * 残值进 FX_REALIZED_PNL;③ FX_UNREALIZED 余额回转进 FX_REALIZED。
   * evidence sourceNo 含时间戳(平盘非幂等,允许)。
   */
  async realizeFxPosition(input: { currency: string; fillRate: Prisma.Decimal; operatorId: string }): Promise<void> {
    const { currency, fillRate, operatorId } = input;
    if (currency === BASE_CURRENCY) {
      throw new BadRequestException({
        code: 'FX_REALIZE_BASE_CURRENCY',
        message: 'Cannot realize the AED base leg directly — realize a foreign currency position',
      });
    }
    const ledger = (TB_LEDGERS as Record<string, number>)[currency];
    const aedLedger = (TB_LEDGERS as Record<string, number>)[BASE_CURRENCY];
    if (!ledger || !aedLedger) {
      throw new BadRequestException({
        code: 'FX_REALIZE_LEDGER_NOT_FOUND',
        message: `No TB ledger for currency ${currency}`,
      });
    }
    const curAsset = await (this.prisma as any).asset.findFirst({
      where: { currency, status: 'ACTIVE' }, select: { decimals: true },
    });
    const aedAsset = await (this.prisma as any).asset.findFirst({
      where: { currency: BASE_CURRENCY, status: 'ACTIVE' }, select: { decimals: true },
    });
    if (!curAsset || !aedAsset) {
      throw new NotFoundException({
        code: 'FX_REALIZE_ASSET_NOT_FOUND',
        message: `Active asset not found for ${currency} or ${BASE_CURRENCY}`,
      });
    }

    const fxCurId = await this.accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FX_POSITION, ledger, ownerType: 'SYSTEM' });
    const firmCurId = await this.accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FIRM_TREASURY, ledger, ownerType: 'SYSTEM' });
    const fxAedId = await this.accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FX_POSITION, ledger: aedLedger, ownerType: 'SYSTEM' });
    const firmAedId = await this.accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FIRM_TREASURY, ledger: aedLedger, ownerType: 'SYSTEM' });
    const realizedId = await this.accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FX_REALIZED_PNL, ledger: aedLedger, ownerType: 'SYSTEM' });
    const unrealizedId = await this.accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FX_UNREALIZED_PNL, ledger: aedLedger, ownerType: 'SYSTEM' });

    const curBal = await this.accounting.lookupBalance(fxCurId);
    const qty = curBal.creditsPosted - curBal.debitsPosted;
    const aedBal = await this.accounting.lookupBalance(fxAedId);
    const aedNet = aedBal.creditsPosted - aedBal.debitsPosted;
    const unrealBal = await this.accounting.lookupBalance(unrealizedId);
    const unrealDebitNet = unrealBal.debitsPosted - unrealBal.creditsPosted; // 借方为正 = 累计亏

    const isLong = qty > 0n;
    const qtyAbs = isLong ? qty : -qty;
    // Realize is intentionally NOT idempotent — each invocation is a fresh LP fill.
    const sourceNo = `${currency}:${Date.now()}`;
    const evidence = (eventCode: string, debitTbCode: number, creditTbCode: number, assetCurrency: string, memo: string) => ({
      sourceType: FX_REALIZE_SOURCE,
      sourceNo,
      eventCode,
      debitCode: TB_CODE_TO_COA[debitTbCode],
      creditCode: TB_CODE_TO_COA[creditTbCode],
      assetCurrency,
      traceId: `FXREALIZE:${sourceNo}`,
      actorType: 'ADMIN',
      actorId: operatorId,
      memo,
    });

    // ① 币腿清零:多头把币付给 LP(借 FX_POSITION / 贷 FIRM_TREASURY),空头反向。
    if (qtyAbs > 0n) {
      await this.accounting.executeTransfer({
        debitAccountId: isLong ? fxCurId : firmCurId,
        creditAccountId: isLong ? firmCurId : fxCurId,
        amount: qtyAbs,
        ledger,
        code: TB_TRANSFER_CODES.FX_REALIZE,
        evidence: evidence(
          'FX_REALIZE_CCY_LEG',
          isLong ? TB_ACCOUNT_CODES.FX_POSITION : TB_ACCOUNT_CODES.FIRM_TREASURY,
          isLong ? TB_ACCOUNT_CODES.FIRM_TREASURY : TB_ACCOUNT_CODES.FX_POSITION,
          currency,
          `Realize ${currency} position vs LP @ ${fillRate.toString()} (${isLong ? 'LONG' : 'SHORT'})`,
        ),
      });
    }

    // ② AED 腿按 LP 成交价清:多头收 LP 的钱(借 FIRM_TREASURY(AED) / 贷 FX_POSITION(AED)),空头反向。
    const proceeds = decimalToTbUnits(bigintToDecimal(qtyAbs, curAsset.decimals).mul(fillRate), aedAsset.decimals);
    if (proceeds > 0n) {
      await this.accounting.executeTransfer({
        debitAccountId: isLong ? firmAedId : fxAedId,
        creditAccountId: isLong ? fxAedId : firmAedId,
        amount: proceeds,
        ledger: aedLedger,
        code: TB_TRANSFER_CODES.FX_REALIZE,
        evidence: evidence(
          'FX_REALIZE_AED_LEG',
          isLong ? TB_ACCOUNT_CODES.FIRM_TREASURY : TB_ACCOUNT_CODES.FX_POSITION,
          isLong ? TB_ACCOUNT_CODES.FX_POSITION : TB_ACCOUNT_CODES.FIRM_TREASURY,
          BASE_CURRENCY,
          `LP proceeds for ${currency} realize`,
        ),
      });
    }

    // ③ 残值:② 过账后 AED 腿剩余净额清入 FX_REALIZED_PNL。
    //    aedAfter<0(净借方残留)= 亏:借 FX_REALIZED / 贷 FX_POSITION(AED);>0 = 赚(反向)。
    //    长短仓四象限统一由 aedAfter 符号驱动。
    const aedAfter = isLong ? aedNet + proceeds : aedNet - proceeds;
    if (aedAfter !== 0n) {
      const lossLeg = aedAfter < 0n;
      await this.accounting.executeTransfer({
        debitAccountId: lossLeg ? realizedId : fxAedId,
        creditAccountId: lossLeg ? fxAedId : realizedId,
        amount: lossLeg ? -aedAfter : aedAfter,
        ledger: aedLedger,
        code: TB_TRANSFER_CODES.FX_REALIZE,
        evidence: evidence(
          'FX_REALIZE_RESIDUAL',
          lossLeg ? TB_ACCOUNT_CODES.FX_REALIZED_PNL : TB_ACCOUNT_CODES.FX_POSITION,
          lossLeg ? TB_ACCOUNT_CODES.FX_POSITION : TB_ACCOUNT_CODES.FX_REALIZED_PNL,
          BASE_CURRENCY,
          `Realized ${lossLeg ? 'loss' : 'gain'} on ${currency} position`,
        ),
      });
    }

    // ④ 浮动回转:累计亏(借方净额>0)→ 借 FX_REALIZED / 贷 FX_UNREALIZED;赚反向。
    if (unrealDebitNet !== 0n) {
      const rotateLoss = unrealDebitNet > 0n;
      await this.accounting.executeTransfer({
        debitAccountId: rotateLoss ? realizedId : unrealizedId,
        creditAccountId: rotateLoss ? unrealizedId : realizedId,
        amount: rotateLoss ? unrealDebitNet : -unrealDebitNet,
        ledger: aedLedger,
        code: TB_TRANSFER_CODES.FX_REALIZE,
        evidence: evidence(
          'FX_REALIZE_UNREAL_ROTATE',
          rotateLoss ? TB_ACCOUNT_CODES.FX_REALIZED_PNL : TB_ACCOUNT_CODES.FX_UNREALIZED_PNL,
          rotateLoss ? TB_ACCOUNT_CODES.FX_UNREALIZED_PNL : TB_ACCOUNT_CODES.FX_REALIZED_PNL,
          BASE_CURRENCY,
          'Rotate unrealized PnL into realized on LP fill',
        ),
      });
    }

    this.logger.log(
      `FX realize ${currency} qty=${qty} fill=${fillRate.toString()} proceeds=${proceeds} residual=${aedAfter} rotated=${unrealDebitNet} by ${operatorId}`,
    );
  }

  /** 对账:I1 客户池=Σ(CLIENT_PAYABLE+DEPOSIT_SUSPENSE);I2 桥残余=open swap 桥贡献。 */
  async checkInvariants(report: EodAccountingReport): Promise<void> {
    const assets = await (this.prisma as any).asset.findMany({
      where: { status: 'ACTIVE' },
      select: { currency: true, type: true },
    });
    const openByCurrency = await this.computeOpenBridgeContributions();

    for (const asset of assets) {
      const ledger = (TB_LEDGERS as Record<string, number>)[asset.currency];
      if (!ledger) continue;

      // I1: client pool (asset side, debits−credits) must equal Σ client claims
      // (liability side, credits−debits) across CLIENT_PAYABLE + DEPOSIT_SUSPENSE.
      const poolCode = asset.type === 'FIAT' ? TB_ACCOUNT_CODES.CLIENT_BANK : TB_ACCOUNT_CODES.CLIENT_CUSTODY;
      const poolId = await this.accounting.resolveTbAccountId({ code: poolCode, ledger, ownerType: 'SYSTEM' });
      const poolBal = await this.accounting.lookupBalance(poolId);
      const poolNet = poolBal.debitsPosted - poolBal.creditsPosted;

      const claimRows = await (this.prisma as any).tbAccountRegistry.findMany({
        where: {
          ledger,
          code: { in: [TB_ACCOUNT_CODES.CLIENT_PAYABLE, TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE] },
          status: 'ACTIVE',
        },
        select: { tbAccountId: true },
      });
      let claims = 0n;
      for (const row of claimRows) {
        const bal = await this.accounting.lookupBalance(hexToBigint(row.tbAccountId));
        claims += bal.creditsPosted - bal.debitsPosted;
      }
      if (poolNet !== claims) {
        report.violations.push({
          invariant: 'I1',
          currency: asset.currency,
          detail: `client pool net ${poolNet} != Σ client claims ${claims}`,
        });
      }

      // I2: bridge residue must equal the open-swap bridge contributions.
      const bridgeId = await this.accounting.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.TRADE_CLEARING, ledger, ownerType: 'SYSTEM',
      });
      const bridgeBal = await this.accounting.lookupBalance(bridgeId);
      const bridgeNet = bridgeBal.creditsPosted - bridgeBal.debitsPosted;
      const openNet = openByCurrency.get(asset.currency) ?? 0n;
      if (bridgeNet !== openNet) {
        report.violations.push({
          invariant: 'I2',
          currency: asset.currency,
          detail: `bridge residue ${bridgeNet} != open swap contributions ${openNet}`,
        });
      }
    }
  }

  /**
   * Sequence-discriminated event code: deterministic for a true replay of the
   * same state (amount recomputes to 0 → nothing posted), unique for a later
   * incremental run of the same batch (new evidence row → new seq).
   */
  private async nextEventCode(sourceNo: string, prefix: string): Promise<string> {
    const seq = await (this.prisma as any).tbTransferEvidence.count({
      where: {
        sourceType: EOD_ACCOUNTING_SOURCE,
        sourceNo,
        eventCode: { startsWith: `${prefix}#` },
      },
    });
    return `${prefix}#${seq}`;
  }
}

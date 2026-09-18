import { Injectable, Logger } from '@nestjs/common';
import { AccountingService } from '../accounting/tigerbeetle/accounting.service';
import { TbEvidenceService } from '../accounting/tigerbeetle/tb-evidence.service';
import { deterministicTransferId, bigintToHex } from '../accounting/tigerbeetle/utils/tb-id.util';
import { FundsOrderService } from './funds-order.service';
import { CreateFundsOrderInput } from './dto/funds-order.dto';
import { FundsOrderAction } from './dto/funds-order.dto';

/**
 * 处置动词（地基站，2026-08-26）——资金单主体的业务级动作。
 *
 * ⚠️ 双胞胎引擎互认（站3-α 实测，2026-08-27）：SwapLegAccounting（兑换四腿）与本引擎
 * 是同一「按次画圈→落笔/擦圈」模式的两套实现（兑换在先、本引擎后收敛），刻意不合并
 * （合并=对钱核心的行为等价重写，演示零收益）；改任一侧的占位/编号语义时必须对照另一侧。
 *
 * 一次「处置」= 一笔带账本两阶段锁定的资金移动：建资金单腿 → 挂 pending 锁 →
 * 腿确认后 post 落账（+可选 enrich 外部参考号）→ 腿收口 CLEARED；腿失败则 void
 * 本 attempt、由调用方决定重建或停手。此前这套六件事在充值工作流里按没收/退回/
 * 上缴抄了三遍（约 1500 行）；本服务收敛为一份实现，差异全部进 DispositionSpec
 * 参数（锁几笔账、腿号、去向、事件码）。
 *
 * 边界（铁律 §5.3 各管各的）：
 *  - 本服务只碰资金单 + 账本，**不读不写任何订单主体的表、不迁任何订单状态**；
 *  - 订单状态推进、业务审计、重建时的上下文重取（F_FEE 钱包 / 政府令 orderRef）
 *    全部留在调用方工作流——那是业务判断，不是管道。
 *
 * 保真不变量（照抄原三链，一条不丢）：
 *  - 决定性转账号 deterministicTransferId(sourceType, sourceNo, eventCode, attempt)，
 *    pend / post / void 三方同 attempt 复算（legIndex=attempt 消歧重建腿）；
 *  - post/void 对 already_posted / already_voided 的幂等赦免在账本层，本服务不重写不绕过；
 *  - settle 内 3× 瞬时重试；耗尽返回失败由调用方记账留痕，永不回滚、永不上抛；
 *  - 腿收口 CLEARED：already terminal 视为幂等成功；其余失败返回错误串由调用方留痕。
 */

export interface DispositionAccountRef {
  code: number;
  ownerType: 'SYSTEM' | 'CUSTOMER';
  ownerUuid?: string;
}

export interface DispositionTbLeg {
  /** TB transfer 分类码（TB_TRANSFER_CODES.*） */
  transferCode: number;
  /** pend / post 共用的 evidence eventCode——决定性转账号的哈希键 */
  eventCode: string;
  /** void 时的 evidence 标签（可与 eventCode 同名——上缴弧即如此） */
  voidEventCode: string;
  debit: DispositionAccountRef;
  credit: DispositionAccountRef;
  /** COA 字面串（TB_CODE_TO_COA[...]），evidence 展示用 */
  debitCoa: string;
  creditCoa: string;
  memo: string;
  debitWalletRef: string | null;
  creditWalletRef: string | null;
  isExternalCrossing: boolean;
}

/** settle 成功后对首腿 LOCK 行做 POST 语义补记（仅真外部穿越的弧需要，如退回） */
export interface DispositionPostEnrich {
  eventCode: string;
  memo: string;
  isExternalCrossing: boolean;
}

export interface DispositionSpec {
  /** 弧名标签，仅日志用（CONFISCATE / RETURN / SEIZE …） */
  kind: string;
  sourceType: 'DEPOSIT';
  sourceNo: string;
  /** evidence.traceId（调用方已按 deposit.traceId || deposit.id 解析好） */
  traceId: string;
  ledger: number;
  currency: string;
  decimals: number;
  /** 业务层十进制金额串（元口径），本服务内转账本整数 */
  amount: string;
  legSeq: number;
  /** 按 attempt 生成该弧的资金单创建入参（重建腿 = 新 attempt 新单，旧单留档） */
  buildLegInput: (attempt: number) => CreateFundsOrderInput;
  tbLegs: DispositionTbLeg[];
  postEnrich?: DispositionPostEnrich;
}

export type DispositionSettleResult =
  | { ok: true; externalRef: string | null }
  | { ok: false; error: string };

@Injectable()
export class DispositionService {
  private readonly logger = new Logger(DispositionService.name);
  private static readonly SETTLE_MAX_TRIES = 3;

  constructor(
    private readonly fundsOrders: FundsOrderService,
    private readonly accountingService: AccountingService,
    private readonly tbEvidenceService: TbEvidenceService,
  ) {}

  /**
   * 起始半程：找或建该弧的资金单腿（幂等——已有同 legSeq 单则复用，防重复发起；
   * 与腿级重试无关），再挂全部 pending 锁。attempt 取既有单的 attempt（重建过则
   * 延续），首建恒为 1。
   */
  async initiate(spec: DispositionSpec): Promise<{ fundsOrderNo: string; attempt: number }> {
    const parentKey = { depositTransactionId: this.requireSourceId(spec) } as any;
    const [existing] = await this.fundsOrders.findByParent(parentKey, { legSeq: spec.legSeq });
    const leg = existing ?? (await this.fundsOrders.create(spec.buildLegInput(1)));
    const attempt = leg.attempt ?? 1;
    await this.pendLegs(spec, attempt);
    return { fundsOrderNo: leg.fundsOrderNo, attempt };
  }

  /** 重建半程：上一 attempt 已 void 后，建新 attempt 的腿并重挂 pending 锁。 */
  async rebuild(spec: DispositionSpec, nextAttempt: number): Promise<{ fundsOrderNo: string }> {
    const leg = await this.fundsOrders.create(spec.buildLegInput(nextAttempt));
    await this.pendLegs(spec, nextAttempt);
    return { fundsOrderNo: leg.fundsOrderNo };
  }

  /**
   * 结算半程：post 全部 pending（3× 瞬时重试），可选对首腿 LOCK 行补记 POST 语义
   * （携资金单 CONFIRMED 时铸出的外部参考号）。**不迁订单状态、不写业务审计**——
   * 返回结果由调用方按弧收尾。耗尽返回 ok:false，调用方留痕后原地停手（不回滚）。
   */
  async settle(spec: DispositionSpec, fundsOrderId: string, attempt: number): Promise<DispositionSettleResult> {
    const amountBigint = this.decimalToBigint(spec.amount, spec.decimals);
    const fundsOrder = await this.fundsOrders.findById(fundsOrderId);
    const externalRef = fundsOrder ? this.fundsOrders.resolveExternalRef(fundsOrder) : null;

    let lastError = '';
    for (let i = 1; i <= DispositionService.SETTLE_MAX_TRIES; i++) {
      try {
        for (const leg of spec.tbLegs) {
          const pendId = deterministicTransferId(spec.sourceType, spec.sourceNo, leg.eventCode, attempt);
          await this.accountingService.postPendingTransfer({
            pendingTransferId: pendId,
            amount: amountBigint,
            evidence: {
              sourceType: spec.sourceType, sourceNo: spec.sourceNo, eventCode: leg.eventCode,
              debitCode: leg.debitCoa, creditCode: leg.creditCoa,
              assetCurrency: spec.currency, traceId: spec.traceId, actorType: 'SYSTEM', actorId: 'SYSTEM',
            },
          });
        }
        if (spec.postEnrich) {
          const firstPend = deterministicTransferId(spec.sourceType, spec.sourceNo, spec.tbLegs[0].eventCode, attempt);
          await this.tbEvidenceService.enrichForPost(bigintToHex(firstPend), {
            eventCode: spec.postEnrich.eventCode,
            memo: spec.postEnrich.memo,
            externalRef,
            isExternalCrossing: spec.postEnrich.isExternalCrossing,
          });
        }
        return { ok: true, externalRef };
      } catch (err: any) {
        lastError = String(err?.message ?? err);
        this.logger.error(
          `${spec.kind} settle try ${i}/${DispositionService.SETTLE_MAX_TRIES} (leg attempt ${attempt}) for ${spec.sourceNo} failed: ${lastError}`,
        );
      }
    }
    return { ok: false, error: lastError };
  }

  /** void 本 attempt 的全部 pending 锁（腿级失败后由调用方决定重建或停手）。 */
  async voidAttempt(spec: DispositionSpec, attempt: number): Promise<void> {
    const amountBigint = this.decimalToBigint(spec.amount, spec.decimals);
    for (const leg of spec.tbLegs) {
      const pendId = deterministicTransferId(spec.sourceType, spec.sourceNo, leg.eventCode, attempt);
      await this.accountingService.voidPendingTransfer({
        pendingTransferId: pendId,
        amount: amountBigint,
        evidence: {
          sourceType: spec.sourceType, sourceNo: spec.sourceNo, eventCode: leg.voidEventCode,
          debitCode: leg.debitCoa, creditCode: leg.creditCoa,
          assetCurrency: spec.currency, traceId: spec.traceId, actorType: 'SYSTEM', actorId: 'SYSTEM',
        },
      });
    }
  }

  /**
   * 腿收口 CLEARED。already terminal = 幂等成功（返回 null）；其余失败返回错误串，
   * 由调用方写留痕审计——账已 POSTED、订单已终态，腿状态滞后不影响资金安全。
   */
  async clearLeg(fundsOrderId: string): Promise<string | null> {
    try {
      await this.fundsOrders.advance(fundsOrderId, FundsOrderAction.CLEAR, 'SYSTEM');
      return null;
    } catch (err: any) {
      const msg = String(err?.message ?? '');
      if (/already terminal/i.test(msg)) {
        this.logger.debug(`Disposition leg ${fundsOrderId} already terminal — treating CLEAR as idempotent no-op`);
        return null;
      }
      this.logger.warn(
        `Disposition leg ${fundsOrderId} settled but CLEAR failed: ${msg} — accounting and parent status are already final, funds order status lags`,
      );
      return msg;
    }
  }

  /** 挂全部 pending 锁（pend 侧 evidence 带 memo / walletRef / 穿越位，post 侧不带——照抄原三链）。 */
  private async pendLegs(spec: DispositionSpec, attempt: number): Promise<void> {
    const amountBigint = this.decimalToBigint(spec.amount, spec.decimals);
    for (const leg of spec.tbLegs) {
      const debitId = await this.accountingService.resolveTbAccountId({
        code: leg.debit.code, ledger: spec.ledger, ownerType: leg.debit.ownerType, ownerUuid: leg.debit.ownerUuid,
      });
      const creditId = await this.accountingService.resolveTbAccountId({
        code: leg.credit.code, ledger: spec.ledger, ownerType: leg.credit.ownerType, ownerUuid: leg.credit.ownerUuid,
      });
      await this.accountingService.executePendingTransfer({
        debitAccountId: debitId, creditAccountId: creditId, amount: amountBigint, ledger: spec.ledger,
        code: leg.transferCode, timeout: 0, legIndex: attempt,
        evidence: {
          sourceType: spec.sourceType, sourceNo: spec.sourceNo, eventCode: leg.eventCode,
          debitCode: leg.debitCoa, creditCode: leg.creditCoa,
          assetCurrency: spec.currency, traceId: spec.traceId, actorType: 'SYSTEM', actorId: 'SYSTEM',
          memo: leg.memo, debitWalletRef: leg.debitWalletRef, creditWalletRef: leg.creditWalletRef,
          isExternalCrossing: leg.isExternalCrossing,
        },
      });
    }
  }

  /** 业务层十进制串 → 账本整数（按资产精度）。与原工作流实现逐字一致。 */
  private decimalToBigint(decimalValue: any, decimals: number): bigint {
    const str = String(decimalValue);
    const [whole, frac = ''] = str.split('.');
    const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(whole + paddedFrac);
  }

  /** spec 的 buildLegInput 已含父 FK；initiate 找既有腿时同样需要它——从首腿入参提取。 */
  private requireSourceId(spec: DispositionSpec): string {
    const input = spec.buildLegInput(1) as any;
    const id = input.depositTransactionId;
    if (!id) throw new Error(`DispositionSpec(${spec.kind}) buildLegInput missing depositTransactionId`);
    return id;
  }
}

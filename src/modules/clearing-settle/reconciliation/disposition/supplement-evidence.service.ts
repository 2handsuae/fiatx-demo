// 平账 B 批（spec §2.1）：补单三路共用的证据守卫 + 候选原单。只读；证据永远是一条
// external_statement_lines 行，认领与否写在业务域各自的表上（三张表各一个唯一列），
// 对账域在这里只负责「能不能补」的判断，不写任何表。
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';

export type SupplementKind = 'SUPPLEMENT_DEPOSIT' | 'SUPPLEMENT_BOUNCE' | 'SUPPLEMENT_PAYOUT_RETURN';

const DIRECTION_BY_KIND: Record<SupplementKind, 'IN' | 'OUT'> = {
  SUPPLEMENT_DEPOSIT: 'IN', SUPPLEMENT_BOUNCE: 'OUT', SUPPLEMENT_PAYOUT_RETURN: 'IN',
};

export interface ClaimableLine {
  externalLineId: string; caseNo: string; caseId: string; businessDate: string;
  dispositionNo: string | null;
  walletId: string; walletNo: string | null; walletAddress: string | null; walletIban: string | null;
  ownerId: string; ownerNo: string | null;
  assetId: string; currency: string; assetType: 'CRYPTO' | 'FIAT'; decimals: number;
  direction: 'IN' | 'OUT'; amountMinor: string; amountMajor: string;
  externalRef: string | null; channelRef: string | null; datetime: string; description: string | null; source: string;
}

export interface SupplementCandidate { orderNo: string; amountMajor: string; createdAt: string; status: string }

/**
 * `listCandidates` 的对外投影（铁律⑥：对外用业务键，管理台不暴露 UUID）。
 * UUID 只留 `externalLineId` 这一个——它是补单表单的隐藏锚，不上页面展示。
 * `caseId` / `walletId` / `ownerId` / `assetId` 等内部 id 一律不进这个类型；
 * Task 5/6/7 建信号 / 查余额要用这些 id，走 `assertClaimable()` 返回的 `ClaimableLine`
 *（服务端内部值，不出 HTTP 响应），不走这里。
 */
export interface SupplementCandidatesView {
  externalLineId: string; caseNo: string; businessDate: string; dispositionNo: string | null;
  walletNo: string | null; ownerNo: string | null;
  currency: string; assetType: 'CRYPTO' | 'FIAT'; decimals: number;
  direction: 'IN' | 'OUT'; amountMajor: string;
  externalRef: string | null; channelRef: string | null; datetime: string; description: string | null; source: string;
}

/** 最小单位整数字符串 → 业务单位字符串（补零到 decimals 位，不四舍五入）。 */
export function minorToMajor(minor: string, decimals: number): string {
  const neg = minor.startsWith('-');
  const digits = (neg ? minor.slice(1) : minor).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const frac = digits.slice(digits.length - decimals);
  return `${neg ? '-' : ''}${whole}${decimals > 0 ? '.' + frac : ''}`;
}

function majorToMinor(major: Prisma.Decimal | string, decimals: number): bigint {
  const [whole, frac = ''] = String(major).split('.');
  return BigInt(whole + frac.padEnd(decimals, '0').slice(0, decimals));
}

@Injectable()
export class SupplementEvidenceService {
  constructor(private readonly prisma: PrismaService) {}

  async assertClaimable(input: { caseNo: string; externalLineId: string; dispositionNo: string; kind: SupplementKind }): Promise<ClaimableLine> {
    const facts = await this.loadLine(input.caseNo, input.externalLineId);
    const want = DIRECTION_BY_KIND[input.kind];
    if (facts.direction !== want) {
      throw new BadRequestException(`This statement line's direction is ${facts.direction}, but this supplement path requires ${want}——the cause does not match the statement line's direction`);
    }
    const d = await this.prisma.reconciliationDisposition.findUnique({ where: { dispositionNo: input.dispositionNo } });
    if (!d || d.caseNo !== input.caseNo || d.explainedExternalLineId !== input.externalLineId) {
      throw new BadRequestException(`Finding ${input.dispositionNo} is not the finding for this statement line`);
    }
    if (d.outlet !== 'SUPPLEMENT') throw new BadRequestException(`Finding ${input.dispositionNo}'s outlet is ${d.outlet}, not a supplement`);
    if (d.deferredTarget !== input.kind) throw new BadRequestException(`Finding ${input.dispositionNo}'s target is ${d.deferredTarget}, which does not match this path`);
    if (d.supplementNo) throw new BadRequestException(`Finding ${input.dispositionNo} is already linked to supplement ${d.supplementNo}`);
    await this.assertUnclaimed(input.externalLineId);
    return { ...facts, dispositionNo: d.dispositionNo };
  }

  async listCandidates(caseNo: string, externalLineId: string): Promise<{ line: SupplementCandidatesView; kind: SupplementKind | null; candidates: SupplementCandidate[] }> {
    const line = await this.loadLine(caseNo, externalLineId);
    const kase = await this.prisma.reconciliationCase.findUnique({ where: { caseNo } });
    if (!kase) throw new NotFoundException(`Case not found: ${caseNo}`);
    const d = await this.prisma.reconciliationDisposition.findFirst({ where: { caseNo, explainedExternalLineId: externalLineId } });
    const SUPPLEMENT_KINDS: readonly SupplementKind[] = ['SUPPLEMENT_DEPOSIT', 'SUPPLEMENT_BOUNCE', 'SUPPLEMENT_PAYOUT_RETURN'];
    const isSupplementKind = (v: unknown): v is SupplementKind =>
      typeof v === 'string' && (SUPPLEMENT_KINDS as readonly string[]).includes(v);
    // 校验嵌在 SUPPLEMENT 分支**内部**：出口是 SUPPLEMENT 时 kind 只能来自 deferredTarget
    // （无效或为空 → null），绝不落到方向兜底——保持旧代码的分支结构。
    const kind: SupplementKind | null = d?.outlet === 'SUPPLEMENT'
      ? (isSupplementKind(d.deferredTarget) ? d.deferredTarget : null)
      : (line.direction === 'OUT' ? 'SUPPLEMENT_BOUNCE' : null);
    const target = BigInt(line.amountMinor);
    let candidates: SupplementCandidate[] = [];
    if (kind === 'SUPPLEMENT_BOUNCE') {
      const rows = await this.prisma.depositTransaction.findMany({
        where: { toWalletId: line.walletId, status: 'SUCCESS' }, orderBy: { createdAt: 'desc' },
      });
      candidates = rows.filter((r: any) => majorToMinor(r.amount, line.decimals) === target)
        .map((r: any) => ({ orderNo: r.depositNo, amountMajor: String(r.amount), createdAt: r.createdAt.toISOString(), status: r.status }));
    } else if (kind === 'SUPPLEMENT_PAYOUT_RETURN') {
      const rows = await this.prisma.withdrawTransaction.findMany({
        where: { fromWalletId: line.walletId, status: 'SUCCESS' }, orderBy: { createdAt: 'desc' },
      });
      candidates = rows.filter((r: any) => majorToMinor(r.netAmount, line.decimals) === target)
        .map((r: any) => ({ orderNo: r.withdrawNo, amountMajor: String(r.netAmount), createdAt: r.createdAt.toISOString(), status: r.status }));
    }
    // 对外投影：显式挑字段构造，不用 delete —— caseId/walletId/ownerId/assetId 等内部 id
    // 从不进入这个对象（铁律⑥）。line（ClaimableLine，含内部 id）只在函数内部用于查询。
    const view: SupplementCandidatesView = {
      externalLineId: line.externalLineId, caseNo: line.caseNo, businessDate: kase.businessDate, dispositionNo: d?.dispositionNo ?? null,
      walletNo: line.walletNo, ownerNo: line.ownerNo,
      currency: line.currency, assetType: line.assetType, decimals: line.decimals,
      direction: line.direction, amountMajor: line.amountMajor,
      externalRef: line.externalRef, channelRef: line.channelRef, datetime: line.datetime, description: line.description, source: line.source,
    };
    return { line: view, kind, candidates };
  }

  /** 执行期：只要参考号 / 关联号 / 业务日 / 案号，不重跑守卫（守卫在提交与批准两个时点已跑）。 */
  async describeLine(externalLineId: string) {
    const line = await this.prisma.externalStatementLine.findUnique({ where: { id: externalLineId } });
    if (!line) throw new NotFoundException(`Statement line not found: ${externalLineId}`);
    const li = await this.prisma.reconciliationLineItem.findFirst({
      where: { externalTxId: externalLineId }, orderBy: { createdAt: 'desc' }, include: { case: true },
    });
    return {
      externalLineId, externalRef: line.externalRef ?? null, channelRef: line.channelRef ?? null,
      businessDate: li?.case?.businessDate ?? line.datetime.toISOString().slice(0, 10),
      caseNo: li?.case?.caseNo ?? null, amountMinor: line.amount.toString(), direction: line.direction as 'IN' | 'OUT',
    };
  }

  // ── 内部 ──
  private async loadLine(caseNo: string, externalLineId: string): Promise<ClaimableLine> {
    const kase = await this.prisma.reconciliationCase.findUnique({ where: { caseNo }, include: { lineItems: true } });
    if (!kase) throw new NotFoundException(`Reconciliation case not found: ${caseNo}`);
    if (kase.status !== 'OPEN') throw new BadRequestException(`Case ${caseNo} is not open — cannot supplement`);
    // book 的真实落库值是 'CUSTOMER'（wallet-recon-run.service.ts 的引擎写入值），不是 'CLIENT'
    // ——同目录 adjustment.service.ts / disposition.service.ts 都按「=== 'FIRM' 才算不是客户账簿」
    // 归一化，这里对齐同一惯例（曾误写成严格等于 'CLIENT'，会把每一条真实客户案件都拒掉，
    // 冒烟测试对运行中 self 栈的真实数据直接复现过）。
    if (kase.book === 'FIRM') throw new BadRequestException(`Case ${caseNo} is not a client-book case — supplements only apply to client wallets`);
    const li = (kase.lineItems ?? []).find((x: any) => x.externalTxId === externalLineId);
    if (!li || li.matchStatus !== 'ORPHAN_EXTERNAL') {
      throw new BadRequestException(`This statement line is not an "external only" difference line from this case's latest run`);
    }
    const line = await this.prisma.externalStatementLine.findUnique({ where: { id: externalLineId } });
    if (!line) throw new NotFoundException(`Statement line not found: ${externalLineId}`);
    // walletRef 可空（跨钱包合成案件），为 null 时 findUnique 的 where 会在运行期被 Prisma 拒。
    if (kase.walletRef === null) {
      throw new BadRequestException(`Case ${caseNo} has no wallet reference — supplements only apply to wallet-anchored cases`);
    }
    const wallet = await this.prisma.wallet.findUnique({ where: { id: kase.walletRef } });
    if (!wallet) throw new BadRequestException(`Case ${caseNo}'s wallet was not found`);
    // 资产从**案子**取，不再从钱包取（2026-09-04 合并 main / V3 波一 T5 时改）：波一把
    // Wallet 改成按 vault × network × 归属人开的「地址行」，砍掉了 assetId 列与 asset
    // 关联——一个地址行不再绑死单一资产，从钱包问"这是什么币"已经问不出来了。案子本身
    // 带 assetId（引擎按币种开案时写入，见 wallet-recon-run.service.ts 的 resolveAssetId），
    // 那才是这条账单行所属资产的权威来源。⚠️ 这段原本走 `wallet.asset`，因整份文件用
    // `this.prisma` 取数，tsc 照不到，合并后会在运行期才炸成
    // PrismaClientValidationError（Unknown field `asset`）。
    const asset = await this.prisma.asset.findUnique({ where: { id: kase.assetId } });
    if (!asset) throw new BadRequestException(`Case ${caseNo}'s asset was not found`);
    // external_statement_lines.currency 全仓惯例存的是 asset.code（法币两者同名，
    // 加密币不同——见 wallet-recon-run.service.ts:170 / adjustment.service.ts:493 /
    // reconciliation-query.service.ts:699 同一约定），这里此前错拿 asset.currency
    // （裸币种 'USDT'）去比，USDT-TRON 账单行永远判"不符"——Task 8 e2e 用真实 USDT
    // 案子跑通①a 时当场复现（补录/退汇/退回三条 initiate* 入口全部经这条守卫，
    // 加密币三路此前从未被非 mock 的真实数据跑过）。改比 asset.code；下面
    // 返回值 `currency: asset.currency`（供审计文案人读，如"61 USDT"）不动。
    if (String(asset.code) !== String(line.currency)) {
      throw new BadRequestException(`Statement line currency ${line.currency} does not match the case's asset ${asset.code}`);
    }
    const owner = wallet.ownerId ? await this.prisma.customerMain.findUnique({ where: { id: wallet.ownerId }, select: { customerNo: true } }) : null;
    const decimals: number = asset.decimals ?? 2;
    const amountMinor = line.amount.toString();
    if (wallet.ownerId === null) {
      throw new BadRequestException(`Wallet ${wallet.walletNo ?? wallet.id} has no owner — supplements only apply to customer wallets`);
    }
    if (line.direction !== 'IN' && line.direction !== 'OUT') {
      throw new BadRequestException(`Statement line ${externalLineId} has an unexpected direction: ${line.direction}`);
    }
    return {
      externalLineId, caseNo, caseId: kase.id, businessDate: kase.businessDate, dispositionNo: null,
      walletId: wallet.id, walletNo: wallet.walletNo ?? null, walletAddress: wallet.address ?? null, walletIban: wallet.iban ?? null,
      ownerId: wallet.ownerId, ownerNo: owner?.customerNo ?? kase.ownerNo ?? null,
      assetId: asset.id, currency: asset.currency, assetType: String(asset.type).toUpperCase() === 'CRYPTO' ? 'CRYPTO' : 'FIAT', decimals,
      direction: line.direction, amountMinor, amountMajor: minorToMajor(amountMinor, decimals),
      externalRef: line.externalRef ?? null, channelRef: line.channelRef ?? null, datetime: line.datetime.toISOString(),
      description: line.description ?? null, source: line.source,
    };
  }

  private async assertUnclaimed(externalLineId: string): Promise<void> {
    // spec §2.2：拒绝 / 超时 / 撤回后原状态不动、supplementNo 清空、可再次发起——
    // 三条路一致（① 已批准但 processSignal 抛错的失败分支也落回同一可复用状态，
    // 不止 CFO 这三种决定会到这里，见 InboundTransferSignalsService 的同款注释）。
    // ②③ 靠 clearClawbackRequest / 同款方法把各自的占用列
    // （clawbackExternalLineId / returnExternalLineId）清空来实现；① 的占用列
    // supplementOfExternalLineId 是 @unique，永不清空（清了新建行会撞唯一约束），
    // 靠 InboundTransferSignalsService.initiateSupplement 发现"已存在且是
    // SUPPLEMENT_REJECTED"时复用同一行来实现——这里必须放行 REJECTED 状态的信号，
    // 否则这道守卫会先于复用逻辑把请求拒掉（Task 8 e2e 用真实数据跑通拒绝路径时
    // 发现：① 是这里唯一没放行终态-可重来的分支，②③ 本来就对）。
    const sig = await this.prisma.inboundTransferSignal.findFirst({
      where: { supplementOfExternalLineId: externalLineId, status: { not: 'SUPPLEMENT_REJECTED' } },
      select: { signalNo: true },
    });
    if (sig) throw new BadRequestException(`This statement line is already claimed by backfill ${sig.signalNo}`);
    const dep = await this.prisma.depositTransaction.findFirst({ where: { clawbackExternalLineId: externalLineId }, select: { depositNo: true } });
    if (dep) throw new BadRequestException(`This statement line is already claimed by recall ${dep.depositNo}`);
    const wd = await this.prisma.withdrawTransaction.findFirst({ where: { returnExternalLineId: externalLineId }, select: { withdrawNo: true } });
    if (wd) throw new BadRequestException(`This statement line is already claimed by return ${wd.withdrawNo}`);
  }
}

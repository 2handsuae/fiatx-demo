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
      throw new BadRequestException(`该账单行方向是 ${facts.direction}，这条补单路要求 ${want}——成因与账单行方向不符`);
    }
    const d = await (this.prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo: input.dispositionNo } });
    if (!d || d.caseNo !== input.caseNo || d.explainedExternalLineId !== input.externalLineId) {
      throw new BadRequestException(`定性 ${input.dispositionNo} 不是这条账单行的定性`);
    }
    if (d.outlet !== 'SUPPLEMENT') throw new BadRequestException(`定性 ${input.dispositionNo} 的出口是 ${d.outlet}，不是补单`);
    if (d.deferredTarget !== input.kind) throw new BadRequestException(`定性 ${input.dispositionNo} 的去向是 ${d.deferredTarget}，与本路不符`);
    if (d.supplementNo) throw new BadRequestException(`定性 ${input.dispositionNo} 已转补单 ${d.supplementNo}`);
    await this.assertUnclaimed(input.externalLineId);
    return { ...facts, dispositionNo: d.dispositionNo };
  }

  async listCandidates(caseNo: string, externalLineId: string): Promise<{ line: SupplementCandidatesView; kind: SupplementKind | null; candidates: SupplementCandidate[] }> {
    const line = await this.loadLine(caseNo, externalLineId);
    const kase = await (this.prisma as any).reconciliationCase.findUnique({ where: { caseNo } });
    const d = await (this.prisma as any).reconciliationDisposition.findFirst({ where: { caseNo, explainedExternalLineId: externalLineId } });
    const kind: SupplementKind | null = d?.outlet === 'SUPPLEMENT' ? d.deferredTarget : (line.direction === 'OUT' ? 'SUPPLEMENT_BOUNCE' : null);
    const target = BigInt(line.amountMinor);
    let candidates: SupplementCandidate[] = [];
    if (kind === 'SUPPLEMENT_BOUNCE') {
      const rows = await (this.prisma as any).depositTransaction.findMany({
        where: { toWalletId: line.walletId, status: 'SUCCESS' }, orderBy: { createdAt: 'desc' },
      });
      candidates = rows.filter((r: any) => majorToMinor(r.amount, line.decimals) === target)
        .map((r: any) => ({ orderNo: r.depositNo, amountMajor: String(r.amount), createdAt: r.createdAt.toISOString(), status: r.status }));
    } else if (kind === 'SUPPLEMENT_PAYOUT_RETURN') {
      const rows = await (this.prisma as any).withdrawTransaction.findMany({
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
    const line = await (this.prisma as any).externalStatementLine.findUnique({ where: { id: externalLineId } });
    if (!line) throw new NotFoundException(`账单行不存在：${externalLineId}`);
    const li = await (this.prisma as any).reconciliationLineItem.findFirst({
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
    const kase = await (this.prisma as any).reconciliationCase.findUnique({ where: { caseNo }, include: { lineItems: true } });
    if (!kase) throw new NotFoundException(`对账案件不存在：${caseNo}`);
    if (kase.status !== 'OPEN') throw new BadRequestException(`案子 ${caseNo} 不是打开状态，不能补单`);
    // book 的真实落库值是 'CUSTOMER'（wallet-recon-run.service.ts 的引擎写入值），不是 'CLIENT'
    // ——同目录 adjustment.service.ts / disposition.service.ts 都按「=== 'FIRM' 才算不是客户账簿」
    // 归一化，这里对齐同一惯例（曾误写成严格等于 'CLIENT'，会把每一条真实客户案件都拒掉，
    // 冒烟测试对运行中 self 栈的真实数据直接复现过）。
    if (kase.book === 'FIRM') throw new BadRequestException(`案子 ${caseNo} 不是客户账簿，补单只对客户钱包`);
    const li = (kase.lineItems ?? []).find((x: any) => x.externalTxId === externalLineId);
    if (!li || li.matchStatus !== 'ORPHAN_EXTERNAL') {
      throw new BadRequestException('该账单行不是本案最新一轮的「外有我无」差异行');
    }
    const line = await (this.prisma as any).externalStatementLine.findUnique({ where: { id: externalLineId } });
    if (!line) throw new NotFoundException(`账单行不存在：${externalLineId}`);
    const wallet = await (this.prisma as any).wallet.findUnique({ where: { id: kase.walletRef }, include: { asset: true } });
    if (!wallet?.asset) throw new BadRequestException(`案子 ${caseNo} 的钱包或资产不存在`);
    // external_statement_lines.currency 全仓惯例存的是 asset.code（法币两者同名，
    // 加密币不同——见 wallet-recon-run.service.ts:170 / adjustment.service.ts:493 /
    // reconciliation-query.service.ts:699 同一约定），这里此前错拿 wallet.asset.currency
    // （裸币种 'USDT'）去比，USDT-TRON 账单行永远判"不符"——Task 8 e2e 用真实 USDT
    // 案子跑通①a 时当场复现（补录/退汇/退回三条 initiate* 入口全部经这条守卫，
    // 加密币三路此前从未被非 mock 的真实数据跑过）。改比 wallet.asset.code；下面
    // 返回值 `currency: wallet.asset.currency`（供审计文案人读，如"61 USDT"）不动。
    if (String(wallet.asset.code) !== String(line.currency)) {
      throw new BadRequestException(`账单行币种 ${line.currency} 与钱包资产 ${wallet.asset.code} 不符`);
    }
    const owner = wallet.ownerId ? await (this.prisma as any).customerMain.findUnique({ where: { id: wallet.ownerId }, select: { customerNo: true } }) : null;
    const decimals: number = wallet.asset.decimals ?? 2;
    const amountMinor = line.amount.toString();
    return {
      externalLineId, caseNo, caseId: kase.id, businessDate: kase.businessDate, dispositionNo: null,
      walletId: wallet.id, walletNo: wallet.walletNo ?? null, walletAddress: wallet.address ?? null, walletIban: wallet.iban ?? null,
      ownerId: wallet.ownerId, ownerNo: owner?.customerNo ?? kase.ownerNo ?? null,
      assetId: wallet.assetId, currency: wallet.asset.currency, assetType: String(wallet.asset.type).toUpperCase() === 'CRYPTO' ? 'CRYPTO' : 'FIAT', decimals,
      direction: line.direction, amountMinor, amountMajor: minorToMajor(amountMinor, decimals),
      externalRef: line.externalRef ?? null, channelRef: line.channelRef ?? null, datetime: line.datetime.toISOString(),
      description: line.description ?? null, source: line.source,
    };
  }

  private async assertUnclaimed(externalLineId: string): Promise<void> {
    const sig = await (this.prisma as any).inboundTransferSignal.findFirst({ where: { supplementOfExternalLineId: externalLineId }, select: { signalNo: true } });
    if (sig) throw new BadRequestException(`该账单行已被补录 ${sig.signalNo} 认领`);
    const dep = await (this.prisma as any).depositTransaction.findFirst({ where: { clawbackExternalLineId: externalLineId }, select: { depositNo: true } });
    if (dep) throw new BadRequestException(`该账单行已被退汇认领 ${dep.depositNo} 占用`);
    const wd = await (this.prisma as any).withdrawTransaction.findFirst({ where: { returnExternalLineId: externalLineId }, select: { withdrawNo: true } });
    if (wd) throw new BadRequestException(`该账单行已被退回认领 ${wd.withdrawNo} 占用`);
  }
}

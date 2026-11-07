// 认损 / 核销的两路写面守卫（账龄路 / 事故路）——从 adjustment.service.ts 搬出来的原样守卫，
// 公司池核销（调账单）与客户池认损补缺（划转单，戊波二 T7a）共用这一份，不各抄一遍。
//
// 搬出来而不是留在 AdjustmentService 里的原因：客户池认损不再是调账单（戊波二 spec §0 裁定 1），
// 守卫的第二个调用方在资金域的划转单 workflow——纯函数 + 显式传 prisma（同 resolveWalletNo 的先例），
// 不让划转单 workflow 去依赖调账单主体服务。两个调用方的差别只有三处，都以参数表达：
//   · 簿别配对规则（assertPairing 回调——调账单查成因码 × 簿别，认损补缺单查「客户池只许少」）；
//   · 金额：调账单是客户端传来的（amountMinor 必给，事故路要与定损额逐位相等）；认损补缺的金额由服务端算
//     （账龄路取差异行的差额，事故路取定损额——事故路不传 amountMinor，守卫把定损额还给调用方）；
//   · 措辞里「开的是什么单」（noun）。
// 守卫顺序与错误文案对公司池调用方逐字保持原样（adjustment.service.spec 的正则是它的锁）。
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { bigintToDecimal } from '../../../funds-layer/accounting/tb-amount.util';
import { DISPOSITION_LABEL, DispositionKind, OUTLET_OF, StoredOutlet } from './cause-registry';
import { isSmallAmount, SMALL_AMOUNT_LINE_MINOR } from './recon-thresholds.constant';

// Task 13：结论文案改走「存储 outlet → 处置种类 → DISPOSITION_LABEL」反查（同
// reconciliation-query.service.ts 读面 KIND_OF_OUTLET 的路子，唯一来源都是
// cause-registry.ts 导出的 OUTLET_OF）。
const KIND_OF_OUTLET = new Map<StoredOutlet, DispositionKind>(
  (Object.entries(OUTLET_OF) as Array<[DispositionKind, StoredOutlet]>).map(([kind, outlet]) => [outlet, kind]),
);

export type WriteOffPath = 'AGING' | 'INCIDENT';

/**
 * 路径判据（平账三期 Task 10 / Task 4 死胡同修复沿用）：`outlet === 'INCIDENT' || incidentNo`——
 * 两路都要落进事故三重闸，判据不能是互斥的单一条件：
 *   · outlet='INCIDENT'（UNAUTHORIZED_OUTFLOW 专用静态出口，record() 建档时就定死），incidentNo 在事故
 *     真正登记前一直是 null——这期间仍要落进三重闸，好让守卫吐出「先去登记事故」而不是「案子还没到账龄线」；
 *   · outlet 仍是 HOLD_INVESTIGATING、只是被 DispositionService.attachIncident 挂了 incidentNo
 *     （「大额查不出→挂起·调查中→超期→升级事故」LARGE_UNEXPLAINED 那条路——attachIncident 只写 incidentNo
 *     一列，outlet 原地不动）。
 * 事故守卫本体不读 outlet，只读 incidentNo / 挂单号 / 事故表，两条路天然通用。
 */
export function writeOffPathOf(held: { outlet?: string | null; incidentNo?: string | null } | null | undefined): WriteOffPath {
  return held?.outlet === 'INCIDENT' || held?.incidentNo ? 'INCIDENT' : 'AGING';
}

/** 该行是否已被一张单锁住（调账单或认损补缺单）；返回人话，没锁返回 null。 */
function lockedBy(held: { adjustmentNo?: string | null; transferNo?: string | null }): string | null {
  if (held.adjustmentNo) return `adjustment ${held.adjustmentNo}`;
  if (held.transferNo) return `shortfall top-up ${held.transferNo}`;
  return null;
}

interface GuardOptions {
  /** 簿别配对规则：在「已挂单」之后、「金额」之前调用，与旧守卫同一位置。 */
  assertPairing: () => void;
  /** 措辞里开的是什么单；缺省沿用调账单文案。 */
  noun?: string;
}

/**
 * 账龄路（「查无果」）四前提——全部 400、人话文案：
 *   ① 案子已超期  ② 锚的那行已定性且出口 = 挂起·调查中、未挂单  ③ 簿别配对  ④ 金额 ≤ 该币种小额线
 */
export async function assertAgingWriteOffAllowed(
  prisma: PrismaService,
  p: { kase: { slaBreached: boolean; assetCode: string }; held: any; amountMinor: bigint } & GuardOptions,
): Promise<{ dispositionNo: string }> {
  const { kase, held, amountMinor } = p;
  if (!kase.slaBreached) {
    throw new BadRequestException('The case has not yet reached the aging threshold — unexplained differences stay on hold until then; write-off can only be discussed after that');
  }
  if (!held || held.outlet !== 'HOLD_INVESTIGATING') {
    const conclusion = held ? DISPOSITION_LABEL[KIND_OF_OUTLET.get(held.outlet as StoredOutlet)!] : 'not yet found';
    throw new BadRequestException(`Write-off only applies to a difference line found as "Hold · Investigating"; this line's conclusion is ${conclusion}`);
  }
  const locked = lockedBy(held);
  if (locked) {
    throw new BadRequestException(`This line's finding is already linked to ${locked} — cannot open another ${p.noun ?? 'write-off'}`);
  }
  p.assertPairing();
  const asset = await prisma.asset.findUnique({ where: { code: kase.assetCode }, select: { currency: true, decimals: true } });
  const currency: string = asset?.currency ?? kase.assetCode;
  if (!isSmallAmount(currency, amountMinor)) {
    const line = bigintToDecimal(SMALL_AMOUNT_LINE_MINOR[currency], asset?.decimals ?? 0).toFixed(asset?.decimals ?? 0);
    const amt = bigintToDecimal(amountMinor, asset?.decimals ?? 0).toFixed(asset?.decimals ?? 0);
    throw new BadRequestException(`Difference ${amt} ${currency} exceeds the small-amount threshold ${line} ${currency} — a large unexplained difference cannot be written off; register an incident instead`);
  }
  return { dispositionNo: held.dispositionNo };
}

/**
 * 事故路认损三重闸——大额未授权转出锚定的定性行不查账龄线 / 小额线（大额正是走事故的理由），改查事故侧的定损结论：
 *   ① 状态 ∈ {ASSESSED, RESOLVING}（还没定损就没有结论可谈）
 *   ② assessmentBasis === 'FIRM_LOSS'（公司承损；RECOVERED / CLIENT_COLLECTION / NO_LOSS 都不走认损）
 *   ③ 金额锁定为定损额（最小单位换算后相等——不许多报少报）
 * assessedAmount 是元口径 Decimal（对齐 InternalTransfer.amount 惯例）。
 *
 * 另有「该行已挂单不可再开」前置复检（平账三期 Task 10 评审 Fix 2）：挂单锁在落库之后才跑，没有这条前置复检，
 * 同一条已挂单的事故定性行还能再走完三重闸建出第二张单。
 *
 * amountMinor 给了 → 逐位核对定损额（调账单：金额来自客户端）；不给 → 不核对，把定损额（最小单位）还给调用方
 * （认损补缺单：金额由服务端锁定为定损额）。
 */
export async function assertIncidentWriteOffAllowed(
  prisma: PrismaService,
  p: { kase: { assetCode: string }; held: any; amountMinor?: bigint } & GuardOptions,
): Promise<{ dispositionNo: string; incidentNo: string; assessedMinor: bigint }> {
  const { kase, held } = p;
  const noun = p.noun ?? 'loss-recognition adjustment';
  if (!held.incidentNo) {
    throw new BadRequestException('This line is found as "Incident · Pending" and has no incident number attached yet — register the incident before loss recognition');
  }
  const locked = lockedBy(held);
  if (locked) {
    throw new BadRequestException(`This line's finding is already linked to ${locked} — cannot open another ${noun}`);
  }
  const incident = await prisma.incident.findUnique({ where: { incidentNo: held.incidentNo } });
  if (!incident || !['ASSESSED', 'RESOLVING'].includes(incident.status)) {
    throw new BadRequestException(`Incident ${held.incidentNo} has not been assessed yet — wait for the assessment before opening a ${noun}`);
  }
  if (incident.assessmentBasis !== 'FIRM_LOSS') {
    throw new BadRequestException(`Incident ${held.incidentNo}'s assessment is "${incident.assessmentBasis}", not "Firm bears the loss" — only a firm-bears-the-loss assessment can open a ${noun}`);
  }
  p.assertPairing();
  const asset = await prisma.asset.findUnique({ where: { code: kase.assetCode }, select: { decimals: true } });
  const decimals = asset?.decimals ?? 0;
  // 事故未定损时 assessedAmount 为 null，直接 .toFixed() 会抛 TypeError（不是人话 400）。
  // 剧本场景 18 的顺序是「定损 → 回案件页认损」，所以正常路径走不到这儿；但守卫本就该显式拒，
  // 而不是靠调用顺序碰运气。
  if (incident.assessedAmount === null) {
    throw new BadRequestException(`Incident ${held.incidentNo} has not been assessed yet — record the assessed loss before raising the write-off`);
  }
  const assessed = incident.assessedAmount.toFixed(decimals);
  if (p.amountMinor !== undefined) {
    const amt = bigintToDecimal(p.amountMinor, decimals).toFixed(decimals);
    if (amt !== assessed) {
      throw new BadRequestException(`Adjustment amount ${amt} does not match incident ${held.incidentNo}'s assessed amount ${assessed} — the loss-recognition amount must exactly equal the assessed amount`);
    }
  }
  const assessedMinor = BigInt(new Prisma.Decimal(incident.assessedAmount).mul(new Prisma.Decimal(10).pow(decimals)).toFixed(0));
  return { dispositionNo: held.dispositionNo, incidentNo: held.incidentNo, assessedMinor };
}

// 战役乙波三 T1 · 审慎地基：只读 NLA 状态计算——查两资产（AED/USDT）的 F_OPS 运营户余额，
// USDT 经汇率单源折算 AED，汇总对比红线。纯读零写：computeStatus 本身不写审计。
// 战役乙波三 T2 · 算术门：assertPostOutflowCompliant 是本文件写点之一（拦截当场留痕）。
// 战役乙波三 T3 · 巡检：performCheck 是本文件另一写点（每日监控任务的手动触发替身）。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { SystemWalletResolver } from '../../funds-layer/domain/system-wallet-resolver.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditOutcome, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { AED_USD_PEG_RATE, MONTHLY_OPEX_BASE_AED_MINOR, NLA_FLOOR_AED_MINOR, usdtMinorToAedMinor } from './prudential.constants';

export type PrudentialOrderKind = 'VENDOR_PAYMENT' | 'LP_EXCHANGE';

export interface AssertPostOutflowCompliantInput {
  currency: 'AED' | 'USDT';
  amountMinor: bigint;
  orderKind: PrudentialOrderKind;
  counterpartyNo: string;
  /** 出款资产业务键（付款单=付款资产、LP 单=卖出资产）——拦截审计挂一个 ASSET RELATED
   *  主体，照 withdraw-workflow.service.ts:417 先例（第七幕按资产号能拉出被它拦下的单）。 */
  assetNo: string;
  actor: ApprovalActorContext;
}

/** 分（2dp AED 最小单位）→ 元两位小数展示串——最小单位铁律在这一处（拒单话术）换算，
 *  其余全程 bigint 最小单位比较。 */
function fmtAed(minor: bigint | string): string {
  const v = typeof minor === 'string' ? BigInt(minor) : minor;
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const major = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${major}.${frac} AED`;
}

/** 对手方业务键在信封里挂哪个实体码——外包商/LP 档案两码本仓已在册（评审交接第 2 条：
 *  开工 grep AuditEntityTypes 实测过，非臆造）。 */
function counterpartySubjectType(orderKind: PrudentialOrderKind): string {
  return orderKind === 'VENDOR_PAYMENT' ? AuditEntityTypes.OUTSOURCING_VENDOR : AuditEntityTypes.LIQUIDITY_PROVIDER;
}

function orderLabel(orderKind: PrudentialOrderKind): string {
  return orderKind === 'VENDOR_PAYMENT' ? 'payment' : 'LP exchange';
}

export interface PrudentialAssetStatus {
  assetCode: string;
  currency: string;
  balanceMinor: string;
  aedEquivalentMinor: string;
}

export interface PrudentialStatus {
  perAsset: PrudentialAssetStatus[];
  nlaAedMinor: string;
  floorAedMinor: string;
  headroomAedMinor: string;
  breached: boolean;
  monthlyOpexBaseAedMinor: string;
  coefficient: '1.2';
  /** 评审裁定 R2：AED_USD_PEG_RATE 单源直出，供前端展示「@ 3.6725」折算注，
   *  不必自己再写一份字面量。 */
  pegRate: string;
}

@Injectable()
export class PrudentialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly systemWallets: SystemWalletResolver,
    private readonly accounting: AccountingService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /** 查两资产（AED/USDT，不按 status 过滤——评审 Imp#1：暂停只停交易，公司手上的余额
   *  没消失，NLA 必须照算，否则 demo/script.md 站 4 暂停 USDT-TRON 那幕会误报破线并
   *  连累 T2 的门拦下无关的 AED 付款）→ 逐资产 resolve F_OPS 钱包（确认在册，同注资单
   *  先例）→ 按 currency 对应 ledger 取 TB 运营户余额（口径同 vendor-payment.service.ts:
   *  98-109：available = creditsPosted − debitsPosted − debitsPending）→ AED 直加、
   *  USDT 经 usdtMinorToAedMinor 折算 → 汇总 NLA，比红线算余量/缺口。 */
  async computeStatus(): Promise<PrudentialStatus> {
    const assets = await this.prisma.asset.findMany({
      where: { currency: { in: ['AED', 'USDT'] } },
    });

    const perAsset: PrudentialAssetStatus[] = [];
    let nlaAedMinor = 0n;

    for (const asset of assets) {
      await this.systemWallets.resolve(asset.id, 'F_OPS');
      const ledger = TB_LEDGERS[asset.currency as keyof typeof TB_LEDGERS];
      const tbAccountId = await this.accounting.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.FIRM_OPS,
        ledger,
        ownerType: 'SYSTEM',
      });
      const bal = await this.accounting.lookupBalance(tbAccountId);
      const balanceMinor = bal.creditsPosted - bal.debitsPosted - bal.debitsPending;
      const aedEquivalentMinor = asset.currency === 'AED' ? balanceMinor : usdtMinorToAedMinor(balanceMinor);
      nlaAedMinor += aedEquivalentMinor;
      perAsset.push({
        assetCode: asset.code,
        currency: asset.currency,
        balanceMinor: balanceMinor.toString(),
        aedEquivalentMinor: aedEquivalentMinor.toString(),
      });
    }

    const headroomAedMinor = nlaAedMinor - NLA_FLOOR_AED_MINOR;

    return {
      perAsset,
      nlaAedMinor: nlaAedMinor.toString(),
      floorAedMinor: NLA_FLOOR_AED_MINOR.toString(),
      headroomAedMinor: headroomAedMinor.toString(),
      breached: nlaAedMinor < NLA_FLOOR_AED_MINOR,
      monthlyOpexBaseAedMinor: MONTHLY_OPEX_BASE_AED_MINOR.toString(),
      coefficient: '1.2',
      pegRate: AED_USD_PEG_RATE,
    };
  }

  /** 算术门（spec §3）：付款单/LP 兑换单两个提单口发起时用——当前 NLA 减折算后出款额，
   *  低于红线即拒建单（400）。检查只在发起时算一次（单人顺序假设，批准时不复检，既有
   *  余额闸的批准时复核照旧独立运行）。内部划转（义务性）与注资（进项）刻意不接门——
   *  豁免是业务立场非遗漏（spec §3 表），调用点在 VendorPaymentWorkflowService /
   *  LpExchangeWorkflowService 两处 initiate，本方法不知道、也不关心调用方是谁。
   *  拦下也留痕——单未建、无单号，照 WITHDRAW_L1_BLOCKED 形制：先写审计后抛异常。 */
  async assertPostOutflowCompliant(input: AssertPostOutflowCompliantInput): Promise<void> {
    const status = await this.computeStatus();
    const outflowAedMinor = input.currency === 'AED' ? input.amountMinor : usdtMinorToAedMinor(input.amountMinor);
    const after = BigInt(status.nlaAedMinor) - outflowAedMinor;
    if (after >= BigInt(status.floorAedMinor)) return;

    const display = input.actor.userNo ?? input.actor.userId;
    const auditInput: any = {
      action: AuditActions.PRUDENTIAL_GATE_BLOCKED,
      actionDomain: 'TREASURY',
      category: AuditCategory.BUSINESS,
      primarySubjectType: AuditEntityTypes.PRUDENTIAL_STATUS,
      primarySubjectNo: 'NLA',
      outcome: AuditOutcome.DENIED,
      reasonCode: 'NLA_FLOOR',
      reason: `${input.orderKind} to ${input.counterpartyNo} blocked: NLA after outflow would fall below the regulatory floor`,
      subjects: [
        { subjectType: counterpartySubjectType(input.orderKind), subjectNo: input.counterpartyNo, subjectRole: AuditSubjectRole.RELATED },
        // 并入项①（主会话裁定 R3）：挂出款资产 RELATED 主体，照 withdraw-workflow
        // .service.ts:417 先例。
        { subjectType: AuditEntityTypes.ASSET, subjectNo: input.assetNo, subjectRole: AuditSubjectRole.RELATED },
      ],
      metadata: {
        orderKind: input.orderKind, counterpartyNo: input.counterpartyNo, currency: input.currency,
        amountMinor: String(input.amountMinor), nlaBeforeAedMinor: status.nlaAedMinor,
        nlaAfterAedMinor: after.toString(), floorAedMinor: status.floorAedMinor,
      },
      requestId: `PRUDENTIAL_GATE_BLOCKED_NLA_${randomUUID()}`,
    };
    await this.auditLogs.recordByActor(auditInput, {
      actorType: 'ADMIN', actorNo: display, actorDisplayName: display, actorRolesAtTime: input.actor.roleCodes ?? [],
    });

    throw new BadRequestException(
      `Blocked by prudential floor (Company Rulebook VI.C): this ${orderLabel(input.orderKind)} would take Net Liquid Assets below the regulatory floor — `
        + `NLA now ${fmtAed(status.nlaAedMinor)}, after ${fmtAed(after)}, floor ${fmtAed(status.floorAedMinor)}.`,
    );
  }

  /** 巡检（T3，演示站「每日监控任务」的手动触发替身）：算一次 → 写一条留痕
   *  （PRUDENTIAL_CHECK_PERFORMED，reasonCode 按当次结果二选一，metadata 是 status 的
   *  全量快照）→ 把同一份 status 原样吐回给调用方展示。outcome 恒为 SUCCESS——PASS/BREACH
   *  是巡检查出的业务结果，不是「这次记录没写成」，破线不代表这条审计写失败。
   *
   *  **不自动生成事故**：即便本次判定 breached=true，本方法也只负责测出并留痕，绝不
   *  顺手 new 一个 Incident。理由两条都是硬约束，不是「懒得写」：
   *  ① 事件登记须有操作人——巡检可能是无人值守的定时任务触发，这里没有一个「发现问题的
   *     人」可以落进事件的 operator 字段（甲波五判例）；
   *  ② PRUDENTIAL_BREACH（审慎缺口）这一事故族的经办固定由 CFO 族独占——巡检服务若代为
   *     立案，等于越权抢了 CFO 族的经办位。是否立案、由谁去办，留给人在事件登记页手动开。
   *  二连跑没有去重语义：每次核对本身就是一次业务动作，都要各写各的一条，不因短时间内
   *  重复调用而合并或跳过。 */
  async performCheck(actor: ApprovalActorContext): Promise<PrudentialStatus> {
    const status = await this.computeStatus();
    const display = actor.userNo ?? actor.userId;
    const breached = status.breached;
    const auditInput: any = {
      action: AuditActions.PRUDENTIAL_CHECK_PERFORMED,
      actionDomain: 'TREASURY',
      category: AuditCategory.BUSINESS,
      primarySubjectType: AuditEntityTypes.PRUDENTIAL_STATUS,
      primarySubjectNo: 'NLA',
      outcome: AuditOutcome.SUCCESS,
      reasonCode: breached ? 'NLA_BREACH' : 'NLA_OK',
      reason: breached
        ? `Prudential check: NLA ${fmtAed(status.nlaAedMinor)} is below the regulatory floor ${fmtAed(status.floorAedMinor)}`
        : `Prudential check: NLA ${fmtAed(status.nlaAedMinor)} is at/above the regulatory floor ${fmtAed(status.floorAedMinor)}`,
      metadata: { ...status },
      requestId: `PRUDENTIAL_CHECK_PERFORMED_NLA_${randomUUID()}`,
    };
    await this.auditLogs.recordByActor(auditInput, {
      actorType: 'ADMIN', actorNo: display, actorDisplayName: display, actorRolesAtTime: actor.roleCodes ?? [],
    });
    return status;
  }
}

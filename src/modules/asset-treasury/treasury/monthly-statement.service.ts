// 战役丙波四 T3（spec §1.2）：月结单生成器——出具的单据，快照落库，只写一次。
// 行渲染一律复用 CustomerStatementService.buildStatement：tipping-off 白名单（ROW_PRESENTATION /
// FALLBACK_PRESENTATION）随之继承，冻结/受限客户的账单与普通客户一字不差；本服务不得自造行标题。
// 窗口 = 迪拜业务月（经 business-date.util 三函数，不手拼 UTC 边界）；归月口径 = 记账月
// （腿的 createdAt 落在哪个月就记哪个月，后月回溯的平账调整入它实际入账的那个月——也正是快照不漂的原因）。
// 次序：先落快照行 → 再写审计 STATEMENT_ISSUED（持久物先于留痕，照 TradeConfirmationsService 先例）。
// 同客户同月第二次 issue 由 @@unique([customerId, periodMonth]) 抛出——这是单据"一单一张"的业务规则，
// 不是幂等兜底；sweep 以 listMissingMonths 为准，正常不会撞。
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { TbAccountRegistryService } from '../../accounting/tigerbeetle/tb-account-registry.service';
import { TbEvidenceService } from '../../accounting/tigerbeetle/tb-evidence.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import {
  businessMonthOf,
  endOfBusinessMonth,
  startOfBusinessMonth,
} from '../../accounting/tigerbeetle/utils/business-date.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { CustomerStatementService, StatementLeg, StatementRow } from './customer-statement.service';

export interface MonthlyStatementSection {
  assetCode: string;
  isFiat: boolean;
  /** 期初余额：窗口前最后一腿的 runningBalance（无则 '0'），最小单位整数字符串。 */
  openingBalance: string;
  /** 期末余额：窗口内最后一腿的 runningBalance（窗口无腿则 = 期初）。 */
  closingBalance: string;
  rows: StatementRow[];
}

export interface MonthlyStatementPayload {
  sections: MonthlyStatementSection[];
}

/** 账本号 → 币种（TB_LEDGERS 的反查）：账户登记行的 assetCode 存的是资产 code（如 USDT-TRON），
 *  腿/资产表按币种（USDT）——ledger 是两边共同的权威键。 */
const CURRENCY_BY_LEDGER: Record<number, string> = Object.fromEntries(
  Object.entries(TB_LEDGERS).map(([currency, ledger]) => [ledger, currency]),
);

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

@Injectable()
export class MonthlyStatementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: TbAccountRegistryService,
    private readonly tbEvidence: TbEvidenceService,
    private readonly statementReader: CustomerStatementService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /**
   * 该客户尚未出具的业务月，升序：自开户批准所在业务月起，到 now 所在业务月的前一月止
   * （当月未结束不出单）；查库剔除已出具月。
   */
  async listMissingMonths(c: { id: string; onboardingApprovedAt: Date }, now: Date): Promise<string[]> {
    const current = businessMonthOf(now);
    const months: string[] = [];
    for (let m = businessMonthOf(c.onboardingApprovedAt); m < current; m = nextMonth(m)) months.push(m);
    if (months.length === 0) return [];

    const issued = await this.prisma.customerMonthlyStatement.findMany({
      where: { customerId: c.id },
      select: { periodMonth: true },
    });
    const have = new Set(issued.map((r) => r.periodMonth));
    return months.filter((m) => !have.has(m));
  }

  /** 出具一张月结单，返回 statementNo。已存在则抛（唯一约束）。 */
  async issue(c: { id: string; customerNo: string }, periodMonth: string): Promise<string> {
    const statementNo = `STM-${c.customerNo}-${periodMonth.replace('-', '')}`;
    const from = startOfBusinessMonth(periodMonth);
    const to = endOfBusinessMonth(periodMonth);

    // 后端自枚举客户的 CLIENT_PAYABLE 户（不走客户端传参那条活水路）；暂扣户不入账单。
    const accounts = (await this.registry.findByOwner(c.id))
      .filter((r: any) => r.code === TB_ACCOUNT_CODES.CLIENT_PAYABLE)
      .sort((a: any, b: any) => a.ledger - b.ledger);

    const sections: MonthlyStatementSection[] = [];
    for (const account of accounts) {
      const assetCode = CURRENCY_BY_LEDGER[account.ledger];
      const asset = await this.prisma.asset.findFirst({ where: { currency: assetCode }, select: { type: true } });
      const isFiat = asset?.type === 'FIAT';

      const { items: legs } = await this.tbEvidence.getAccountStatement(account.tbAccountId);
      const before = legs.filter((l) => new Date(l.createdAt).getTime() < from.getTime());
      const within = legs.filter((l) => {
        const t = new Date(l.createdAt).getTime();
        return t >= from.getTime() && t <= to.getTime();
      });
      // getAccountStatement 按 createdAt 升序累加 runningBalance，故末腿即最新一腿。
      const openingBalance = before.length ? String(before[before.length - 1].runningBalance) : '0';
      const closingBalance = within.length ? String(within[within.length - 1].runningBalance) : openingBalance;

      const { items: rows } = await this.statementReader.buildStatement(legs as StatementLeg[], {
        isFiat,
        from,
        to,
        take: 100000,
      });
      sections.push({ assetCode, isFiat, openingBalance, closingBalance, rows });
    }

    const payload: MonthlyStatementPayload = { sections };
    await this.prisma.customerMonthlyStatement.create({
      data: {
        statementNo,
        customerId: c.id,
        periodMonth,
        payload: JSON.stringify(payload),
      },
    });

    await this.auditLogs.recordSystem({
      action: AuditActions.STATEMENT_ISSUED,
      actionDomain: 'GOVERNANCE',
      category: AuditCategory.BUSINESS,
      primarySubjectType: AuditEntityTypes.MONTHLY_STATEMENT,
      primarySubjectNo: statementNo,
      ownerCustomerNo: c.customerNo,
      subjects: [
        { subjectType: AuditEntityTypes.MONTHLY_STATEMENT, subjectNo: statementNo, subjectRole: AuditSubjectRole.PRIMARY },
        { subjectType: AuditEntityTypes.CUSTOMER, subjectNo: c.customerNo, subjectRole: AuditSubjectRole.OWNER },
      ],
      reason: `Monthly statement ${statementNo} issued for ${periodMonth}`,
      // requiredFields=['statementNo','periodMonth']（STATEMENT_ISSUED 词表声明）——assertActionSpec 只查
      // input 顶层，故顶层展开；metadata 另镜像一份供查询（照 CONFIRMATION_ISSUED 先例）。
      statementNo,
      periodMonth,
      metadata: { statementNo, periodMonth },
      // 显式 requestId：审计 idempotencyKey 含 requestId，缺了会按 (action, subject, NO_REQUEST_ID) 静默去重。
      requestId: statementNo,
      sourcePlatform: 'SYSTEM',
    } as any);

    return statementNo;
  }
}

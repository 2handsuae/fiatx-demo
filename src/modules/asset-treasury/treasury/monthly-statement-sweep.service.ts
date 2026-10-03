// 战役丙波四 T3（spec §1.4）：月结单出具 sweep——追赶式。
// 样板照 compliance-obligation-sweep.service.ts：@Cron 包装与 sweep(now) 逻辑分离（测试直调不等真钟）、
// 逐笔 try/catch（单月/单客户失败不拖垮批次）。重铺后首轮自动补齐 开户月～上月 全部历史月；
// 单轮对同一客户补出多月时仅最新月发通知（避免一人连收 4 条"6/7/8/9 月账单已出"）。
// 发信形态照波一三原则：后置（快照落库+审计之后才调）、持久物先于信号、服务边界吞错。
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { MonthlyStatementService } from './monthly-statement.service';

@Injectable()
export class MonthlyStatementSweepService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly statements: MonthlyStatementService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('*/30 * * * * *')
  async tick(): Promise<void> {
    await this.sweep();
  }

  async sweep(now: Date = new Date()): Promise<void> {
    const customers = await this.prisma.customerMain.findMany({
      where: { onboardingApprovedAt: { not: null } },
      select: { id: true, customerNo: true, onboardingApprovedAt: true },
    });
    for (const c of customers) {
      // where 已滤掉 null，onboardingApprovedAt 此处必有值（select 类型仍是 Date | null）。
      const missing = await this.statements.listMissingMonths(
        { id: c.id, onboardingApprovedAt: c.onboardingApprovedAt as Date },
        now,
      ); // 升序、已剔除已出具月
      const issued: { statementNo: string; periodMonth: string }[] = [];
      for (const month of missing) {
        try {
          issued.push({ statementNo: await this.statements.issue(c, month), periodMonth: month });
        } catch (err) {
          console.error(`[MonthlyStatementSweep] issue failed ${c.customerNo}/${month}:`, err);
        }
      }
      if (issued.length) {
        const latest = issued[issued.length - 1]; // missing 升序，末位即最新月
        try {
          await this.notifications.notifyStatementIssued({ customerId: c.id, ...latest });
        } catch (err) {
          console.error('[MonthlyStatementSweep] notify failed:', err);
        }
      }
    }
  }
}

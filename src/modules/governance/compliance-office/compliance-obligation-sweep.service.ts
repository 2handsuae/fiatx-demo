// 战役甲波四 · 合规办公室骨架（spec §3.1/§4.1/§4.2，Task 3）：周期义务到期开单 sweep。
// 模板照 regulatory-filing-sweep.service.ts（波二 Task 7 先例）：@Cron 包装与 sweep(now)
// 逻辑分离（测试直调不等真钟）、逐笔 try/catch（单笔失败不拖垮批次）。
// 判据（spec §4.2）：status='ACTIVE' && addBusinessDays(now, leadBusinessDays) >= nextDueAt
// ——leadBusinessDays 逐义务不同，不能整批下推 SQL where 子句，取全部 ACTIVE 义务后在应用层
// 逐行判；addBusinessDays 从 ../regulatory-filings/business-days 原样导入，不自写时区逻辑
// （波三 T1 评审红项判例：宿主时区判周末在不同部署算出不同截止日，本 sweep 同样吃这条纪律）。
// 命中序：claimDue（读旧 dueAt + 翻期落库，供开单）→ openForObligation（跨主体开单，走
// RegulatoryFilingService）→ recordGenerated（回填单号展示列）——三步非原子，中断风险已记
// PRODUCTION-NOTES（本任务 Step 3），不修、不补偿。
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ComplianceObligationsService } from './compliance-obligations.service';
import { RegulatoryFilingService } from '../regulatory-filings/regulatory-filing.service';
import { ObligationStatus } from './compliance-office.constants';
import { addBusinessDays } from '../regulatory-filings/business-days';

@Injectable()
export class ComplianceObligationSweepService {
  private readonly logger = new Logger(ComplianceObligationSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly obligations: ComplianceObligationsService,
    private readonly filings: RegulatoryFilingService,
  ) {}

  @Cron('*/30 * * * * *')
  async handleCron(): Promise<void> {
    await this.sweep();
  }

  /**
   * 核心扫描逻辑，与 @Cron 包装分开，测试里直接调用不必等真实时钟。
   * 判据（spec §4.2）：status='ACTIVE' && addBusinessDays(now, leadBusinessDays) >= nextDueAt。
   * 命中：claimDue(obligationNo, now) 拿翻期前的 dueAt 并落库翻期（一期一单由 claimDue 自身
   * 构造保证——消费掉的 nextDueAt 不会再被同一个 now 命中）→ openForObligation 开单 →
   * recordGenerated 回填单号。单笔失败不拖垮批次：claimDue 已经落库翻期，本笔即便在
   * openForObligation/recordGenerated 任一步抛错，该义务也已消费掉这一期（如实断言这个
   * 已知窗口，见 PRODUCTION-NOTES，不在此处补偿）。
   */
  async sweep(now: Date = new Date()): Promise<{ generated: number }> {
    const active = await this.prisma.complianceObligation.findMany({
      where: { status: ObligationStatus.ACTIVE },
    });

    const due = active.filter(
      (row) => addBusinessDays(now, row.leadBusinessDays).getTime() >= row.nextDueAt.getTime(),
    );

    let generated = 0;
    for (const row of due) {
      try {
        const { dueAt } = await this.obligations.claimDue(row.obligationNo, now);
        const { filingNo } = await this.filings.openForObligation(
          { obligationNo: row.obligationNo, name: row.name, authority: row.authority, basisNote: row.basisNote },
          dueAt,
        );
        await this.obligations.recordGenerated(row.obligationNo, filingNo);
        generated += 1;
      } catch (err) {
        this.logger.error(
          `compliance obligation sweep failed for ${row.obligationNo}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (generated) {
      this.logger.log(`compliance obligation sweep: generated=${generated}`);
    }
    return { generated };
  }
}

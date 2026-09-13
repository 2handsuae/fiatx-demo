// src/modules/sumsub-shared/sla-sweep.base.ts
import { Logger } from '@nestjs/common';

/**
 * 充值 / 提现两域 SLA 扫描的公共骨架（swap 域不适用，另有 swap-sla.service.ts）。
 *
 * 抽出的是「遍历候选 + 软/硬分流 + 单笔错误隔离」——这段两域逐字一致。
 * 域差异（候选查询、软状态集、硬破线动作、软破线审计）留给子类通过下面几个
 * abstract 成员实现；@Cron 入口与 checkSlaBreaches() 包装留在子类（不提到
 * 基类）——基类合同只暴露 sweep(now) 一个公共方法，这是照合同做，不是库的
 * 限制（NestJS MetadataScanner 的 getAllMethodNames 会沿原型链上溯，父类
 * @Cron 也扫得到——2026-09-13 评审读 node_modules 源码证实）；留子类同时让
 * 两域现有 spec 能继续直接调用 `service.checkSlaBreaches()`。
 *
 * 单笔候选处理失败（含 updateStatus 与 webhook 并发撞车时抛出的 Invalid
 * transition ——对方已经把单子推进了别的状态，是正常的竞态吸收，不是故障）
 * 都不能拖垮整轮扫描：逐笔 try/catch，记录后继续下一单。
 */
export abstract class SlaSweepBase {
  protected readonly logger = new Logger(this.constructor.name);

  /** 'deposit' | 'withdraw'——日志文案首词，与改前逐字一致 */
  protected abstract readonly domainLabel: string;
  /** 'deposit' | 'withdrawal'——日志里 id 前的名词，与改前逐字一致 */
  protected abstract readonly rowNoun: string;
  /** 软 SLA 状态集：等自己人处理超时，只标记不迁移状态 */
  protected abstract readonly softStatuses: ReadonlySet<string>;

  protected abstract findCandidates(now: Date): Promise<any[]>;
  protected abstract markSlaBreached(id: string): Promise<void>;
  /** 硬 SLA：等外部超时，我方有权处置 → 推状态。两域动作与审计各不同，留子类。 */
  protected abstract hardBreach(row: any): Promise<void>;
  /** 软 SLA 的审计落盘（含日志），两域字段不同，留子类。 */
  protected abstract auditSoftBreach(row: any): Promise<void>;

  async sweep(now: Date): Promise<void> {
    const candidates = await this.findCandidates(now);

    for (const row of candidates) {
      try {
        await this.breach(row);
      } catch (err) {
        this.logger.error(
          `${this.domainLabel} SLA sweep failed for ${this.rowNoun} ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private async breach(row: any): Promise<void> {
    if (this.softStatuses.has(row.status)) {
      await this.softBreach(row);
      return;
    }
    await this.hardBreach(row);
  }

  /**
   * 软 SLA：等自己人（合规官 / 运营 / 审批人）超时。只置标记 + 写审计，
   * **状态一步不动**。
   */
  private async softBreach(row: any): Promise<void> {
    await this.markSlaBreached(row.id);
    await this.auditSoftBreach(row);
  }
}

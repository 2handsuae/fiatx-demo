import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';

export interface IncomingApplicantAction {
  applicantActionId: string;
  externalActionId: string;
}

/**
 * 一笔充值单上挂的多条 Sumsub applicant action。
 *
 * **客户端从头到尾拿不到 action id。** 上一轮的 Critical：`actionId` 曾出现在
 * 客户面响应体里，而 demo fixture 的 id 是 `aa-edd-0002`——`edd` 三个字母把
 * "为什么要你交材料"写在脸上。故对外一律用 `seq` 定位，服务端自己查表换真 id
 * 去铸 token。不是靠"记得别下发"，是客户端根本没有这个字段可漏。
 */
@Injectable()
export class DepositApplicantActionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 用 Sumsub 报文里的 applicantActions **全量列表**同步本地子表。
   *
   * 三种情况：
   *  · 有新 id      → 插行，seq 取现有最大值 +1 往后追加
   *  · 完全一致      → 真 no-op（重复 webhook）
   *  · 库内有、报文无 → **删掉其中未提交的**
   *
   * 第三条是关键：报文带的是当前全量列表，Sumsub 撤回一条而我方保留，该行
   * 永远算作未提交 →「全部交齐」永不成立 → 客户永久卡死。已提交的行不删，
   * 那是历史。
   *
   * seq 一旦分配不再变——它进 URL（/verification/2），客户收藏了链接、或页面
   * 开着时来了新 action，都不能让第 2 条变成第 3 条。
   */
  async syncApplicantActions(
    depositId: string,
    incoming: IncomingApplicantAction[],
  ): Promise<{ added: number[]; retired: number[] }> {
    try {
      return await this.syncOnce(depositId, incoming);
    } catch (e: any) {
      // P2002 = 唯一约束冲突。并发/重复 webhook 下两个调用算出同一个 nextSeq，
      // 一个成功一个撞约束——这是**预期内**的竞态结果，不是错误：重读一次即可，
      // 此时对方已经把行插好了，第二遍算出来的 toAdd 通常为空，天然幂等。
      // 不重试的话，一次合法投递会被打成 500 抛回 Sumsub，而 webhook 要求幂等。
      if (e?.code !== 'P2002') throw e;
      return this.syncOnce(depositId, incoming);
    }
  }

  private async syncOnce(
    depositId: string,
    incoming: IncomingApplicantAction[],
  ): Promise<{ added: number[]; retired: number[] }> {
    // 「读 existing → 算 nextSeq → 插入/删除」是 read-modify-write：同一充值单
    // 上两次并发（或重复投递）的 webhook 若各自裸跑这三步，会各自读到同一份
    // existing、算出相同的 nextSeq，插出两行 applicantActionId 不同但 seq 相同的
    // 记录——而 seq 是客户面唯一定位符（进 URL），撞了会让 findBySeq 变成不确定
    // 查询。包一层事务把这三步锁成一个原子操作；@@unique([depositTransactionId,
    // seq]) 是 DB 层最后兜底，事务是尽量避免真撞上这道底线。
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.depositApplicantAction.findMany({
        where: { depositTransactionId: depositId },
        select: { id: true, applicantActionId: true, seq: true, submittedAt: true },
        orderBy: { seq: 'asc' },
      });

      const existingIds = new Set(existing.map((r) => r.applicantActionId));
      const incomingIds = new Set(incoming.map((a) => a.applicantActionId));

      const toAdd = incoming.filter((a) => !existingIds.has(a.applicantActionId));
      const toRetire = existing.filter(
        (r) => !incomingIds.has(r.applicantActionId) && r.submittedAt === null,
      );

      let nextSeq = existing.reduce((m, r) => Math.max(m, r.seq), 0) + 1;
      const added: number[] = [];
      const rows = toAdd.map((a) => {
        const seq = nextSeq++;
        added.push(seq);
        return {
          depositTransactionId: depositId,
          applicantActionId: a.applicantActionId,
          externalActionId: a.externalActionId,
          seq,
        };
      });

      if (rows.length) {
        await tx.depositApplicantAction.createMany({ data: rows });
      }
      if (toRetire.length) {
        await tx.depositApplicantAction.deleteMany({
          where: { id: { in: toRetire.map((r) => r.id) } },
        });
      }

      return { added, retired: toRetire.map((r) => r.seq) };
    });
  }

  /** 服务端按 seq 换回真 id（用于铸 token）。返回 null 交由调用方转成 404。 */
  async findBySeq(depositId: string, seq: number) {
    return this.prisma.depositApplicantAction.findFirst({
      where: { depositTransactionId: depositId, seq },
      select: {
        id: true,
        seq: true,
        applicantActionId: true,
        externalActionId: true,
        submittedAt: true,
      },
    });
  }

  /**
   * 提交某一条 action，并按需重算充值单上的「全部交齐」缓存。
   *
   * 两表都要写，故必须包 `$transaction`（CLAUDE.md 铁律 2）。
   *
   * 幂等靠 `updateMany` 的 where 条件交给 DB 保证互斥——不能退回"先读后写"，
   * 那样并发下两个请求都会读到 submittedAt=null、都返回 changed:true，
   * 调用方据此写审计就会记重。
   *
   * `allSubmitted` 只在真正交完最后一条时为 true（spec §D4：交一条就算完
   * 会让客户以为交完了、剩下的永远不动，那是 bug 不是选项）。
   */
  async submitBySeq(
    depositId: string,
    seq: number,
    slaDeadline: Date,
    resetSla: boolean,
  ): Promise<{ changed: boolean; allSubmitted: boolean }> {
    return this.prisma.$transaction(async (tx: any) => {
      const res = await tx.depositApplicantAction.updateMany({
        where: { depositTransactionId: depositId, seq, submittedAt: null },
        data: { submittedAt: new Date() },
      });
      if (res.count === 0) return { changed: false, allSubmitted: false };

      const outstanding = await tx.depositApplicantAction.count({
        where: { depositTransactionId: depositId, submittedAt: null },
      });
      if (outstanding > 0) return { changed: true, allSubmitted: false };

      // 全部交齐 → 盖充值单缓存。SLA 两字段只在 resetSla 时写：单子已被 SLA
      // 定时器打成 MANUAL_CHECKING(slaBreached=true)后，客户一次提交不该把
      // operator 眼里的违约旗单方面抹掉（该状态不在 findSlaBreachCandidates
      // 的扫描范围内，抹掉后永远发现不了）。
      await tx.depositTransaction.updateMany({
        where: { id: depositId },
        data: {
          actionSubmittedAt: new Date(),
          ...(resetSla && { slaDeadline, slaBreached: false }),
        },
      });
      return { changed: true, allSubmitted: true };
    });
  }

  /**
   * 新 action 进来时清掉充值单的「全部交齐」缓存并重置 SLA 表。
   * 不清的话：客户此前交过的材料让 actionSubmittedAt 留着旧值 → 单子明明又要
   * 客户补材料，客户端却一直显示"已收到，审核中"，客户永远不知道要再交一次。
   */
  async clearDepositCache(depositId: string, slaDeadline: Date): Promise<void> {
    await (this.prisma as any).depositTransaction.update({
      where: { id: depositId },
      data: { actionSubmittedAt: null, slaDeadline, slaBreached: false },
    });
  }

}

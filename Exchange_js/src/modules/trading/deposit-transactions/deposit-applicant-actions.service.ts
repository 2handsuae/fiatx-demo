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

}

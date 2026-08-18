import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { MaterialRequestsService, type MaterialActor } from '../../identity/material-requests/material-requests.service';
import { MaterialRequestIssuerService } from '../../identity/material-requests/material-request-issuer.service';

export interface IncomingApplicantAction {
  applicantActionId: string;
  externalActionId: string;
}

const SYSTEM_ACTOR: MaterialActor = {
  actorType: 'SYSTEM', actorId: 'SYSTEM', actorNo: 'SYSTEM', actorRole: 'SYSTEM',
};

/**
 * 一笔提现单上挂的多条 Sumsub applicant action。
 *
 * **2026-08-18 材料请求账**：本类不再拥有 `withdraw_applicant_actions` 子表，
 * 内脏换成了统一的材料账（`material_requests`，orderDomain='WITHDRAW'）。
 * 对外签名逐字不变 —— `withdraw-workflow.service.ts` 里那段带死角修复注释的
 * 状态机逻辑（判据是 hasOutstanding）因此一行都不用动。
 *
 * 子表本身在 Task 12 统一物理删除（G3：加法在前、删除在后）。本类已经
 * **零写入**旧表，看到还有代码读它就是漏网。
 *
 * **客户端从头到尾拿不到 action id** —— 这条口径没变，只是防线换了地方：
 * 以前靠「对外用 seq 定位」，现在靠材料账客户面投影结构上装不下
 * applicantActionId（由 material-request.contract.spec.ts 扫源码守着）。
 */
@Injectable()
export class WithdrawApplicantActionsService {
  private readonly logger = new Logger(WithdrawApplicantActionsService.name);

  constructor(
    // 与 MaterialRequestsService / MaterialRequestIssuerService / 姊妹 service
    // DepositApplicantActionsService 同款坑：交叉类型 `PrismaService &
    // Record<string, any>` 在 emitDecoratorMetadata 下会被擦成裸 `Object`，
    // Nest 靠隐式反射解析不出注入令牌，运行时 UnknownDependenciesException
    // （单测走 `new Service(...)` 直接构造，绕过 DI 容器，测不出这个坑）。
    // 显式 @Inject(PrismaService) 兜底。
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly requests: MaterialRequestsService,
    private readonly issuer: MaterialRequestIssuerService,
  ) {}

  /**
   * 集合同步：报文带的是该单当前 action 的**全量列表**，本方法让材料账与它对齐。
   * 报文里新出现的 → register 落一行；报文里消失的 → cancel。
   *
   * 账不能删行（审计），所以退役动作是 CANCELLED 而不是 deleteMany —— 这是与
   * 子表时代唯一的语义差别，其余行为一致。
   */
  async syncApplicantActions(
    withdrawId: string,
    incoming: IncomingApplicantAction[],
  ): Promise<{ added: number; retired: number }> {
    const withdraw = await this.prisma.withdrawTransaction.findUnique({
      where: { id: withdrawId },
      select: { id: true, withdrawNo: true, ownerId: true },
    });
    if (!withdraw) return { added: 0, retired: 0 };

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: withdraw.ownerId },
      select: { id: true, sumsubApplicantId: true },
    });
    if (!customer?.sumsubApplicantId) {
      this.logger.warn(
        `Withdraw ${withdraw.withdrawNo}: owner has no Sumsub applicant; skipping action sync`,
      );
      return { added: 0, retired: 0 };
    }

    // 空 applicantActionId/externalActionId 的条目在入口直接丢弃：与子表时代的
    // `valid` 过滤同一职责（见 71483d0d 版 syncOnce）——externalActionId 是材料账
    // 的 @unique 幂等键，空串一旦落进 issuer.register 会在下一条空串同步时撞唯一
    // 约束（P2002），不如在源头就不让这种脏数据入库。
    const valid = incoming.filter((a) => {
      if (a.applicantActionId && a.externalActionId) return true;
      this.logger.warn(
        `Withdraw ${withdraw.withdrawNo}: dropping applicant action with missing id — applicantActionId=${a.applicantActionId} externalActionId=${a.externalActionId}`,
      );
      return false;
    });

    const live = await this.requests.listLiveByOrder('WITHDRAW', withdraw.withdrawNo);
    const liveByExternal = new Map(live.map((r) => [r.externalActionId, r]));
    const incomingIds = new Set(valid.map((a) => a.externalActionId));

    let added = 0;
    for (const action of valid) {
      if (liveByExternal.has(action.externalActionId)) continue; // 幂等：重复 webhook 不造第二行
      await this.issuer.register({
        customerId: customer.id,
        sumsubApplicantId: customer.sumsubApplicantId,
        // 提现补料同样统一按「资金来源」登记，理由见充值域同址注释
        materialType: 'SOURCE_OF_FUNDS',
        levelName: 'wave3-action-sof-refresh',
        applicantActionId: action.applicantActionId,
        externalActionId: action.externalActionId,
        orderDomain: 'WITHDRAW',
        orderRef: withdraw.withdrawNo,
        origin: 'SUMSUB_PUSHED',
        reason: `KYT review on withdrawal ${withdraw.withdrawNo} requires additional materials`,
        issuedBy: 'SYSTEM',
        restrict: true,
        actor: { actorType: 'SYSTEM', userId: 'SYSTEM', userNo: 'SYSTEM', role: 'SYSTEM', roleCodes: ['SYSTEM'] } as any,
      });
      added += 1;
    }

    let retired = 0;
    for (const row of live) {
      // 只退役客户还没交的行——与子表时代 `submittedAt === null` 等价（见
      // 71483d0d 版 syncOnce 的 toRetire 过滤）。SUBMITTED 是客户已经交了、正等
      // 审核的行：报文没带出这条 id 不代表 Sumsub 撤回了它，把它当撤回 cancel 掉
      // 会让客户白交材料、运营也看不到已提交的证据。
      if (row.status !== 'PENDING_SUBMISSION') continue;
      if (incomingIds.has(row.externalActionId)) continue;
      await this.requests.cancel(row.requestNo, 'RETIRED_BY_SUMSUB', SYSTEM_ACTOR);
      retired += 1;
    }

    return { added, retired };
  }

  /**
   * 该单是否还有「客户还没交」的行。
   *
   * 判据必须是「还有 PENDING_SUBMISSION」而不是「incoming 非空」——
   * 报文也可能带的全是已经提交过的旧 id，那样是零未提交。这条判据撑着
   * withdraw-workflow 里两处死角修复，别改语义。
   */
  async hasOutstanding(withdrawId: string): Promise<boolean> {
    const withdraw = await this.prisma.withdrawTransaction.findUnique({
      where: { id: withdrawId },
      select: { withdrawNo: true },
    });
    if (!withdraw) return false;
    const live = await this.requests.listLiveByOrder('WITHDRAW', withdraw.withdrawNo);
    return live.some((r) => r.status === 'PENDING_SUBMISSION');
  }

  /**
   * 新 action 进来时清掉提现单的「全部交齐」缓存并重置 SLA 表。
   * 不清的话：客户此前交过的材料让 actionSubmittedAt 留着旧值 → 单子明明又要
   * 客户补材料，客户端却一直显示"已收到，审核中"，客户永远不知道要再交一次。
   *
   * **2026-08-18 材料请求账迁移后原样保留**：本方法只读写 `withdrawTransaction`
   * 自己的标量字段，从未碰过 `withdraw_applicant_actions` 子表，与「内脏换成
   * 材料账」无关——它不是 seq 时代产物，唯一调用方是 withdraw-workflow.service.ts
   * 里那段明确禁止改动的状态机逻辑（I2 修复），删掉它会让那段代码编译不过。
   */
  async clearWithdrawCache(withdrawId: string, slaDeadline: Date): Promise<void> {
    await this.prisma.withdrawTransaction.update({
      where: { id: withdrawId },
      data: { actionSubmittedAt: null, slaDeadline, slaBreached: false },
    });
  }
}

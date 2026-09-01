// 定性落库（spec §3.2/§7）——「财务查证的结论」这件事的落点。零账务：
// 挂起/留档只写这张表；ADJUST 类出口的账务动作仍走调账单（Task 5 联动）。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { generateReferenceNo } from '../../../../common/utils/no-generator.util';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../../audit-logging/audit-logs.service';
import { AuditEntityTypes } from '../../../audit-logging/constants/audit-actions.constant';
import { ApprovalActorContext } from '../../../governance/approvals/constants/approval.constants';
import { RecordDispositionDto } from '../dto/disposition.dto';
import { CAUSE_REGISTRY, CauseBook, resolveOutlet } from './cause-registry';

export interface ReattributionCandidate {
  caseNo: string; walletNo: string | null; ownerNo: string | null;
  anchorId: string; externalRef: string | null; amount: string;
}

@Injectable()
export class DispositionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async record(caseNo: string, dto: RecordDispositionDto, actor: ApprovalActorContext) {
    const kase = await (this.prisma as any).reconciliationCase.findUnique({ where: { caseNo } });
    if (!kase) throw new NotFoundException(`对账案件不存在：${caseNo}`);
    if (kase.status !== 'OPEN') throw new BadRequestException('只能对打开中的案件定性');
    if (!dto.explainedFlowId && !dto.explainedExternalLineId) {
      throw new BadRequestException('定性必须锚在真实证据上（内部流水 id / 外部对账单行 id 至少其一）');
    }

    const book: CauseBook = kase.book === 'FIRM' ? 'FIRM' : 'CLIENT';
    // 出口判定（含「成因不属于该格」的显式拒绝）——唯一真相在注册表
    const resolved = resolveOutlet(dto.causeCode as any, {
      matchType: dto.matchType, book,
      deltaSign: dto.deltaSign, internalDirection: dto.internalDirection,
      internalSourceType: dto.internalSourceType, externalDirection: dto.externalDirection,
    });

    // 同锚查找：一条差异行至多一条有效定性；挂了调账单就锁死（400）。
    // ⚠ 必须按字段独立 OR，不能把两个锚 AND 联合成一个 where——锚集会跨轮次
    // 漂移：同一条证据第一次定性时可能只有一个锚（如 ORPHAN_INTERNAL 只带
    // explainedFlowId，库里 explainedExternalLineId 存的是 null），下一轮
    // 对账把它重分类成 AMOUNT_MISMATCH 后两个锚就都有了；按 AND 联合匹配，
    // 新请求带的非空值永远碰不上库里那个 null，findFirst 查不中会把它误判成
    // "新差异"另开一条定性记录——下面 adjustmentNo 非空即拒的挂单锁就被这条
    // 漏网悄悄绕过了。同目录 explained-difference.service.ts 的 explainedBy()
    // 处理的正是"同一证据跨轮次类型漂移"这同一个问题，用的就是按字段独立 OR、
    // 任一锚命中即算——这里照它的范式。
    const anchorConditions = [
      dto.explainedFlowId ? { explainedFlowId: dto.explainedFlowId } : null,
      dto.explainedExternalLineId ? { explainedExternalLineId: dto.explainedExternalLineId } : null,
    ].filter(Boolean);
    const existing = await (this.prisma as any).reconciliationDisposition.findFirst({
      where: { caseNo, OR: anchorConditions },
    });
    if (existing?.adjustmentNo) {
      throw new BadRequestException(`该行定性已挂调账单 ${existing.adjustmentNo}，不可覆盖——单和结论必须对得上`);
    }

    const data = {
      caseNo, walletRef: kase.walletRef, businessDate: kase.businessDate,
      explainedFlowId: dto.explainedFlowId ?? null,
      explainedExternalLineId: dto.explainedExternalLineId ?? null,
      matchType: dto.matchType, book,
      causeCode: dto.causeCode, outlet: resolved.outlet,
      deferredTarget: resolved.deferredTarget ?? null,
      findingNote: dto.findingNote,
      createdByUserId: actor.userNo ?? actor.userId,
    };
    const row = existing
      ? await (this.prisma as any).reconciliationDisposition.update({ where: { dispositionNo: existing.dispositionNo }, data })
      : await (this.prisma as any).reconciliationDisposition.create({ data: { ...data, dispositionNo: generateReferenceNo('RCD') } });
    const dispositionNo = existing?.dispositionNo ?? row.dispositionNo;

    // 铁律①：定性是持久化动作。子主体带案件 + 钱包（业务键，spec §8）。
    const wallet = kase.walletRef && !String(kase.walletRef).startsWith('XREF:')
      ? await (this.prisma as any).wallet.findUnique({ where: { id: kase.walletRef }, select: { walletNo: true } })
      : null;
    const actorDisplay = actor.userNo ?? actor.userId;
    await this.auditLogs.recordByActor(
      {
        action: 'RECON_DISPOSITION_RECORDED',
        actionDomain: 'RECON',
        primarySubjectType: AuditEntityTypes.RECON_DISPOSITION,
        primarySubjectNo: dispositionNo,
        ownerCustomerNo: kase.ownerNo ?? undefined,
        causeCode: dto.causeCode,          // requiredFields 顶层
        outlet: resolved.outlet,
        subjects: [
          { subjectType: AuditEntityTypes.RECON_DISPOSITION, subjectNo: dispositionNo, subjectRole: 'PRIMARY' },
          { subjectType: 'RECONCILIATION_CASE', subjectNo: caseNo, subjectRole: 'RELATED' },
          ...(wallet?.walletNo ? [{ subjectType: AuditEntityTypes.WALLET, subjectNo: wallet.walletNo, subjectRole: 'RELATED' }] : []),
        ],
        reason: dto.findingNote,
        requestId: `RECON_DISPOSITION_RECORDED_${dispositionNo}_${randomUUID()}`, // 漏了会被静默去重
        metadata: {
          causeCode: dto.causeCode, outlet: resolved.outlet,
          deferredTarget: resolved.deferredTarget ?? null,
          matchType: dto.matchType, overwrite: !!existing,
        },
        sourcePlatform: 'ADMIN',
      } as any,
      { actorType: 'ADMIN', actorNo: actorDisplay, actorDisplayName: actorDisplay, actorRolesAtTime: actor.roleCodes ?? [] },
    );

    return { dispositionNo, ...resolved };
  }

  /** Task 5 联动：调账单开出后回填，之后该定性锁死不可覆盖。 */
  async linkAdjustment(dispositionNo: string, adjustmentNo: string): Promise<void> {
    const row = await (this.prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo } });
    if (!row) throw new NotFoundException(`定性记录不存在：${dispositionNo}`);
    if (!String(row.outlet).startsWith('ADJUST')) {
      throw new BadRequestException(`定性 ${dispositionNo} 的出口是 ${row.outlet}，不落调账单`);
    }
    if (row.adjustmentNo) throw new BadRequestException(`定性 ${dispositionNo} 已挂调账单 ${row.adjustmentNo}`);
    await (this.prisma as any).reconciliationDisposition.update({
      where: { dispositionNo }, data: { adjustmentNo },
    });
  }

  /**
   * 改记对端候选（spec §3.3）：同业务日 · 同资产 · 同金额 · 反向孤儿的开放案件。
   * side=FROM：当前行是错记方（我有外无）→ 找外有我无的持久化差异行；
   * side=TO：当前行是正主方 → 找我有外无。差异行读的是 reconciliation_line_items
   * （每轮重建，但候选只在「当下这一轮」里找对端，锚回真实 id 后与轮次无关）。
   */
  async listReattributionCandidates(caseNo: string, side: 'FROM' | 'TO', amount: string): Promise<ReattributionCandidate[]> {
    const kase = await (this.prisma as any).reconciliationCase.findUnique({ where: { caseNo } });
    if (!kase) throw new NotFoundException(`对账案件不存在：${caseNo}`);
    const wantStatus = side === 'FROM' ? 'ORPHAN_EXTERNAL' : 'ORPHAN_INTERNAL';
    const peers = await (this.prisma as any).reconciliationCase.findMany({
      where: {
        status: 'OPEN', caseNo: { not: caseNo },
        businessDate: kase.businessDate, assetCode: kase.assetCode, book: kase.book,
      },
      include: { lineItems: true },
    });
    const out: ReattributionCandidate[] = [];
    for (const peer of peers) {
      for (const li of peer.lineItems ?? []) {
        if (li.matchStatus !== wantStatus) continue;
        const liAmount = (wantStatus === 'ORPHAN_EXTERNAL' ? li.externalAmount : li.internalAmount)?.toString();
        if (liAmount !== amount) continue;
        // 锚：外部孤儿 → externalTxId（external_statement_lines.id）；内部孤儿 → internalSourceId（account_flows.id）
        const anchorId = wantStatus === 'ORPHAN_EXTERNAL' ? li.externalTxId : li.internalSourceId;
        if (!anchorId) continue;
        const wallet = peer.walletRef && !String(peer.walletRef).startsWith('XREF:')
          ? await (this.prisma as any).wallet.findUnique({ where: { id: peer.walletRef }, select: { walletNo: true } })
          : null;
        out.push({
          caseNo: peer.caseNo, walletNo: wallet?.walletNo ?? null, ownerNo: peer.ownerNo ?? null,
          anchorId, externalRef: li.externalRef ?? null, amount: liAmount,
        });
      }
    }
    return out;
  }
}

// 定性落库（spec §3.2/§7）——「财务查证的结论」这件事的落点。零账务：
// 挂起/留档只写这张表；ADJUST 类出口的账务动作仍走调账单（Task 5 联动）。
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { generateReferenceNo } from '../../../../common/utils/no-generator.util';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../../audit-logging/audit-logs.service';
import { AuditEntityTypes } from '../../../audit-logging/constants/audit-actions.constant';
import { ApprovalActorContext } from '../../../governance/approvals/constants/approval.constants';
import { RecordDispositionDto } from '../dto/disposition.dto';
import { AdjustFamily, CAUSE_REGISTRY, CauseBook, DeferredTarget, resolveOutlet } from './cause-registry';

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
    if (!kase) throw new NotFoundException(`Reconciliation case not found: ${caseNo}`);
    if (kase.status !== 'OPEN') throw new BadRequestException('Findings can only be recorded on open cases');
    if (!dto.explainedFlowId && !dto.explainedExternalLineId) {
      throw new BadRequestException('A finding must be anchored to real evidence (at least one of an internal flow id / external statement line id)');
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
      throw new BadRequestException(`This line's finding is already linked to adjustment ${existing.adjustmentNo} — cannot overwrite; the order and the conclusion must stay consistent`);
    }
    if (existing?.supplementNo) {
      throw new BadRequestException(`This line's finding is already linked to supplement ${existing.supplementNo} — cannot overwrite; the order and the conclusion must stay consistent`);
    }

    const data = {
      caseNo, walletRef: kase.walletRef, businessDate: kase.businessDate,
      explainedFlowId: dto.explainedFlowId ?? null,
      explainedExternalLineId: dto.explainedExternalLineId ?? null,
      matchType: dto.matchType, book,
      causeCode: dto.causeCode, outlet: resolved.outlet,
      deferredTarget: resolved.deferredTarget ?? null,
      findingNote: dto.findingNote,
    };
    // createdByUserId 只在建档时写：这条记录的价值之一就是「这次查证是谁做的」，
    // 后来改口径的人可以改成因和说明，但不能把首查人换成自己。
    const row = existing
      ? await (this.prisma as any).reconciliationDisposition.update({ where: { dispositionNo: existing.dispositionNo }, data })
      : await (this.prisma as any).reconciliationDisposition.create({
          data: { ...data, dispositionNo: generateReferenceNo('RCD'), createdByUserId: actor.userNo ?? actor.userId },
        });
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

  /**
   * Task 5 联动：调账单开出后回填，之后该定性锁死不可覆盖。
   * 平账 A 批（spec §3.6）：放行一种组合——出口是「挂起·调查中」且调账单族是核销。
   * 「查不出」仍是查证结论的真相，核销是它在账龄到线后的后续处置，不改写 outlet。
   * 平账三期 Task 10 评审 Fix 1（Critical）：事故路（outlet='INCIDENT'）同样是核销族
   * 认损单的合法锚——`adjustment.service.ts` 的 `assertIncidentWriteOffAllowed` 早已把
   * 「状态/口径/锁额」三重闸过完才走到 createDraft 建单，白名单这里若不认 INCIDENT，
   * 事故路认损单建单后必然在这一步 400，且已落库的 DRAFT 调账单会变成孤儿（定性行没
   * 挂上号，还能再被提交过账）——白名单必须与 assertIncidentWriteOffAllowed 放行的出口
   * 保持同构。
   */
  async linkAdjustment(dispositionNo: string, adjustmentNo: string, opts?: { family?: AdjustFamily }): Promise<void> {
    const row = await (this.prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo } });
    if (!row) throw new NotFoundException(`Finding record not found: ${dispositionNo}`);
    const writeOffOnHeld = row.outlet === 'HOLD_INVESTIGATING' && opts?.family === 'WRITE_OFF';
    const writeOffOnIncident = row.outlet === 'INCIDENT' && opts?.family === 'WRITE_OFF';
    if (!String(row.outlet).startsWith('ADJUST') && !writeOffOnHeld && !writeOffOnIncident) {
      throw new BadRequestException(`Finding ${dispositionNo}'s outlet is ${row.outlet} — it does not route to an adjustment`);
    }
    if (row.adjustmentNo) throw new BadRequestException(`Finding ${dispositionNo} is already linked to adjustment ${row.adjustmentNo}`);
    await (this.prisma as any).reconciliationDisposition.update({ where: { dispositionNo }, data: { adjustmentNo } });
  }

  /**
   * 平账 B 批（spec §2.5）：补单回挂。① 申请时挂信号号、执行后改写为充值单号；② 挂充值单号；③ 挂提现单号。
   * 挂了就锁死（record 的覆盖锁），审批被拒 / 撤回 / 超时由业务域调 unlinkSupplement 解开。
   */
  async linkSupplement(dispositionNo: string, supplementNo: string, target: DeferredTarget): Promise<void> {
    const row = await (this.prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo } });
    if (!row) throw new NotFoundException(`Finding record not found: ${dispositionNo}`);
    if (row.outlet !== 'SUPPLEMENT' || row.deferredTarget !== target) {
      throw new BadRequestException(`Finding ${dispositionNo}'s outlet is ${row.outlet}/${row.deferredTarget ?? '-'} — it does not accept a ${target} supplement`);
    }
    if (row.supplementNo) throw new BadRequestException(`Finding ${dispositionNo} is already linked to supplement ${row.supplementNo}`);
    await (this.prisma as any).reconciliationDisposition.update({ where: { dispositionNo }, data: { supplementNo } });
  }

  async replaceSupplement(dispositionNo: string, from: string, to: string): Promise<void> {
    const row = await (this.prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo } });
    if (!row) throw new NotFoundException(`Finding record not found: ${dispositionNo}`);
    if (row.supplementNo !== from) throw new BadRequestException(`Finding ${dispositionNo} is linked to ${row.supplementNo ?? '-'}, not ${from}`);
    await (this.prisma as any).reconciliationDisposition.update({ where: { dispositionNo }, data: { supplementNo: to } });
  }

  async unlinkSupplement(dispositionNo: string, expected: string): Promise<void> {
    const row = await (this.prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo } });
    if (!row) throw new NotFoundException(`Finding record not found: ${dispositionNo}`);
    if (row.supplementNo !== expected) return; // 已被别的路径清掉或改写，不动
    await (this.prisma as any).reconciliationDisposition.update({ where: { dispositionNo }, data: { supplementNo: null } });
  }

  /**
   * 平账三期（Task 9）：事故登记回挂——铁律③本主体自己的方法，写自己的表一列。
   * 原为 incidents.module.ts 的 InterimDispositionIncidentLink 占位实现（Task 5 为
   * 打通 DI 先立的桩），落地后接线切到这里，占位类随之删除；行为原样保留
   * （404/409/只写 incidentNo 一列），三条行为测试同迁移到本文件 spec。
   */
  async attachIncident(dispositionNo: string, incidentNo: string): Promise<void> {
    const row = await (this.prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo } });
    if (!row) throw new NotFoundException(`Finding line not found: ${dispositionNo}`);
    if (row.incidentNo) throw new ConflictException(`Finding line ${dispositionNo} is already linked to incident ${row.incidentNo} — cannot link another`);
    await (this.prisma as any).reconciliationDisposition.update({ where: { dispositionNo }, data: { incidentNo } });
  }

  /**
   * 改记对端候选（spec §3.3）：同业务日 · 同资产 · 同金额 · 反向孤儿的开放案件。
   * side=FROM：当前行是错记方（我有外无）→ 找外有我无的持久化差异行；
   * side=TO：当前行是正主方 → 找我有外无。差异行读的是 reconciliation_line_items
   * （每轮重建，但候选只在「当下这一轮」里找对端，锚回真实 id 后与轮次无关）。
   */
  async listReattributionCandidates(caseNo: string, side: 'FROM' | 'TO', amount: string): Promise<ReattributionCandidate[]> {
    const kase = await (this.prisma as any).reconciliationCase.findUnique({ where: { caseNo } });
    if (!kase) throw new NotFoundException(`Reconciliation case not found: ${caseNo}`);
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

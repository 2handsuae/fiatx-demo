// 战役乙波一 T2 · LP 档案主体（LiquidityProvider）：建行 / 四态四边迁移表 / 结算坐标改动 / 读投影。
// 照甲波四 ResponsibleIndividualsService 先例：档案审计动作全收在本服务，workflow（Task 3）零审计写入。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { LiquidityProvider } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditBusinessWorkflowTypes, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditSubjectInput, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { LP_PROFILE_TRANSITIONS } from './constants/lp-profile-transitions.constant';
import { CreateLpProfileDto, LpProfileStatus, LpProfileView } from './dto/lp-profile.dto';

/** transition() 的第四参——审计上下文（接口裁定，供 Task 3 的 workflow 在裁决时传入）。 */
export interface LpProfileTransitionAudit {
  approvalNo?: string;
  causationId?: string;
  actor?: ApprovalActorContext;
  reason?: string;
}

/** applySettlementChange 的 patch——四坐标字段各自可选（哪几项变了传哪几项）。approvalNo/
 *  causationId 只喂审计（LP_PROFILE_CHANGE_APPLIED 专列 + INSTRUMENT 子主体），不回写主体
 *  行的 approvalNo 列——评审 Imp#1：该列 spec §2.1 定义为「建档审批单号」，改坐标不许覆盖它
 *  （照 RI 换人先例 applyReplacement：换人审批号不回写 RI 表，只落审计）。causationId 必填
 *  （评审随轮小项：CHANGE_APPLIED 契约 requiresCausation 真，可选会让坐标先落库、审计才炸）。 */
export interface ApplySettlementChangeInput {
  fiatBankName?: string;
  fiatIban?: string;
  cryptoNetwork?: string;
  cryptoAddress?: string;
  approvalNo: string;
  causationId: string;
}

/** (from→to) 边到审计动作码的映射——与 LP_PROFILE_TRANSITIONS 的四条边一一对应。 */
const ACTION_BY_EDGE: Record<string, string> = {
  [`${LpProfileStatus.PENDING_APPROVAL}->${LpProfileStatus.ACTIVE}`]: AuditActions.LP_PROFILE_APPROVED,
  [`${LpProfileStatus.PENDING_APPROVAL}->${LpProfileStatus.REJECTED}`]: AuditActions.LP_PROFILE_REJECTED,
  [`${LpProfileStatus.ACTIVE}->${LpProfileStatus.SUSPENDED}`]: AuditActions.LP_PROFILE_SUSPENDED,
  [`${LpProfileStatus.SUSPENDED}->${LpProfileStatus.ACTIVE}`]: AuditActions.LP_PROFILE_REACTIVATED,
};

@Injectable()
export class LpProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  // ── 读 ──────────────────────────────────────────────────────────────

  async findByNo(lpNo: string): Promise<LiquidityProvider> {
    const row = await this.prisma.liquidityProvider.findUnique({ where: { lpNo } });
    if (!row) throw new NotFoundException(`Liquidity provider not found: ${lpNo}`);
    return row;
  }

  async list(): Promise<LpProfileView[]> {
    const rows = await this.prisma.liquidityProvider.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map((r: LiquidityProvider) => this.toView(r));
  }

  /** 兑换单开单守卫（Task 5 消费）：非 ACTIVE 一律拒。 */
  async assertActiveByNo(lpNo: string): Promise<void> {
    const row = await this.findByNo(lpNo);
    if (row.status !== LpProfileStatus.ACTIVE) {
      throw new BadRequestException(`Liquidity provider ${lpNo} is not ACTIVE (status=${row.status}) — cannot open an LP exchange order against it.`);
    }
  }

  /** 对外投影（铁律⑥）：无 id。 */
  toView(row: LiquidityProvider): LpProfileView {
    return {
      lpNo: row.lpNo,
      name: row.name,
      fiatBankName: row.fiatBankName,
      fiatIban: row.fiatIban,
      cryptoNetwork: row.cryptoNetwork,
      cryptoAddress: row.cryptoAddress,
      agreementRef: row.agreementRef,
      status: row.status,
      approvalNo: row.approvalNo ?? null,
      createdBy: row.createdByUserId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ── 建档 ────────────────────────────────────────────────────────────

  async create(actor: ApprovalActorContext, dto: CreateLpProfileDto): Promise<LiquidityProvider> {
    const row = await this.prisma.liquidityProvider.create({
      data: {
        lpNo: generateReferenceNo('LPP'),
        name: dto.name,
        fiatBankName: dto.fiatBankName,
        fiatIban: dto.fiatIban,
        cryptoNetwork: dto.cryptoNetwork,
        cryptoAddress: dto.cryptoAddress,
        agreementRef: dto.agreementRef,
        status: LpProfileStatus.PENDING_APPROVAL,
        createdByUserId: actor.userNo ?? actor.userId,
      },
    });
    await this.writeAudit(AuditActions.LP_PROFILE_CREATED, row, {
      reason: dto.reason,
      actor,
      metadata: { name: row.name, agreementRef: row.agreementRef },
    });
    return row;
  }

  // ── 迁移 ────────────────────────────────────────────────────────────

  assertTransition(from: string, to: string): void {
    const allowed = LP_PROFILE_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) throw new BadRequestException(`Illegal LP profile status transition: ${from} → ${to}`);
  }

  async transition(lpNo: string, to: LpProfileStatus, patch: Record<string, unknown> = {}, audit?: LpProfileTransitionAudit): Promise<LiquidityProvider> {
    const row = await this.findByNo(lpNo);
    this.assertTransition(row.status, to);
    const action = ACTION_BY_EDGE[`${row.status}->${to}`];
    if (!action) {
      // 完整性闸：LP_PROFILE_TRANSITIONS 的每条边都必须在 ACTION_BY_EDGE 登记对应审计码，
      // 否则会静默丢审计（assertActionSpec 对未注册的 action 直接 return，不报错）——
      // 铁律①操作必留痕不容许这个洞，故显式炸而不是悄悄放过。评审随轮小项：闸挪到
      // update 之前——挪之前闸炸时状态已落库却无审计，恰是本闸自己声称要防的洞。
      throw new InternalServerErrorException(`No audit action registered for LP profile edge ${row.status} → ${to}.`);
    }
    const updated = await this.prisma.liquidityProvider.update({ where: { lpNo }, data: { status: to, ...patch } });
    await this.writeAudit(action, updated, {
      fromStatus: row.status,
      toStatus: to,
      approvalNo: audit?.approvalNo,
      causationId: audit?.causationId,
      reason: audit?.reason,
      actor: audit?.actor,
    });
    return updated;
  }

  /** 铁律③同款：approvalNo 回填走主体服务，workflow 不直写自己域外的表。 */
  async stampApprovalNo(lpNo: string, approvalNo: string): Promise<void> {
    await this.prisma.liquidityProvider.update({ where: { lpNo }, data: { approvalNo } });
  }

  // ── 改结算坐标（动作不是状态，只许 ACTIVE 期间落地） ──────────────────────

  async applySettlementChange(lpNo: string, patch: ApplySettlementChangeInput): Promise<LiquidityProvider> {
    const row = await this.findByNo(lpNo);
    if (row.status !== LpProfileStatus.ACTIVE) {
      throw new BadRequestException(`Cannot apply a settlement change to ${lpNo} while status is ${row.status} — the profile must be ACTIVE.`);
    }
    const { approvalNo, causationId, ...coordPatch } = patch;
    const before = { fiatBankName: row.fiatBankName, fiatIban: row.fiatIban, cryptoNetwork: row.cryptoNetwork, cryptoAddress: row.cryptoAddress };
    // 评审 Imp#1：approvalNo 列是建档审批单号（spec §2.1），改坐标不回写它——只更新
    // 传入的坐标字段，变更审批号只进审计（下方 writeAudit 的 approvalNo 专列 + INSTRUMENT 子主体）。
    const updated = await this.prisma.liquidityProvider.update({ where: { lpNo }, data: coordPatch });
    await this.writeAudit(AuditActions.LP_PROFILE_CHANGE_APPLIED, updated, {
      approvalNo,
      causationId,
      metadata: {
        before,
        after: { fiatBankName: updated.fiatBankName, fiatIban: updated.fiatIban, cryptoNetwork: updated.cryptoNetwork, cryptoAddress: updated.cryptoAddress },
      },
    });
    return updated;
  }

  // ── 审计（信封构造可复用；照划转单 transferAudit 的样子——action/subjects/metadata
  //     参数化，patch.actor 有则 recordByActor、无则 recordSystem。primarySubject 恒为
  //     LIQUIDITY_PROVIDER/lpNo；审批单为 INSTRUMENT 子主体；每条带显式 requestId。
  //     Task 3 会再加 recordChangeProposed，走同一个 writeAudit）──────────────────────

  private async writeAudit(action: string, row: LiquidityProvider, patch: {
    fromStatus?: string; toStatus?: string; approvalNo?: string; causationId?: string;
    reason?: string; metadata?: Record<string, unknown>; actor?: ApprovalActorContext;
  }): Promise<void> {
    const subjects: AuditSubjectInput[] = [
      { subjectType: AuditEntityTypes.LIQUIDITY_PROVIDER, subjectNo: row.lpNo, subjectRole: AuditSubjectRole.PRIMARY },
    ];
    if (patch.approvalNo) subjects.push({ subjectType: AuditEntityTypes.APPROVAL_CASE, subjectNo: patch.approvalNo, subjectRole: AuditSubjectRole.INSTRUMENT });
    const input: any = {
      action, actionDomain: 'TREASURY', category: AuditCategory.BUSINESS,
      workflowType: AuditBusinessWorkflowTypes.LP_PROFILE,
      primarySubjectType: AuditEntityTypes.LIQUIDITY_PROVIDER, primarySubjectNo: row.lpNo,
      subjects,
      fromStatus: patch.fromStatus, toStatus: patch.toStatus,
      approvalNo: patch.approvalNo, causationId: patch.causationId, reason: patch.reason,
      // CREATED 起档案自己的旅程（NONE——LiquidityProvider 没有 traceId 列）；其余继承
      // （INHERIT，读 lpNo：稳定业务键，够当锚，不必另开一列）。
      ...(action === AuditActions.LP_PROFILE_CREATED ? {} : { correlationId: row.lpNo }),
      requestId: `${action}_${row.lpNo}_${randomUUID()}`,
      metadata: { lpNo: row.lpNo, name: row.name, ...(patch.metadata ?? {}) },
      sourcePlatform: patch.actor ? 'ADMIN' : 'SYSTEM',
    };
    if (patch.actor) {
      const display = patch.actor.userNo ?? patch.actor.userId;
      await this.auditLogs.recordByActor(input, { actorType: 'ADMIN', actorNo: display, actorDisplayName: display, actorRolesAtTime: patch.actor.roleCodes ?? [] });
    } else {
      await this.auditLogs.recordSystem(input);
    }
  }
}

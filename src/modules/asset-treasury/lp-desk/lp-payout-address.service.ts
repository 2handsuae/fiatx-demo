// LP 两步准入 Task 3/4 · LP 打款地址簿主体：建行（登记即筛的落点计算）/ 六态六边迁移表 / 改标签 / 读投影，
// 外加 Task 4 补的审计留痕（LP_ADDRESS_* 九码）。照 LpProfileService 的域内惯例：审计动作全收在主体服务，
// workflow（lp-payout-address-workflow.service.ts）零审计写入——它只编排审批与调用本服务的公开方法。
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { LpPayoutAddress } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditBusinessWorkflowTypes, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditSubjectInput, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { TRAVEL_RULE_ADAPTER } from '../../sumsub-shared/travel-rule/travel-rule-adapter.interface';
import type { AddressAttributionResult, ScreeningAnswer, TravelRuleAdapter } from '../../sumsub-shared/travel-rule/travel-rule-adapter.interface';
import { BANK_RAIL_NETWORK } from '../withdrawal-addresses/withdrawal-address.service';
import { LpProfileStatus } from './dto/lp-profile.dto';
import { LpProfileService } from './lp-profile.service';
import {
  assertLpPayoutAddressTransition,
  LpPayoutAddressAction,
  LpPayoutAddressStatus,
  LP_PAYOUT_ADDRESS_TERMINAL_STATUSES,
} from './constants/lp-payout-address-transitions.constant';

/**
 * 登记入参——只认业务键 lpNo（lpId 由服务内部解析，调用方不碰 UUID）。
 * 坐标二选一：带 iban = 法币组（iban / bankName / swiftBic）；否则链上组（network / address / declaredHosting）。
 */
export interface CreateLpPayoutAddressInput {
  lpNo: string;
  assetId: string;
  network?: string;
  address?: string;
  /** 金库替 LP 自报的托管方式；链上必填，法币忽略（恒 null） */
  declaredHosting?: 'SELF_CUSTODY' | 'VASP';
  iban?: string;
  bankName?: string;
  swiftBic?: string;
  /** 协议锚（合同附件 / 条款引用号），必填，trim 后非空 */
  evidenceRef: string;
  label?: string;
  traceId?: string;
}

/** transition() 的可选落库补丁——approvalNo 与 ⚡覆写筛查结论（喂 RED 走 REJECT 边），别的字段一律不收。
 *  （workflow 在提交审批当下就经 stampApprovalNo 回填了 approvalNo，批准边不再重复带它。） */
export interface LpPayoutAddressTransitionPatch {
  approvalNo?: string;
  screeningAnswer?: ScreeningAnswer;
  screenedAt?: Date;
}

/** transition() 的审计上下文：人为动作带 actor（recordByActor）；审批裁决 / 系统驱动省略 actor（recordSystem），
 *  审批驱动的边带 approvalNo + causationId（APPROVED 契约 requiresCausation）。 */
export interface LpPayoutAddressAuditContext {
  actor?: ApprovalActorContext;
  approvalNo?: string;
  causationId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

/** 登记即拒（落点计算）的固定拒因。 */
export const LP_ADDRESS_SCREENING_RED_REASON = 'Screening returned RED at registration';

/** 迁移动作 → 审计码。键类型是动作枚举：新增一条边不登记审计码 = tsc 当场红（比运行时闸更早，
 *  且不存在「状态已落库、审计码缺失」的静默丢痕）。 */
const AUDIT_CODE_BY_ACTION: Record<LpPayoutAddressAction, string> = {
  [LpPayoutAddressAction.APPROVE]: AuditActions.LP_ADDRESS_APPROVED,
  [LpPayoutAddressAction.REJECT]: AuditActions.LP_ADDRESS_REJECTED,
  [LpPayoutAddressAction.CANCEL]: AuditActions.LP_ADDRESS_CANCELLED,
  [LpPayoutAddressAction.SUSPEND]: AuditActions.LP_ADDRESS_SUSPENDED,
  [LpPayoutAddressAction.REACTIVATE]: AuditActions.LP_ADDRESS_REACTIVATED,
  [LpPayoutAddressAction.DEACTIVATE]: AuditActions.LP_ADDRESS_DEACTIVATED,
};

/** 对外投影（铁律⑥）：无 id / lpId / assetId / traceId，带 lpNo 与 assetCode。 */
export interface LpPayoutAddressView {
  addressNo: string;
  lpNo: string;
  assetCode: string | null;
  network: string | null;
  address: string | null;
  iban: string | null;
  bankName: string | null;
  swiftBic: string | null;
  declaredHosting: string | null;
  addressType: string | null;
  hostingMismatch: boolean;
  counterpartyVaspName: string | null;
  counterpartyVaspDid: string | null;
  screeningAnswer: string | null;
  screenedAt: string | null;
  evidenceRef: string;
  label: string | null;
  approvalNo: string | null;
  status: string;
  suspendedAt: string | null;
  cancelledAt: string | null;
  deactivatedAt: string | null;
  createdAt: string;
}

@Injectable()
export class LpPayoutAddressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: LpProfileService,
    @Inject(TRAVEL_RULE_ADAPTER) private readonly travelRule: TravelRuleAdapter,
    private readonly auditLogs: AuditLogsService,
  ) {}

  // ── 登记 ────────────────────────────────────────────────────────────

  /**
   * 建行 + 登记即筛的落点计算（插入时一次算出，不是边）：
   *  - 链上：adapter 归因（VASP / 自托管）→ 比对金库自报，不一致 = hostingMismatch 红旗（留痕不拦截）；再筛查
   *  - 法币：IBAN 清洗后只筛查（传 BANK_RAIL_NETWORK），不归因、无托管自报
   *  - 筛查 RED 一票否决 → 直落 REJECTED（连 CFO 审批队列都进不去）；GREEN / YELLOW → PENDING_APPROVAL
   * 守卫：档案必须 ACTIVE ｜ evidenceRef trim 非空 ｜ 坐标二选一且组内必填（COORDINATE_REQUIRED）｜ 链上必填 declaredHosting ｜
   * 同 (lpId, 资产, 坐标) 非终态已存在 → 409 ADDRESS_ALREADY_REGISTERED（终态 REJECTED / CANCELLED / DEACTIVATED 后可重登）。
   * 留痕随写：REGISTERED（操作员 actor）→ SCREENED（系统，筛查是 Sumsub 侧 mock 能力）→ RED 时再加 REJECTED
   * （系统、固定拒因、无 fromStatus——插入即终态，落点不是边；同 LpProfileService.create 先例）。
   */
  async create(input: CreateLpPayoutAddressInput, actor: ApprovalActorContext): Promise<LpPayoutAddress> {
    const profile = await this.profiles.findByNo(input.lpNo);
    if (profile.status !== LpProfileStatus.ACTIVE) {
      throw new ConflictException({ code: 'LP_PROFILE_NOT_ACTIVE', message: `Liquidity provider ${profile.lpNo} is ${profile.status} — payout addresses can only be registered on an ACTIVE profile` });
    }
    const evidenceRef = input.evidenceRef.trim();
    if (!evidenceRef) {
      throw new BadRequestException({ code: 'EVIDENCE_REF_REQUIRED', message: 'evidenceRef (agreement clause / contract attachment reference) is required' });
    }

    // 坐标二选一且组内必填（表单业务语义，同 evidenceRef 必填；只判有无，不做格式校验）：
    // 法币 = 清洗后的 IBAN；链上 = (network, address)。下面所有读写都只用这里判定过非空的局部量构造——
    // 查重 where 里不可能出现 undefined 键（Prisma 会静默忽略 undefined，占坑查重就退化成「同 LP 同资产任一行」）。
    let coordinate: { iban: string } | { network: string; address: string };
    if (input.iban) {
      coordinate = { iban: input.iban.replace(/\s/g, '').toUpperCase() };
    } else {
      const { network, address } = input;
      if (!network || !address) {
        throw new BadRequestException({ code: 'COORDINATE_REQUIRED', message: 'a payout coordinate is required: an IBAN, or an on-chain network + address' });
      }
      coordinate = { network, address };
    }
    if (!('iban' in coordinate) && !input.declaredHosting) {
      throw new BadRequestException({ code: 'DECLARED_HOSTING_REQUIRED', message: 'declaredHosting (SELF_CUSTODY / VASP) is required for an on-chain address' });
    }

    const occupied = await this.prisma.lpPayoutAddress.findFirst({
      where: { lpId: profile.id, assetId: input.assetId, ...coordinate, status: { notIn: [...LP_PAYOUT_ADDRESS_TERMINAL_STATUSES] } },
    });
    if (occupied) {
      throw new ConflictException({ code: 'ADDRESS_ALREADY_REGISTERED', message: `This payout coordinate is already registered for ${profile.lpNo} (${occupied.addressNo}, ${occupied.status})` });
    }

    let attribution: AddressAttributionResult | undefined;
    let addressType: string;
    let hostingMismatch = false;
    let screeningAnswer: ScreeningAnswer;
    if ('iban' in coordinate) {
      addressType = 'BANK';
      screeningAnswer = await this.travelRule.screenAddress(coordinate.iban, BANK_RAIL_NETWORK);
    } else {
      attribution = await this.travelRule.attributeAddress(coordinate.address, coordinate.network);
      addressType = attribution.attributed ? 'VASP' : 'SELF_CUSTODY';
      hostingMismatch = input.declaredHosting !== addressType;
      screeningAnswer = await this.travelRule.screenAddress(coordinate.address, coordinate.network);
    }

    const rejected = screeningAnswer === 'RED';
    const row = await this.prisma.lpPayoutAddress.create({
      data: {
        addressNo: generateReferenceNo('LPA'),
        lpId: profile.id,
        lpNo: profile.lpNo,
        assetId: input.assetId,
        ...('iban' in coordinate
          ? { iban: coordinate.iban, bankName: input.bankName, swiftBic: input.swiftBic }
          : { network: coordinate.network, address: coordinate.address, declaredHosting: input.declaredHosting }),
        addressType,
        hostingMismatch,
        counterpartyVaspName: attribution?.vaspName,
        counterpartyVaspDid: attribution?.vaspDid,
        screeningAnswer,
        screenedAt: new Date(),
        evidenceRef,
        label: input.label,
        status: rejected ? LpPayoutAddressStatus.REJECTED : LpPayoutAddressStatus.PENDING_APPROVAL,
        traceId: input.traceId ?? randomUUID(),
      },
    });

    const assetCode = (await this.assetCodes([row.assetId])).get(row.assetId) ?? null;
    await this.writeAudit(AuditActions.LP_ADDRESS_REGISTERED, row, { actor, afterData: this.registrationSnapshot(row, assetCode) });
    await this.writeAudit(AuditActions.LP_ADDRESS_SCREENED, row, {
      afterData: { screeningAnswer: row.screeningAnswer, screenedAt: row.screenedAt?.toISOString() },
      metadata: { screeningAnswer: row.screeningAnswer },
    });
    if (rejected) {
      await this.writeAudit(AuditActions.LP_ADDRESS_REJECTED, row, { toStatus: LpPayoutAddressStatus.REJECTED, reason: LP_ADDRESS_SCREENING_RED_REASON });
    }
    return row;
  }

  /** 审批单号回填（铁律③：workflow 不直写自己域外的表，回填走主体服务）。撤回要凭它找到在途审批单，故提交后立刻盖。 */
  async stampApprovalNo(addressNo: string, approvalNo: string): Promise<void> {
    await this.prisma.lpPayoutAddress.update({ where: { addressNo }, data: { approvalNo } });
  }

  // ── 迁移 / 筛查覆写 / 改标签 ───────────────────────────────────────────

  /**
   * 沿迁移表走一条边；非法跃迁 409。时间戳随动作盖（SUSPEND 盖 suspendedAt、REACTIVATE 清掉、CANCEL / DEACTIVATE 各盖各的）。
   * 留痕随写：每条边都有对应审计码（AUDIT_CODE_BY_ACTION）；audit 带 actor = 人为动作，省略 = 审批裁决 / 系统驱动。
   */
  async transition(
    addressNo: string,
    action: LpPayoutAddressAction,
    patch: LpPayoutAddressTransitionPatch = {},
    audit: LpPayoutAddressAuditContext = {},
  ): Promise<LpPayoutAddress> {
    const row = await this.findByNoOrThrow(addressNo);
    const to = assertLpPayoutAddressTransition(row.status, action);
    const now = new Date();
    const stamp =
      action === LpPayoutAddressAction.SUSPEND ? { suspendedAt: now }
      : action === LpPayoutAddressAction.REACTIVATE ? { suspendedAt: null }
      : action === LpPayoutAddressAction.CANCEL ? { cancelledAt: now }
      : action === LpPayoutAddressAction.DEACTIVATE ? { deactivatedAt: now }
      : {};
    const updated = await this.prisma.lpPayoutAddress.update({ where: { addressNo }, data: { status: to, ...stamp, ...patch } });
    await this.writeAudit(AUDIT_CODE_BY_ACTION[action], updated, { fromStatus: row.status, toStatus: to, ...audit });
    return updated;
  }

  /**
   * ⚡筛查覆写（GREEN / YELLOW）：只改筛查结论，不迁移——仅 PENDING_APPROVAL，其余态 409（⚡不是绕迁移表的直写通道）。
   * RED 不走这里：RED 是 REJECT 边，由 workflow 经 transition(REJECT, { screeningAnswer: 'RED', … }) 落。
   */
  async recordScreening(
    addressNo: string,
    answer: Exclude<ScreeningAnswer, 'RED'>,
    reason: string,
    actor: ApprovalActorContext,
  ): Promise<LpPayoutAddress> {
    const row = await this.findByNoOrThrow(addressNo);
    if (row.status !== LpPayoutAddressStatus.PENDING_APPROVAL) {
      throw new ConflictException({ code: 'ADDRESS_NOT_PENDING', message: `Screening can only be overridden on a pending-approval address (got ${row.status})` });
    }
    const screenedAt = new Date();
    const updated = await this.prisma.lpPayoutAddress.update({ where: { addressNo }, data: { screeningAnswer: answer, screenedAt } });
    await this.writeAudit(AuditActions.LP_ADDRESS_SCREENED, updated, {
      actor,
      reason,
      beforeData: { screeningAnswer: row.screeningAnswer },
      afterData: { screeningAnswer: answer, screenedAt: screenedAt.toISOString() },
      metadata: { screeningAnswer: answer, screeningFedBy: actor.userNo ?? actor.userId },
    });
    return updated;
  }

  /** 登记后坐标与申报冻结，改只改 label——签名只收 label（外加留痕要的 actor），改坐标 = 新登记。 */
  async updateLabel(addressNo: string, label: string, actor: ApprovalActorContext): Promise<LpPayoutAddress> {
    const row = await this.findByNoOrThrow(addressNo);
    const updated = await this.prisma.lpPayoutAddress.update({ where: { addressNo }, data: { label } });
    await this.writeAudit(AuditActions.LP_ADDRESS_LABEL_UPDATED, updated, { actor, beforeData: { label: row.label }, afterData: { label } });
    return updated;
  }

  // ── 读 ──────────────────────────────────────────────────────────────

  /** 原始行（内部消费方用：开单守卫要 lpId / assetId / status）；不存在返回 null，调用方自定拒绝口径。 */
  async findByNo(addressNo: string): Promise<LpPayoutAddress | null> {
    return this.prisma.lpPayoutAddress.findUnique({ where: { addressNo } });
  }

  async listByLp(lpNo: string): Promise<LpPayoutAddressView[]> {
    const rows = await this.prisma.lpPayoutAddress.findMany({ where: { lpNo }, orderBy: { createdAt: 'desc' } });
    const codes = await this.assetCodes(rows.map((r) => r.assetId));
    return rows.map((r) => this.toView(r, codes.get(r.assetId) ?? null));
  }

  async getView(addressNo: string): Promise<LpPayoutAddressView> {
    const row = await this.findByNoOrThrow(addressNo);
    const codes = await this.assetCodes([row.assetId]);
    return this.toView(row, codes.get(row.assetId) ?? null);
  }

  /** 对外投影（铁律⑥）：无 id / lpId / assetId / traceId。 */
  toView(row: LpPayoutAddress, assetCode: string | null): LpPayoutAddressView {
    return {
      addressNo: row.addressNo,
      lpNo: row.lpNo,
      assetCode,
      network: row.network,
      address: row.address,
      iban: row.iban,
      bankName: row.bankName,
      swiftBic: row.swiftBic,
      declaredHosting: row.declaredHosting,
      addressType: row.addressType,
      hostingMismatch: row.hostingMismatch,
      counterpartyVaspName: row.counterpartyVaspName,
      counterpartyVaspDid: row.counterpartyVaspDid,
      screeningAnswer: row.screeningAnswer,
      screenedAt: row.screenedAt ? row.screenedAt.toISOString() : null,
      evidenceRef: row.evidenceRef,
      label: row.label,
      approvalNo: row.approvalNo,
      status: row.status,
      suspendedAt: row.suspendedAt ? row.suspendedAt.toISOString() : null,
      cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
      deactivatedAt: row.deactivatedAt ? row.deactivatedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ── 内部 ────────────────────────────────────────────────────────────

  private async findByNoOrThrow(addressNo: string): Promise<LpPayoutAddress> {
    const row = await this.findByNo(addressNo);
    if (!row) throw new NotFoundException({ code: 'LP_PAYOUT_ADDRESS_NOT_FOUND', message: `LP payout address ${addressNo} not found` });
    return row;
  }

  /** LpPayoutAddress.assetId 无 Prisma 关系（Task 1 裁定），assetCode 在此一次取齐。 */
  private async assetCodes(assetIds: string[]): Promise<Map<string, string>> {
    const assets = await this.prisma.asset.findMany({ where: { id: { in: [...new Set(assetIds)] } }, select: { id: true, code: true } });
    return new Map(assets.map((a) => [a.id, a.code]));
  }

  /** REGISTERED 审计的 afterData：登记时刻冻结的坐标 / 申报 / 归因 / 协议锚（业务值，零 UUID）。 */
  private registrationSnapshot(row: LpPayoutAddress, assetCode: string | null): Record<string, unknown> {
    return {
      assetCode,
      network: row.network, address: row.address,
      iban: row.iban, bankName: row.bankName, swiftBic: row.swiftBic,
      declaredHosting: row.declaredHosting, addressType: row.addressType, hostingMismatch: row.hostingMismatch,
      counterpartyVaspName: row.counterpartyVaspName, counterpartyVaspDid: row.counterpartyVaspDid,
      evidenceRef: row.evidenceRef, label: row.label,
    };
  }

  // ── 审计（信封构造集中在此：primarySubject 恒为 LP_ADDRESS/addressNo，所属 LP 为 RELATED 子主体，审批单为
  //     INSTRUMENT 子主体；correlationId 恒取地址自己的 traceId——REGISTERED 是 START 铸旅程、其余 INHERIT 同一旅程；
  //     每条带显式 requestId（漏了会被静默去重）；patch.actor 有则 recordByActor、无则 recordSystem）──────────────

  private async writeAudit(action: string, row: LpPayoutAddress, patch: {
    fromStatus?: string; toStatus?: string; approvalNo?: string; causationId?: string; reason?: string;
    beforeData?: Record<string, unknown>; afterData?: Record<string, unknown>; metadata?: Record<string, unknown>;
    actor?: ApprovalActorContext;
  }): Promise<void> {
    const subjects: AuditSubjectInput[] = [
      { subjectType: AuditEntityTypes.LP_ADDRESS, subjectNo: row.addressNo, subjectRole: AuditSubjectRole.PRIMARY },
      { subjectType: AuditEntityTypes.LIQUIDITY_PROVIDER, subjectNo: row.lpNo, subjectRole: AuditSubjectRole.RELATED },
    ];
    if (patch.approvalNo) subjects.push({ subjectType: AuditEntityTypes.APPROVAL_CASE, subjectNo: patch.approvalNo, subjectRole: AuditSubjectRole.INSTRUMENT });
    const input: any = {
      action, actionDomain: 'TREASURY', category: AuditCategory.BUSINESS,
      workflowType: AuditBusinessWorkflowTypes.LP_ADDRESS,
      primarySubjectType: AuditEntityTypes.LP_ADDRESS, primarySubjectNo: row.addressNo,
      subjects,
      fromStatus: patch.fromStatus, toStatus: patch.toStatus,
      approvalNo: patch.approvalNo, causationId: patch.causationId, reason: patch.reason,
      beforeData: patch.beforeData, afterData: patch.afterData,
      correlationId: row.traceId,
      requestId: `${action}_${row.addressNo}_${randomUUID()}`,
      metadata: { addressNo: row.addressNo, lpNo: row.lpNo, ...(patch.metadata ?? {}) },
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

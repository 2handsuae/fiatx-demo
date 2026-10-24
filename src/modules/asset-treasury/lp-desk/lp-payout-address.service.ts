// LP 两步准入 Task 3 · LP 打款地址簿主体：建行（登记即筛的落点计算）/ 六态六边迁移表 / 改标签 / 读投影。
// 本服务只管状态与数据——审计码族（LP_ADDRESS_*）与审批编排统一在 Task 4 落（写入位置照域内惯例收在主体服务）。
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { LpPayoutAddress } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
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

/** transition() 的可选落库补丁——approvalNo（批准时回填）与 ⚡覆写筛查结论（喂 RED 走 REJECT 边），别的字段一律不收。 */
export interface LpPayoutAddressTransitionPatch {
  approvalNo?: string;
  screeningAnswer?: ScreeningAnswer;
  screenedAt?: Date;
}

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
  ) {}

  // ── 登记 ────────────────────────────────────────────────────────────

  /**
   * 建行 + 登记即筛的落点计算（插入时一次算出，不是边）：
   *  - 链上：adapter 归因（VASP / 自托管）→ 比对金库自报，不一致 = hostingMismatch 红旗（留痕不拦截）；再筛查
   *  - 法币：IBAN 清洗后只筛查（传 BANK_RAIL_NETWORK），不归因、无托管自报
   *  - 筛查 RED 一票否决 → 直落 REJECTED（连 CFO 审批队列都进不去）；GREEN / YELLOW → PENDING_APPROVAL
   * 守卫：档案必须 ACTIVE ｜ evidenceRef trim 非空 ｜ 链上必填 declaredHosting ｜
   * 同 (lpId, 资产, 坐标) 非终态已存在 → 409 ADDRESS_ALREADY_REGISTERED（终态 REJECTED / CANCELLED / DEACTIVATED 后可重登）。
   */
  async create(input: CreateLpPayoutAddressInput): Promise<LpPayoutAddress> {
    const profile = await this.profiles.findByNo(input.lpNo);
    if (profile.status !== LpProfileStatus.ACTIVE) {
      throw new ConflictException({ code: 'LP_PROFILE_NOT_ACTIVE', message: `Liquidity provider ${profile.lpNo} is ${profile.status} — payout addresses can only be registered on an ACTIVE profile` });
    }
    const evidenceRef = input.evidenceRef.trim();
    if (!evidenceRef) {
      throw new BadRequestException({ code: 'EVIDENCE_REF_REQUIRED', message: 'evidenceRef (agreement clause / contract attachment reference) is required' });
    }
    const isFiat = Boolean(input.iban);
    if (!isFiat && !input.declaredHosting) {
      throw new BadRequestException({ code: 'DECLARED_HOSTING_REQUIRED', message: 'declaredHosting (SELF_CUSTODY / VASP) is required for an on-chain address' });
    }

    // 坐标：法币 = 清洗后的 IBAN；链上 = (network, address)
    const iban = isFiat ? input.iban!.replace(/\s/g, '').toUpperCase() : undefined;
    const coordinate = isFiat ? { iban } : { network: input.network, address: input.address };
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
    if (isFiat) {
      addressType = 'BANK';
      screeningAnswer = await this.travelRule.screenAddress(iban!, BANK_RAIL_NETWORK);
    } else {
      attribution = await this.travelRule.attributeAddress(input.address!, input.network!);
      addressType = attribution.attributed ? 'VASP' : 'SELF_CUSTODY';
      hostingMismatch = input.declaredHosting !== addressType;
      screeningAnswer = await this.travelRule.screenAddress(input.address!, input.network!);
    }

    return this.prisma.lpPayoutAddress.create({
      data: {
        addressNo: generateReferenceNo('LPA'),
        lpId: profile.id,
        lpNo: profile.lpNo,
        assetId: input.assetId,
        ...(isFiat
          ? { iban, bankName: input.bankName, swiftBic: input.swiftBic }
          : { network: input.network, address: input.address, declaredHosting: input.declaredHosting }),
        addressType,
        hostingMismatch,
        counterpartyVaspName: attribution?.vaspName,
        counterpartyVaspDid: attribution?.vaspDid,
        screeningAnswer,
        screenedAt: new Date(),
        evidenceRef,
        label: input.label,
        status: screeningAnswer === 'RED' ? LpPayoutAddressStatus.REJECTED : LpPayoutAddressStatus.PENDING_APPROVAL,
        traceId: input.traceId ?? randomUUID(),
      },
    });
  }

  // ── 迁移 / 改标签 ────────────────────────────────────────────────────

  /** 沿迁移表走一条边；非法跃迁 409。时间戳随动作盖（SUSPEND 盖 suspendedAt、REACTIVATE 清掉、CANCEL / DEACTIVATE 各盖各的）。 */
  async transition(addressNo: string, action: LpPayoutAddressAction, patch: LpPayoutAddressTransitionPatch = {}): Promise<LpPayoutAddress> {
    const row = await this.findByNoOrThrow(addressNo);
    const to = assertLpPayoutAddressTransition(row.status, action);
    const now = new Date();
    const stamp =
      action === LpPayoutAddressAction.SUSPEND ? { suspendedAt: now }
      : action === LpPayoutAddressAction.REACTIVATE ? { suspendedAt: null }
      : action === LpPayoutAddressAction.CANCEL ? { cancelledAt: now }
      : action === LpPayoutAddressAction.DEACTIVATE ? { deactivatedAt: now }
      : {};
    return this.prisma.lpPayoutAddress.update({ where: { addressNo }, data: { status: to, ...stamp, ...patch } });
  }

  /** 登记后坐标与申报冻结，改只改 label——签名只收 label，改坐标 = 新登记。 */
  async updateLabel(addressNo: string, label: string): Promise<LpPayoutAddress> {
    await this.findByNoOrThrow(addressNo);
    return this.prisma.lpPayoutAddress.update({ where: { addressNo }, data: { label } });
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
}

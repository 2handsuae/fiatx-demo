import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { assertNetwork, validateAddressForNetwork, NETWORKS, NETWORK_CODES } from '../../../config/manifests/networks.manifest';
import { validateIban, validateSwiftBic } from './bank-validator.util';
import { assertWithdrawalAddressTransition, WithdrawalAddressAction } from './constants/withdrawal-address-transitions.constant';

export const MAX_ADDRESSES_PER_NETWORK = 3;
const COOLING_PERIOD_HOURS = 24;
/** 唯一的银行通道网络：银行账户类地址都挂它（今天 = AED_ZAND） */
export const BANK_RAIL_NETWORK: string = NETWORK_CODES.map((c) => NETWORKS[c]).find((n) => n.kind === 'BANK_RAIL')!.code;
/** 占每网络 3 条名额的状态：等签名 / 冷却中 / 已生效（REJECTED 占坑靠唯一约束封禁，不占名额） */
const SLOT_HOLDING_STATUSES = ['PENDING_VERIFICATION', 'PENDING_ACTIVATION', 'ACTIVE'];

interface CreateAddressData {
  customerId: string;
  customerNo: string;
  network: string;
  address: string;
  addressType: string;
  label?: string;
  beneficiaryName?: string;
  memo?: string;
  counterpartyVaspName?: string;
  counterpartyVaspDid?: string;
  ownerType: 'SELF' | 'THIRD_PARTY';
  beneficiaryRelationship?: string;
  declaredHosting: 'SELF_CUSTODY' | 'VASP';
  /** 自报托管 ≠ 归因结论；由 workflow 比对后传入（只留痕不拦截） */
  hostingMismatch: boolean;
  /** 登记时的筛查结论，由 workflow 调 adapter 算好传入；RED → 登记即 REJECTED */
  screeningAnswer: 'GREEN' | 'YELLOW' | 'RED';
  traceId: string;
}

interface CreateBankAccountData {
  customerId: string;
  customerNo: string;
  iban: string;
  swiftBic: string;
  bankName: string;
  beneficiaryName: string;
  label?: string;
  ownerType: 'SELF' | 'THIRD_PARTY';
  beneficiaryRelationship?: string;
  screeningAnswer: 'GREEN' | 'YELLOW' | 'RED';
  traceId: string;
}

/** 证据档：第三方 → 声明书；本人 × 自托管 → 签名（登记后才落定）；本人 × 托管 / 银行 → 自声明 */
function ownershipProofFor(ownerType: 'SELF' | 'THIRD_PARTY', declaredHosting?: 'SELF_CUSTODY' | 'VASP'): 'SIGNATURE' | 'DECLARATION' | 'ATTESTATION' {
  if (ownerType === 'THIRD_PARTY') return 'ATTESTATION';
  return declaredHosting === 'SELF_CUSTODY' ? 'SIGNATURE' : 'DECLARATION';
}

@Injectable()
export class WithdrawalAddressService {
  private readonly logger = new Logger(WithdrawalAddressService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateAddressData, tx?: any) {
    const db = tx ?? this.prisma;
    const network = assertNetwork(data.network);
    if (network.kind !== 'CHAIN') {
      throw new BadRequestException({ code: 'NETWORK_NOT_CHAIN', message: `Only chain networks accept on-chain addresses (got ${network.code})` });
    }
    const validation = validateAddressForNetwork(network.code, data.address);
    if (!validation.valid) {
      throw new BadRequestException({ code: 'INVALID_ADDRESS_FORMAT', message: validation.reason });
    }

    const activeCount = await db.withdrawalAddress.count({
      where: { customerId: data.customerId, network: network.code, status: { in: SLOT_HOLDING_STATUSES } },
    });
    if (activeCount >= MAX_ADDRESSES_PER_NETWORK) {
      throw new BadRequestException({ code: 'ADDRESS_LIMIT_REACHED', message: `Maximum ${MAX_ADDRESSES_PER_NETWORK} addresses per network` });
    }

    const addressNo = generateReferenceNo('WAD');
    const now = new Date();
    const cooling = new Date(now.getTime() + COOLING_PERIOD_HOURS * 60 * 60 * 1000);
    const ownershipProofType = ownershipProofFor(data.ownerType, data.declaredHosting);
    // 登记落点（插入时一次算出，不是边）：RED 压过一切 → 终态 REJECTED；
    // 自托管 × 本人要等签名（等待态的 activatesAt 只是占位，release 时重算冷却）；其余直接进冷却
    const rejected = data.screeningAnswer === 'RED';
    const status = rejected ? 'REJECTED' : ownershipProofType === 'SIGNATURE' ? 'PENDING_VERIFICATION' : 'PENDING_ACTIVATION';
    const activatesAt = rejected ? now : cooling;
    try {
      return await db.withdrawalAddress.create({
        data: {
          addressNo,
          customerId: data.customerId,
          customerNo: data.customerNo,
          network: network.code,
          address: data.address,
          addressType: data.addressType,
          label: data.label,
          beneficiaryName: data.beneficiaryName,
          memo: data.memo,
          counterpartyVaspName: data.counterpartyVaspName,
          counterpartyVaspDid: data.counterpartyVaspDid,
          ownerType: data.ownerType,
          beneficiaryRelationship: data.beneficiaryRelationship,
          declaredHosting: data.declaredHosting,
          hostingMismatch: data.hostingMismatch,
          screeningAnswer: data.screeningAnswer,
          screenedAt: now,
          ownershipDeclaredAt: now,
          ownershipProofType,
          status,
          activatesAt,
          traceId: data.traceId,
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ConflictException({ code: 'ADDRESS_ALREADY_REGISTERED', message: 'This address is already registered on this network' });
      }
      throw error;
    }
  }

  async createBankAccount(data: CreateBankAccountData, tx?: any) {
    const ibanResult = validateIban(data.iban);
    if (!ibanResult.valid) throw new BadRequestException({ code: 'INVALID_IBAN', message: ibanResult.reason });
    const swiftResult = validateSwiftBic(data.swiftBic);
    if (!swiftResult.valid) throw new BadRequestException({ code: 'INVALID_SWIFT_BIC', message: swiftResult.reason });

    const cleanIban = data.iban.replace(/\s/g, '').toUpperCase();
    const cleanSwift = data.swiftBic.replace(/\s/g, '').toUpperCase();
    const addressNo = generateReferenceNo('WAD');

    const run = async (db: any) => {
      const activeCount = await db.withdrawalAddress.count({
        where: { customerId: data.customerId, network: BANK_RAIL_NETWORK, status: { in: SLOT_HOLDING_STATUSES } },
      });
      if (activeCount >= MAX_ADDRESSES_PER_NETWORK) {
        throw new BadRequestException({ code: 'ADDRESS_LIMIT_REACHED', message: `Maximum ${MAX_ADDRESSES_PER_NETWORK} bank accounts per network` });
      }

      // RED 压过一切（含首法币规则）：登记即 REJECTED，不是边。否则尾号 3333 的首个 IBAN 会被「首法币直落 ACTIVE」短路成放行
      const rejected = data.screeningAnswer === 'RED';
      // 首个法币账户即时生效（登记时余额为零，无盗提风险）——交易起始前置门的起点。银行路径永不落 PENDING_VERIFICATION，故此处集合不扩
      const isFirst = !rejected && (await db.withdrawalAddress.count({
        where: { customerId: data.customerId, addressType: 'BANK', status: { in: ['PENDING_ACTIVATION', 'ACTIVE'] } },
      })) === 0;

      const now = new Date();
      const status = rejected ? 'REJECTED' : isFirst ? 'ACTIVE' : 'PENDING_ACTIVATION';
      const activatesAt = rejected || isFirst ? now : new Date(now.getTime() + COOLING_PERIOD_HOURS * 60 * 60 * 1000);
      const activatedAt = isFirst ? now : null;

      try {
        return await db.withdrawalAddress.create({
          data: {
            addressNo,
            customerId: data.customerId,
            customerNo: data.customerNo,
            network: BANK_RAIL_NETWORK,
            address: cleanIban,
            addressType: 'BANK',
            label: data.label,
            beneficiaryName: data.beneficiaryName,
            iban: cleanIban,
            swiftBic: cleanSwift,
            bankName: data.bankName,
            ownerType: data.ownerType,
            beneficiaryRelationship: data.beneficiaryRelationship,
            screeningAnswer: data.screeningAnswer,
            screenedAt: now,
            ownershipDeclaredAt: now,
            ownershipProofType: ownershipProofFor(data.ownerType),
            status,
            activatesAt,
            activatedAt,
            traceId: data.traceId,
          },
        });
      } catch (error: any) {
        if (error?.code === 'P2002') {
          throw new ConflictException({ code: 'BANK_ACCOUNT_ALREADY_REGISTERED', message: 'This IBAN is already registered' });
        }
        throw error;
      }
    };

    if (tx) return run(tx);
    return this.prisma.$transaction((txClient: any) => run(txClient));
  }

  /** 冷却到期激活（扫描 / 懒激活）。时间未到 400；状态不对 409（迁移表） */
  async activate(addressNo: string, tx?: any) {
    const db = tx ?? this.prisma;
    const addr = await this.findByNoOrThrow(addressNo, db);
    const to = assertWithdrawalAddressTransition(addr.status, WithdrawalAddressAction.ACTIVATE);
    if (addr.activatesAt > new Date()) {
      throw new BadRequestException({ code: 'COOLING_PERIOD_NOT_EXPIRED', message: 'Cooling period has not expired yet' });
    }
    return db.withdrawalAddress.update({ where: { addressNo }, data: { status: to, activatedAt: new Date() } });
  }

  async cancel(addressNo: string, customerId: string, tx?: any) {
    const db = tx ?? this.prisma;
    const addr = await this.findByNoOrThrow(addressNo, db);
    if (addr.customerId !== customerId) {
      throw new ForbiddenException({ code: 'NOT_OWNER', message: 'You can only cancel your own addresses' });
    }
    const to = assertWithdrawalAddressTransition(addr.status, WithdrawalAddressAction.CANCEL);
    return db.withdrawalAddress.update({ where: { addressNo }, data: { status: to, cancelledAt: new Date() } });
  }

  async suspend(addressNo: string, adminNo: string, reason: string, tx?: any) {
    const db = tx ?? this.prisma;
    const addr = await this.findByNoOrThrow(addressNo, db);
    const to = assertWithdrawalAddressTransition(addr.status, WithdrawalAddressAction.SUSPEND);
    return db.withdrawalAddress.update({
      where: { addressNo },
      data: { status: to, suspendedAt: new Date(), suspendedBy: adminNo, suspendReason: reason },
    });
  }

  async unsuspend(addressNo: string, tx?: any) {
    const db = tx ?? this.prisma;
    const addr = await this.findByNoOrThrow(addressNo, db);
    const to = assertWithdrawalAddressTransition(addr.status, WithdrawalAddressAction.UNSUSPEND);
    return db.withdrawalAddress.update({
      where: { addressNo },
      data: { status: to, suspendedAt: null, suspendedBy: null, suspendReason: null },
    });
  }

  /** ⚡ 后门：同一条 ACTIVATE 边，只是不看时间 */
  async skipCooling(addressNo: string, tx?: any) {
    const db = tx ?? this.prisma;
    const addr = await this.findByNoOrThrow(addressNo, db);
    const to = assertWithdrawalAddressTransition(addr.status, WithdrawalAddressAction.ACTIVATE);
    return db.withdrawalAddress.update({ where: { addressNo }, data: { status: to, activatedAt: new Date() } });
  }

  /** 两绿汇合（签名验证通过）：RELEASE 边，PENDING_VERIFICATION → PENDING_ACTIVATION。冷却自 release 起算——重算 activatesAt，不沿用登记时刻的值 */
  async releaseToCooling(addressNo: string, tx?: any) {
    const db = tx ?? this.prisma;
    const addr = await this.findByNoOrThrow(addressNo, db);
    const to = assertWithdrawalAddressTransition(addr.status, WithdrawalAddressAction.RELEASE);
    const activatesAt = new Date(Date.now() + COOLING_PERIOD_HOURS * 60 * 60 * 1000);
    return db.withdrawalAddress.update({ where: { addressNo }, data: { status: to, activatesAt } });
  }

  /** 筛查 RED（⚡喂 RED）：REJECT 边，两个 pending 态 → REJECTED（终态，占坑即封禁） */
  async rejectByScreening(addressNo: string, tx?: any) {
    const db = tx ?? this.prisma;
    const addr = await this.findByNoOrThrow(addressNo, db);
    const to = assertWithdrawalAddressTransition(addr.status, WithdrawalAddressAction.REJECT);
    return db.withdrawalAddress.update({ where: { addressNo }, data: { status: to, screeningAnswer: 'RED', screenedAt: new Date() } });
  }

  /** ⚡喂 GREEN / YELLOW：覆写登记时 mock 筛查给的结论；只写字段不迁移，非 pending 态 409 */
  async recordScreening(addressNo: string, answer: 'GREEN' | 'YELLOW') {
    const addr = await this.findByNoOrThrow(addressNo, this.prisma);
    if (addr.status !== 'PENDING_VERIFICATION' && addr.status !== 'PENDING_ACTIVATION') {
      throw new ConflictException({ code: 'ADDRESS_NOT_PENDING', message: `Screening can only be recorded on a pending address (got ${addr.status})` });
    }
    return this.prisma.withdrawalAddress.update({ where: { addressNo }, data: { screeningAnswer: answer, screenedAt: new Date() } });
  }

  /** 客户签名验证（mock 即点即过）：写 ownershipVerifiedAt，再走 RELEASE 边进冷却 */
  async verifyOwnershipSignature(addressNo: string, customerId: string) {
    const addr = await this.findByNoOrThrow(addressNo, this.prisma);
    if (addr.customerId !== customerId) {
      throw new ForbiddenException({ code: 'NOT_OWNER', message: 'You can only verify your own addresses' });
    }
    if (addr.status !== 'PENDING_VERIFICATION' || addr.ownershipProofType !== 'SIGNATURE' || addr.ownershipVerifiedAt) {
      throw new ConflictException({ code: 'SIGNATURE_NOT_APPLICABLE', message: 'This address is not awaiting a signature verification' });
    }
    return this.prisma.$transaction(async (tx: any) => {
      await tx.withdrawalAddress.update({ where: { addressNo }, data: { ownershipVerifiedAt: new Date() } });
      return this.releaseToCooling(addressNo, tx);
    });
  }

  async deactivate(addressNo: string, customerId: string) {
    const addr = await this.prisma.withdrawalAddress.findUnique({ where: { addressNo } });
    if (!addr || addr.customerId !== customerId) {
      throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: `Withdrawal address ${addressNo} not found` });
    }
    const to = assertWithdrawalAddressTransition(addr.status, WithdrawalAddressAction.DEACTIVATE);
    if (addr.addressType === 'BANK' && (await this.countActiveFiatAddresses(customerId)) <= 1) {
      throw new BadRequestException({ code: 'LAST_ACTIVE_FIAT_ADDRESS', message: '这是最后一个可用法币提现地址，请先新增并激活一个再停用' });
    }
    // 在途守卫：WithdrawTransaction 与地址簿无外键，只能按付款腿镜像的 toIban / toAddress 串匹配
    const inflight = await this.prisma.fundsOrder.count({
      where: {
        withdrawTransaction: { ownerType: 'CUSTOMER', ownerId: customerId },
        status: { notIn: ['CLEARED', 'FAILED', 'TIMEOUT'] },
        OR: [
          ...(addr.iban ? [{ toIban: addr.iban }] : []),
          ...(addr.address ? [{ toAddress: addr.address }] : []),
        ],
      },
    });
    if (inflight > 0) {
      throw new BadRequestException({ code: 'ADDRESS_HAS_INFLIGHT_WITHDRAWAL', message: 'This address has an in-flight withdrawal and cannot be deactivated' });
    }
    return this.prisma.withdrawalAddress.update({
      where: { id: addr.id },
      data: { status: to, deactivatedAt: new Date(), deactivatedBy: 'CUSTOMER' },
    });
  }

  /** 改：只收标签（申报证据字段登记后冻结）；终态不可改 */
  async updateDetails(addressNo: string, customerId: string, patch: { label?: string }) {
    const addr = await this.prisma.withdrawalAddress.findUnique({ where: { addressNo } });
    if (!addr) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: `Withdrawal address ${addressNo} not found` });
    if (addr.customerId !== customerId) throw new ForbiddenException({ code: 'NOT_OWNER', message: 'You can only edit your own addresses' });
    if (addr.status === 'CANCELLED' || addr.status === 'DEACTIVATED' || addr.status === 'REJECTED') {
      throw new ConflictException({ code: 'ADDRESS_TERMINAL', message: `Cannot edit an address in ${addr.status} status` });
    }
    const data: { label?: string } = {};
    if (patch.label !== undefined) data.label = patch.label;
    if (Object.keys(data).length === 0) throw new BadRequestException('Nothing to update: provide label');
    return this.prisma.withdrawalAddress.update({ where: { addressNo }, data });
  }

  async findByNo(addressNo: string) {
    const raw = await this.prisma.withdrawalAddress.findUnique({
      where: { addressNo },
      include: { customer: { select: { firstName: true, lastName: true } } },
    });
    if (!raw) return null;
    return this.flattenCustomerName(raw);
  }

  async listByCustomer(customerId: string, filters: { network?: string; status?: string; addressType?: string; take?: number; skip?: number }) {
    const where: any = { customerId };
    if (filters.network) where.network = filters.network;
    if (filters.status) where.status = filters.status;
    if (filters.addressType) where.addressType = filters.addressType;
    const [items, total] = await Promise.all([
      this.prisma.withdrawalAddress.findMany({ where, take: filters.take ?? 50, skip: filters.skip ?? 0, orderBy: [{ network: 'asc' }, { createdAt: 'desc' }] }),
      this.prisma.withdrawalAddress.count({ where }),
    ]);
    return { items, total };
  }

  async listAll(filters: { customerId?: string; customerNo?: string; network?: string; status?: string; addressType?: string; q?: string; take?: number; skip?: number }) {
    const where: any = {};
    if (filters.customerId) where.customerId = filters.customerId;
    if (filters.customerNo) where.customerNo = filters.customerNo;
    if (filters.network) where.network = filters.network;
    if (filters.status) where.status = filters.status;
    if (filters.addressType) where.addressType = filters.addressType;

    const q = filters.q?.trim();
    if (q) {
      where.OR = [
        { addressNo: { contains: q } },
        { address: { contains: q } },
        { iban: { contains: q } },
      ];
    }

    const [rawItems, total] = await Promise.all([
      this.prisma.withdrawalAddress.findMany({
        where, include: { customer: { select: { firstName: true, lastName: true } } },
        take: filters.take ?? 50, skip: filters.skip ?? 0,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.withdrawalAddress.count({ where }),
    ]);
    const items = rawItems.map(this.flattenCustomerName);
    return { items, total };
  }

  async hasActiveFiatWithdrawalAddress(customerId: string): Promise<boolean> {
    const n = await this.prisma.withdrawalAddress.count({
      where: { customerId, status: 'ACTIVE', addressType: 'BANK' },
    });
    return n > 0;
  }

  async countActiveFiatAddresses(customerId: string): Promise<number> {
    return this.prisma.withdrawalAddress.count({
      where: { customerId, status: 'ACTIVE', addressType: 'BANK' },
    });
  }

  async findPendingExpired() {
    return this.prisma.withdrawalAddress.findMany({
      where: { status: 'PENDING_ACTIVATION', activatesAt: { lte: new Date() } },
    });
  }

  async findExpiredPendingForCustomer(customerId: string, network?: string) {
    const where: any = { customerId, status: 'PENDING_ACTIVATION', activatesAt: { lte: new Date() } };
    if (network) where.network = network;
    return this.prisma.withdrawalAddress.findMany({ where });
  }

  private flattenCustomerName(r: any) {
    const { customer, ...rest } = r;
    const customerName = customer
      ? [customer.firstName, customer.lastName].filter(Boolean).join(' ') || null
      : null;
    return { ...rest, customerName };
  }

  private async findByNoOrThrow(addressNo: string, db: any) {
    const addr = await db.withdrawalAddress.findUnique({ where: { addressNo } });
    if (!addr) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: `Withdrawal address ${addressNo} not found` });
    return addr;
  }
}

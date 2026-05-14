import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { validateCryptoAddress } from './address-validator.util';

const MAX_ADDRESSES_PER_ASSET = 3;
const COOLING_PERIOD_HOURS = 24;

interface CreateAddressData {
  customerId: string;
  customerNo: string;
  assetId: string;
  network: string;
  address: string;
  addressType: string;
  label?: string;
  beneficiaryName?: string;
  memo?: string;
  counterpartyVaspName?: string;
  counterpartyVaspDid?: string;
  ownershipDeclaredAt: Date;
  ownershipProofType: string;
  traceId: string;
}

@Injectable()
export class WithdrawalAddressService {
  private readonly logger = new Logger(WithdrawalAddressService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateAddressData, tx?: any) {
    const db = tx ?? this.prisma;

    const validation = validateCryptoAddress(data.network, data.address);
    if (!validation.valid) {
      throw new BadRequestException({ code: 'INVALID_ADDRESS_FORMAT', message: validation.reason });
    }

    const activeCount = await db.withdrawalAddress.count({
      where: {
        customerId: data.customerId,
        assetId: data.assetId,
        status: { in: ['PENDING_ACTIVATION', 'ACTIVE'] },
      },
    });
    if (activeCount >= MAX_ADDRESSES_PER_ASSET) {
      throw new BadRequestException({ code: 'ADDRESS_LIMIT_REACHED', message: `Maximum ${MAX_ADDRESSES_PER_ASSET} addresses per asset` });
    }

    const addressNo = generateReferenceNo('WAD');
    const activatesAt = new Date(Date.now() + COOLING_PERIOD_HOURS * 60 * 60 * 1000);

    try {
      return await db.withdrawalAddress.create({
        data: {
          addressNo,
          customerId: data.customerId,
          customerNo: data.customerNo,
          assetId: data.assetId,
          network: data.network,
          address: data.address,
          addressType: data.addressType,
          label: data.label,
          beneficiaryName: data.beneficiaryName,
          memo: data.memo,
          counterpartyVaspName: data.counterpartyVaspName,
          counterpartyVaspDid: data.counterpartyVaspDid,
          ownershipDeclaredAt: data.ownershipDeclaredAt,
          ownershipProofType: data.ownershipProofType,
          activatesAt,
          traceId: data.traceId,
        },
        include: { asset: true },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ConflictException({ code: 'ADDRESS_ALREADY_REGISTERED', message: 'This address is already registered for this asset' });
      }
      throw error;
    }
  }

  async activate(addressNo: string, tx?: any) {
    const db = tx ?? this.prisma;
    const addr = await this.findByNoOrThrow(addressNo, db);

    if (addr.status === 'ACTIVE') return addr;

    if (addr.status !== 'PENDING_ACTIVATION') {
      throw new BadRequestException({ code: 'INVALID_STATUS', message: `Cannot activate address in ${addr.status} status` });
    }
    if (addr.activatesAt > new Date()) {
      throw new BadRequestException({ code: 'COOLING_PERIOD_NOT_EXPIRED', message: 'Cooling period has not expired yet' });
    }

    return db.withdrawalAddress.update({
      where: { addressNo },
      data: { status: 'ACTIVE', activatedAt: new Date() },
      include: { asset: true },
    });
  }

  async cancel(addressNo: string, customerId: string, tx?: any) {
    const db = tx ?? this.prisma;
    const addr = await this.findByNoOrThrow(addressNo, db);

    if (addr.customerId !== customerId) {
      throw new ForbiddenException({ code: 'NOT_OWNER', message: 'You can only cancel your own addresses' });
    }
    if (addr.status !== 'PENDING_ACTIVATION') {
      throw new BadRequestException({ code: 'INVALID_STATUS', message: `Cannot cancel address in ${addr.status} status` });
    }

    return db.withdrawalAddress.update({
      where: { addressNo },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
      include: { asset: true },
    });
  }

  async suspend(addressNo: string, adminNo: string, reason: string, tx?: any) {
    const db = tx ?? this.prisma;
    const addr = await this.findByNoOrThrow(addressNo, db);

    if (addr.status !== 'ACTIVE') {
      throw new BadRequestException({ code: 'INVALID_STATUS', message: `Cannot suspend address in ${addr.status} status` });
    }

    return db.withdrawalAddress.update({
      where: { addressNo },
      data: { status: 'SUSPENDED', suspendedAt: new Date(), suspendedBy: adminNo, suspendReason: reason },
      include: { asset: true },
    });
  }

  async skipCooling(addressNo: string, tx?: any) {
    const db = tx ?? this.prisma;
    const addr = await this.findByNoOrThrow(addressNo, db);

    if (addr.status !== 'PENDING_ACTIVATION') {
      throw new BadRequestException({ code: 'INVALID_STATUS', message: `Cannot skip cooling for address in ${addr.status} status` });
    }

    return db.withdrawalAddress.update({
      where: { addressNo },
      data: { status: 'ACTIVE', activatedAt: new Date() },
      include: { asset: true },
    });
  }

  async findByNo(addressNo: string) {
    return this.prisma.withdrawalAddress.findUnique({
      where: { addressNo },
      include: { asset: true, customer: true },
    });
  }

  async listByCustomer(customerId: string, filters: { assetId?: string; status?: string; addressType?: string; take?: number; skip?: number }) {
    const where: any = { customerId };
    if (filters.assetId) where.assetId = filters.assetId;
    if (filters.status) where.status = filters.status;
    if (filters.addressType) where.addressType = filters.addressType;

    const [items, total] = await Promise.all([
      this.prisma.withdrawalAddress.findMany({
        where, include: { asset: true },
        take: filters.take ?? 50, skip: filters.skip ?? 0,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.withdrawalAddress.count({ where }),
    ]);
    return { items, total };
  }

  async listAll(filters: { customerId?: string; assetId?: string; status?: string; addressType?: string; take?: number; skip?: number }) {
    const where: any = {};
    if (filters.customerId) where.customerId = filters.customerId;
    if (filters.assetId) where.assetId = filters.assetId;
    if (filters.status) where.status = filters.status;
    if (filters.addressType) where.addressType = filters.addressType;

    const [items, total] = await Promise.all([
      this.prisma.withdrawalAddress.findMany({
        where, include: { asset: true, customer: true },
        take: filters.take ?? 50, skip: filters.skip ?? 0,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.withdrawalAddress.count({ where }),
    ]);
    return { items, total };
  }

  async findPendingExpired() {
    return this.prisma.withdrawalAddress.findMany({
      where: { status: 'PENDING_ACTIVATION', activatesAt: { lte: new Date() } },
    });
  }

  async lazyActivateForCustomer(customerId: string, assetId?: string) {
    const where: any = { customerId, status: 'PENDING_ACTIVATION', activatesAt: { lte: new Date() } };
    if (assetId) where.assetId = assetId;
    const expired = await this.prisma.withdrawalAddress.findMany({ where });
    for (const addr of expired) {
      try { await this.activate(addr.addressNo); } catch { /* individual failures logged in activate */ }
    }
  }

  private async findByNoOrThrow(addressNo: string, db: any) {
    const addr = await db.withdrawalAddress.findUnique({ where: { addressNo } });
    if (!addr) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: `Withdrawal address ${addressNo} not found` });
    return addr;
  }
}

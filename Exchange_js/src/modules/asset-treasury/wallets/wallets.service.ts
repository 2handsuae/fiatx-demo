import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  CreateWalletDto,
  WalletStatus,
  OwnerType,
  WalletDirection,
  WalletType,
} from './dto/wallet.dto';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(private prisma: PrismaService) {}

  private resolveCustomerOwnerName(customer?: {
    companyName: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  }): string | null {
    if (!customer) return null;

    const companyName = customer.companyName?.trim();
    if (companyName) return companyName;

    const firstName = customer.firstName?.trim() || '';
    const lastName = customer.lastName?.trim() || '';
    const fullName = `${firstName} ${lastName}`.trim();
    if (fullName) return fullName;

    const email = customer.email?.trim();
    return email || null;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    );
  }

  async create(data: CreateWalletDto) {
    this.logger.log(`Creating wallet for ${data.ownerType}`);

    // Validate asset
    const asset = await this.prisma.asset.findUnique({
      where: { id: data.assetId },
    });
    if (!asset) throw new BadRequestException('Invalid Asset ID');

    if (data.ownerType === OwnerType.PLATFORM && data.ownerId) {
      throw new BadRequestException(
        'Owner ID must be empty for PLATFORM wallets',
      );
    }

    // Validate ownerId based on ownerType
    if (data.ownerType !== OwnerType.PLATFORM && !data.ownerId) {
      throw new BadRequestException(
        'Owner ID is required for non-PLATFORM wallets',
      );
    }

    if (data.ownerType === OwnerType.CUSTOMER && data.ownerId) {
      const customer = await this.prisma.customerMain.findUnique({
        where: { id: data.ownerId },
      });
      if (!customer) throw new BadRequestException('Invalid Customer ID');

      // Check for existing INBOUND wallet for this customer and asset to ensure uniqueness
      if (data.direction === WalletDirection.INBOUND) {
        const existing = await this.prisma.wallet.findFirst({
          where: {
            ownerType: OwnerType.CUSTOMER,
            ownerId: data.ownerId,
            assetId: data.assetId,
            direction: WalletDirection.INBOUND,
            type: data.type,
          },
          include: {
            asset: { select: { code: true, type: true } },
          },
        });
        if (existing) {
          this.logger.log(`Returning existing INBOUND wallet: ${existing.id}`);
          return existing;
        }
      }
    }

    // Auto-generate Address/IBAN for INBOUND CUSTOMER wallets if missing
    if (
      data.direction === WalletDirection.INBOUND &&
      data.ownerType === OwnerType.CUSTOMER
    ) {
      if (data.type === WalletType.CRYPTO_ADDRESS && !data.address) {
        // Mock Address Generation (e.g. ETH style)
        data.address = '0x' + crypto.randomBytes(20).toString('hex');
        this.logger.log(`Generated mock address: ${data.address}`);
      }
      if (data.type === WalletType.FIAT_BANK && !data.iban) {
        // Mock IBAN Generation
        data.iban =
          'US' +
          crypto.randomInt(10, 99) +
          'FIATX' +
          crypto.randomBytes(8).toString('hex').toUpperCase();
        if (!data.bankName) data.bankName = 'FiatX Virtual Bank';
        if (!data.accountName) data.accountName = 'Customer Account';
        this.logger.log(`Generated mock IBAN: ${data.iban}`);
      }
    }

    if (data.ownerType === OwnerType.LIQUIDITY_PROVIDER && data.ownerId) {
      const lp = await this.prisma.liquidityProvider.findUnique({
        where: { id: data.ownerId },
      });
      if (!lp) throw new BadRequestException('Invalid Liquidity Provider ID');
    }

    try {
      const result = await this.prisma.wallet.create({
        data: {
          walletNo: generateReferenceNo('WA'),
          ownerType: data.ownerType,
          ownerId: data.ownerType === OwnerType.PLATFORM ? null : data.ownerId,
          type: data.type,
          direction: data.direction,
          assetId: data.assetId,
          address: data.address,
          memo: data.memo,
          beneficiaryName: data.beneficiaryName,
          counterpartyVasp: data.counterpartyVasp,
          bankName: data.bankName,
          bankAccount: data.bankAccount,
          bankCode: data.bankCode,
          accountName: data.accountName,
          iban: data.iban,
          status: WalletStatus.ACTIVE,
        },
        include: {
          asset: { select: { code: true, type: true } },
        },
      });

      this.logger.log(`Wallet created: ${result.id}`);
      return result;
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new BadRequestException(
          'Inbound customer wallet already exists for this asset and type',
        );
      }
      throw error;
    }
  }

  async findAll(params: {
    skip?: number;
    take?: number;
    where?: Prisma.WalletWhereInput;
    orderBy?: Prisma.WalletOrderByWithRelationInput;
  }) {
    const { skip, take, where, orderBy } = params;
    const [items, total] = await Promise.all([
      this.prisma.wallet.findMany({
        skip,
        take,
        where,
        orderBy,
        include: {
          asset: { select: { code: true, type: true } },
        },
      }),
      this.prisma.wallet.count({ where }),
    ]);

    const customerOwnerIds = [
      ...new Set(
        items
          .filter(
            (item) =>
              item.ownerType === OwnerType.CUSTOMER &&
              typeof item.ownerId === 'string',
          )
          .map((item) => item.ownerId as string),
      ),
    ];

    const lpOwnerIds = [
      ...new Set(
        items
          .filter(
            (item) =>
              item.ownerType === OwnerType.LIQUIDITY_PROVIDER &&
              typeof item.ownerId === 'string',
          )
          .map((item) => item.ownerId as string),
      ),
    ];

    const [customers, liquidityProviders] = await Promise.all([
      customerOwnerIds.length
        ? this.prisma.customerMain.findMany({
            where: { id: { in: customerOwnerIds } },
            select: {
              id: true,
              customerNo: true,
              customerType: true,
              companyName: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          })
        : Promise.resolve([]),
      lpOwnerIds.length
        ? this.prisma.liquidityProvider.findMany({
            where: { id: { in: lpOwnerIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const customerMap = new Map(customers.map((customer) => [customer.id, customer]));
    const lpMap = new Map(
      liquidityProviders.map((provider) => [provider.id, provider]),
    );

    const normalizedItems = items.map((item) => {
      let ownerNo: string | null = item.ownerNo;
      let ownerName: string | null = null;

      if (item.ownerType === OwnerType.PLATFORM) {
        ownerName = 'Platform';
      } else if (
        item.ownerType === OwnerType.CUSTOMER &&
        typeof item.ownerId === 'string'
      ) {
        const customer = customerMap.get(item.ownerId);
        if (!ownerNo) ownerNo = customer?.customerNo ?? null;
        ownerName = this.resolveCustomerOwnerName(customer);
      } else if (
        item.ownerType === OwnerType.LIQUIDITY_PROVIDER &&
        typeof item.ownerId === 'string'
      ) {
        const provider = lpMap.get(item.ownerId);
        ownerName = provider?.name ?? null;
      }

      return {
        ...item,
        ownerNo,
        ownerName,
      };
    });

    return { items: normalizedItems, total };
  }

  async findOne(id: string) {
    const item = await this.prisma.wallet.findUnique({
      where: { id },
      include: {
        asset: true,
      },
    });
    if (!item) throw new NotFoundException('Wallet not found');

    let ownerNo: string | null = item.ownerNo;
    if (!ownerNo && item.ownerType === OwnerType.CUSTOMER && item.ownerId) {
      const customer = await this.prisma.customerMain.findUnique({
        where: { id: item.ownerId },
        select: { customerNo: true },
      });
      ownerNo = customer?.customerNo ?? null;
    }

    return { ...item, ownerNo };
  }

  async changeStatus(id: string, status: WalletStatus) {
    this.logger.log(`Changing status of wallet ${id} to ${status}`);
    const result = await this.prisma.wallet.update({
      where: { id },
      data: { status },
    });
    return result;
  }
}

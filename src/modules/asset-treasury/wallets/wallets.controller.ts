import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
  ForbiddenException,
  Request,
} from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { WalletQueryService } from './wallet-query.service';
import {
  WalletStatus,
  OwnerType,
  WalletRole,
} from './dto/wallet.dto';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../../modules/identity/access-control/admin-permission.guard';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { Prisma } from '@prisma/client';

@ApiTags('wallets')
@ApiBearerAuth()
@Controller('wallets')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class WalletsController {
  constructor(
    private readonly service: WalletsService,
    private readonly queryService: WalletQueryService,
  ) {}

  private ensureSupportedToken(req: any) {
    if (req.user?.type !== 'ADMIN' && req.user?.type !== 'CUSTOMER') {
      throw new ForbiddenException('Invalid token type');
    }
  }

  /** 铁律⑥ 对外用业务键：三端点的路由参数是 walletNo，换成内部 id 再传给
   *  queryService/service（它们的签名不动，继续按 id 工作）。 */
  private async resolveWalletId(walletNo: string): Promise<string> {
    const wallet = await this.service.findByWalletNo(walletNo);
    if (!wallet) throw new NotFoundException('Wallet not found');
    return wallet.id;
  }

  @Get()
  @ApiOperation({ summary: 'List wallet address rows (vault × network × owner)' })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({ name: 'ownerType', required: false, enum: OwnerType })
  @ApiQuery({ name: 'ownerNo', required: false, type: String })
  @ApiQuery({ name: 'vaultCode', required: false, type: String })
  @ApiQuery({ name: 'walletRole', required: false, enum: WalletRole })
  @ApiQuery({ name: 'network', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: WalletStatus })
  @ApiQuery({ name: 'walletNo', required: false, type: String })
  findAll(
    @Request() req: any,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('ownerType') ownerType?: string,
    @Query('ownerNo') ownerNo?: string,
    @Query('vaultCode') vaultCode?: string,
    @Query('walletRole') walletRole?: string,
    @Query('network') network?: string,
    @Query('status') status?: string,
    @Query('walletNo') walletNo?: string,
    @Query('q') q?: string,
  ) {
    this.ensureSupportedToken(req);
    const where: Prisma.WalletWhereInput = {};
    if (req.user.type === 'CUSTOMER') {
      if (ownerType && ownerType !== OwnerType.CUSTOMER) throw new ForbiddenException('Customer can only query CUSTOMER wallets');
      where.ownerType = OwnerType.CUSTOMER;
      where.ownerId = req.user.userId;
    } else {
      if (ownerType) where.ownerType = ownerType;
      if (ownerNo?.trim()) where.ownerNo = { contains: ownerNo.trim() };
    }
    if (vaultCode) where.vaultCode = vaultCode;
    if (walletRole) where.walletRole = walletRole;
    if (network) where.network = network;
    if (status) where.status = status;
    if (walletNo?.trim()) where.walletNo = { contains: walletNo.trim() };
    const qt = q?.trim();
    if (qt) where.OR = [{ walletNo: { contains: qt } }, { iban: { contains: qt } }, { address: { contains: qt } }];
    return this.queryService.findAll({ skip: skip ? Number(skip) : 0, take: take ? Number(take) : 20, where, orderBy: [{ vaultCode: 'asc' }, { network: 'asc' }, { createdAt: 'desc' }] });
  }

  @Get(':walletNo')
  @ApiOperation({ summary: 'Get a wallet by wallet number' })
  async findOne(@Request() req: any, @Param('walletNo') walletNo: string) {
    this.ensureSupportedToken(req);

    const id = await this.resolveWalletId(walletNo);
    const wallet = await this.queryService.findOne(id);
    if (
      req.user.type === 'CUSTOMER' &&
      (wallet.ownerType !== OwnerType.CUSTOMER || wallet.ownerId !== req.user.userId)
    ) {
      throw new ForbiddenException('Customer can only access own wallets');
    }

    return wallet;
  }
}

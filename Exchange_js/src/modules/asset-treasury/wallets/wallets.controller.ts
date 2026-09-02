import {
  Controller,
  Get,
  Body,
  NotFoundException,
  Patch,
  Param,
  Query,
  UseGuards,
  ForbiddenException,
  Request,
} from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { WalletQueryService } from './wallet-query.service';
import {
  UpdateWalletStatusDto,
  WalletStatus,
  OwnerType,
  WalletType,
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

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
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
  @ApiOperation({ summary: 'List all wallets' })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({ name: 'ownerType', required: false, enum: OwnerType })
  @ApiQuery({ name: 'ownerId', required: false, type: String })
  @ApiQuery({ name: 'type', required: false, enum: WalletType })
  @ApiQuery({ name: 'assetId', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: WalletStatus })
  @ApiQuery({ name: 'walletRole', required: false, enum: WalletRole })
  @ApiQuery({ name: 'walletNo', required: false, type: String })
  @ApiQuery({ name: 'ownerNo', required: false, type: String })
  findAll(
    @Request() req: any,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('ownerType') ownerType?: string,
    @Query('ownerId') ownerId?: string,
    @Query('type') type?: string,
    @Query('assetId') assetId?: string,
    @Query('status') status?: string,
    @Query('walletRole') walletRole?: string,
    @Query('walletNo') walletNo?: string,
    @Query('ownerNo') ownerNo?: string,
    @Query('q') q?: string,
  ) {
    this.ensureSupportedToken(req);

    const where: Prisma.WalletWhereInput = {};

    if (req.user.type === 'CUSTOMER') {
      if (ownerType && ownerType !== OwnerType.CUSTOMER) {
        throw new ForbiddenException(
          'Customer can only query CUSTOMER wallets',
        );
      }
      if (ownerId && ownerId !== req.user.userId) {
        throw new ForbiddenException('Customer can only query own wallets');
      }
      where.ownerType = OwnerType.CUSTOMER;
      where.ownerId = req.user.userId;
    } else {
      if (ownerType) where.ownerType = ownerType;
      if (ownerId) where.ownerId = ownerId;
    }
    if (type) where.type = type;
    if (assetId) where.assetId = assetId;
    if (status) where.status = status;
    if (walletRole) where.walletRole = walletRole;
    if (walletNo?.trim()) where.walletNo = { contains: walletNo.trim() };
    if (ownerNo?.trim()) where.ownerNo = { contains: ownerNo.trim() };
    // 三合一搜索:编号 / IBAN / 链上地址
    const qt = q?.trim();
    if (qt) {
      where.OR = [
        { walletNo: { contains: qt } },
        { iban: { contains: qt } },
        { address: { contains: qt } },
      ];
    }

    return this.queryService.findAll({
      skip: skip ? Number(skip) : 0,
      take: take ? Number(take) : 20,
      where,
      orderBy: { createdAt: 'desc' },
    });
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

  @Get(':walletNo/balance')
  @ApiOperation({ summary: 'Get wallet projected balance summary' })
  async findBalance(@Request() req: any, @Param('walletNo') walletNo: string) {
    this.ensureSupportedToken(req);

    const id = await this.resolveWalletId(walletNo);
    const wallet = await this.queryService.findOne(id);
    if (
      req.user.type === 'CUSTOMER' &&
      (wallet.ownerType !== OwnerType.CUSTOMER || wallet.ownerId !== req.user.userId)
    ) {
      throw new ForbiddenException('Customer can only access own wallets');
    }

    return this.queryService.findBalance(id);
  }

  @Patch(':walletNo/status')
  @ApiOperation({ summary: 'Change wallet status' })
  changeStatus(
    @Request() req: any,
    @Param('walletNo') walletNo: string,
    @Body() dto: UpdateWalletStatusDto,
  ) {
    this.ensureAdmin(req);
    return this.resolveWalletId(walletNo).then((id) =>
      this.service.changeStatus(id, dto.status, {
        actorId: req.user.userId,
        actorNo: req.user.adminNo,
        actorRole: req.user.role,
      }),
    );
  }
}

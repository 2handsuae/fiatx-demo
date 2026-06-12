import {
  Controller,
  Get,
  Body,
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
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
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

  @Get(':id')
  @ApiOperation({ summary: 'Get a wallet by ID' })
  async findOne(@Request() req: any, @Param('id') id: string) {
    this.ensureSupportedToken(req);

    const wallet = await this.queryService.findOne(id);
    if (
      req.user.type === 'CUSTOMER' &&
      (wallet.ownerType !== OwnerType.CUSTOMER || wallet.ownerId !== req.user.userId)
    ) {
      throw new ForbiddenException('Customer can only access own wallets');
    }

    return wallet;
  }

  @Get(':id/balance')
  @ApiOperation({ summary: 'Get wallet projected balance summary' })
  async findBalance(@Request() req: any, @Param('id') id: string) {
    this.ensureSupportedToken(req);

    const wallet = await this.queryService.findOne(id);
    if (
      req.user.type === 'CUSTOMER' &&
      (wallet.ownerType !== OwnerType.CUSTOMER || wallet.ownerId !== req.user.userId)
    ) {
      throw new ForbiddenException('Customer can only access own wallets');
    }

    return this.queryService.findBalance(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Change wallet status' })
  changeStatus(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateWalletStatusDto,
  ) {
    this.ensureAdmin(req);
    return this.service.changeStatus(id, dto.status, {
      actorId: req.user.userId,
      actorNo: req.user.adminNo,
      actorRole: req.user.role,
    });
  }
}

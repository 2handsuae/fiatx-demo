import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  UseGuards,
  Delete,
} from '@nestjs/common';
import { WalletsService } from './wallets.service';
import {
  CreateWalletDto,
  UpdateWalletStatusDto,
  WalletStatus,
  OwnerType,
  WalletType,
  WalletDirection,
} from './dto/wallet.dto';
import { AuthGuard } from '@nestjs/passport';
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
@UseGuards(AuthGuard('jwt'))
export class WalletsController {
  constructor(private readonly service: WalletsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new wallet' })
  create(@Body() dto: CreateWalletDto) {
    return this.service.create(dto);
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
  @ApiQuery({ name: 'direction', required: false, enum: WalletDirection })
  findAll(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('ownerType') ownerType?: string,
    @Query('ownerId') ownerId?: string,
    @Query('type') type?: string,
    @Query('assetId') assetId?: string,
    @Query('status') status?: string,
    @Query('direction') direction?: string,
  ) {
    const where: Prisma.WalletWhereInput = {};

    if (ownerType) where.ownerType = ownerType;
    if (ownerId) where.ownerId = ownerId;
    if (type) where.type = type;
    if (assetId) where.assetId = assetId;
    if (status) where.status = status;
    if (direction) where.direction = direction;

    return this.service.findAll({
      skip: skip ? Number(skip) : 0,
      take: take ? Number(take) : 20,
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a wallet by ID' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Change wallet status' })
  changeStatus(@Param('id') id: string, @Body() dto: UpdateWalletStatusDto) {
    return this.service.changeStatus(id, dto.status);
  }
}

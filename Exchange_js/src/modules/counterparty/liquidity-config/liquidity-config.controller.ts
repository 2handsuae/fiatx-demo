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
  Put,
} from '@nestjs/common';
import { LiquidityConfigService } from './liquidity-config.service';
import {
  CreateLiquidityConfigDto,
  UpdateLiquidityConfigDto,
  UpdateLiquidityConfigStatusDto,
  LiquidityConfigStatus,
} from './dto/liquidity-config.dto';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { Prisma } from '@prisma/client';

@ApiTags('liquidity-configurations')
@ApiBearerAuth()
@Controller('liquidity-configurations')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class LiquidityConfigController {
  constructor(private readonly service: LiquidityConfigService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new liquidity configuration' })
  create(@Body() dto: CreateLiquidityConfigDto) {
    return this.service.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all liquidity configurations' })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({ name: 'lpId', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: LiquidityConfigStatus })
  findAll(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('lpId') lpId?: string,
    @Query('status') status?: string,
  ) {
    const where: Prisma.LiquidityConfigurationWhereInput = {};

    if (lpId) where.lpId = lpId;
    if (status) where.status = status;

    return this.service.findAll({
      skip: skip ? Number(skip) : 0,
      take: take ? Number(take) : 20,
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get('available')
  @ApiOperation({ summary: 'Get available configurations for a pair' })
  getAvailable(
    @Query('fromAssetId') fromAssetId: string,
    @Query('toAssetId') toAssetId: string,
  ) {
    return this.service.getAvailableConfigs(fromAssetId, toAssetId);
  }

  @Get('lp/:lpId')
  @ApiOperation({ summary: 'Get configurations by LP ID' })
  getByLpId(@Param('lpId') lpId: string) {
    return this.service.getByLpId(lpId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a configuration by ID' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a configuration' })
  update(@Param('id') id: string, @Body() dto: UpdateLiquidityConfigDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a configuration' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Change configuration status' })
  changeStatus(
    @Param('id') id: string,
    @Body() dto: UpdateLiquidityConfigStatusDto,
  ) {
    return this.service.changeStatus(id, dto.status);
  }
}

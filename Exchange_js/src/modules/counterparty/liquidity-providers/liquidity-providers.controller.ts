import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { LiquidityProvidersService } from './liquidity-providers.service';
import {
  CreateLiquidityProviderDto,
  UpdateLiquidityProviderStatusDto,
  LiquidityProviderStatus,
} from './dto/liquidity-provider.dto';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { Prisma } from '@prisma/client';

@ApiTags('liquidity-providers')
@ApiBearerAuth()
@Controller('liquidity-providers')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class LiquidityProvidersController {
  constructor(private readonly service: LiquidityProvidersService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new liquidity provider' })
  create(@Body() dto: CreateLiquidityProviderDto) {
    return this.service.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all liquidity providers' })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: LiquidityProviderStatus })
  findAll(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    const where: Prisma.LiquidityProviderWhereInput = {};

    if (search) {
      where.name = { contains: search };
    }
    if (status) {
      where.status = status;
    }

    return this.service.findAll({
      skip: skip ? Number(skip) : 0,
      take: take ? Number(take) : 20,
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a liquidity provider by ID' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Change liquidity provider status' })
  changeStatus(
    @Param('id') id: string,
    @Body() dto: UpdateLiquidityProviderStatusDto,
  ) {
    return this.service.changeStatus(id, dto.status);
  }
}

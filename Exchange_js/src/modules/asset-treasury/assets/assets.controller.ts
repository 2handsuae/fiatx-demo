import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AssetsService } from './assets.service';
import {
  AssetStatus,
  AssetType,
} from './dto/asset.dto';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { Prisma } from '@prisma/client';

@ApiTags('assets')
@ApiBearerAuth()
@Controller('assets')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class AssetsController {
  constructor(private readonly service: AssetsService) {}

  @Get()
  @ApiOperation({ summary: 'List all assets' })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({ name: 'type', required: false, enum: AssetType })
  @ApiQuery({ name: 'status', required: false, enum: AssetStatus })
  @ApiQuery({ name: 'currency', required: false, type: String })
  findAll(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('type') type?: AssetType,
    @Query('status') status?: AssetStatus,
    @Query('currency') currency?: string,
  ) {
    const where: Prisma.AssetWhereInput = {};

    if (type) {
      where.type = type;
    }
    if (status) {
      where.status = status;
    }
    if (currency) {
      where.currency = { contains: currency };
    }

    return this.service.findAll({
      skip: skip ? Number(skip) : 0,
      take: take ? Number(take) : 20,
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an asset by ID' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}

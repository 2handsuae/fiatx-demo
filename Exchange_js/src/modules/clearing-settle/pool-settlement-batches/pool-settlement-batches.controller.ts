import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import {
  CreatePoolSettlementBatchDto,
  PoolSettlementBatchQueryDto,
} from './dto/pool-settlement-batch.dto';
import { PoolSettlementBatchesService } from './pool-settlement-batches.service';

@ApiTags('Admin - Pool Settlement Batches')
@ApiBearerAuth()
@Controller('admin/pool-settlement-batches')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class PoolSettlementBatchesController {
  constructor(
    private readonly poolSettlementBatchesService: PoolSettlementBatchesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List pool settlement batches' })
  @UsePipes(new ValidationPipe({ transform: true }))
  findAll(@Query() query: PoolSettlementBatchQueryDto) {
    return this.poolSettlementBatchesService.findAllForAdmin(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get pool settlement batch detail' })
  findOne(@Param('id') id: string) {
    return this.poolSettlementBatchesService.findDetailForAdmin(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create pool settlement batch' })
  @UsePipes(new ValidationPipe({ transform: true }))
  create(@Req() req: any, @Body() dto: CreatePoolSettlementBatchDto) {
    const operatorId = req.user?.userId || 'SYSTEM';
    return this.poolSettlementBatchesService.createBatch(dto, operatorId);
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit pool settlement batch' })
  submit(@Req() req: any, @Param('id') id: string) {
    const operatorId = req.user?.userId || 'SYSTEM';
    return this.poolSettlementBatchesService.submitBatch(id, operatorId);
  }
}

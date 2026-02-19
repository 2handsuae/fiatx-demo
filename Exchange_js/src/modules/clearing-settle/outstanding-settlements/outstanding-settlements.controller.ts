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
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CreateOutstandingSettlementDto,
  OutstandingSettlementQueryDto,
} from './dto/outstanding-settlement.dto';
import { OutstandingSettlementsService } from './outstanding-settlements.service';

@ApiTags('Admin - Reconciliation Outstanding Settlements')
@ApiBearerAuth()
@Controller('admin/reconciliation/outstanding-settlements')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class OutstandingSettlementsController {
  constructor(
    private readonly outstandingSettlementsService: OutstandingSettlementsService,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      'Create outstanding settlement batch (lock outstanding rows by cutoff and launch internal execution)',
  })
  @UsePipes(new ValidationPipe({ transform: true }))
  create(@Req() req: any, @Body() dto: CreateOutstandingSettlementDto) {
    const operatorId = req.user?.userId || 'SYSTEM';
    return this.outstandingSettlementsService.createManual(dto, operatorId);
  }

  @Get()
  @ApiOperation({ summary: 'List outstanding settlement batches' })
  @UsePipes(new ValidationPipe({ transform: true }))
  findAll(@Query() query: OutstandingSettlementQueryDto) {
    return this.outstandingSettlementsService.findAllForAdmin(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get outstanding settlement batch detail' })
  findOne(@Param('id') id: string) {
    return this.outstandingSettlementsService.findOneForAdmin(id);
  }

  @Post(':id/sync')
  @ApiOperation({
    summary: 'Re-sync settlement status and outstanding close/release based on fund terminal state',
  })
  sync(@Req() req: any, @Param('id') id: string) {
    const operatorId = req.user?.userId || 'SYSTEM';
    return this.outstandingSettlementsService.syncSettlement(id, operatorId);
  }
}

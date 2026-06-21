import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { SettlementBatchService } from '../domain/settlement-batch.service';
import { EodSettlementWorkflowService } from '../workflow/eod-settlement-workflow.service';
import { SettlementQueryDto } from '../dto/settlement-query.dto';

@ApiTags('Admin - Funds Layer Settlements')
@Controller('admin/funds-layer/settlements')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class SettlementAdminController {
  constructor(
    private readonly settlementBatch: SettlementBatchService,
    private readonly eodWorkflow: EodSettlementWorkflowService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List settlement batches' })
  @RequirePermissions(
    buildPermissionCode('GET', '/admin/funds-layer/settlements'),
  )
  @UsePipes(new ValidationPipe({ transform: true }))
  findAll(@Query() query: SettlementQueryDto) {
    return this.settlementBatch.findForAdmin(query);
  }

  @Post('run')
  @ApiOperation({ summary: 'Trigger EOD settlement run (DEV manual trigger)' })
  @RequirePermissions(
    buildPermissionCode('POST', '/admin/funds-layer/settlements/run'),
  )
  run() {
    return this.eodWorkflow.runEodSettlement('ADMIN');
  }

  @Post('settle')
  @ApiOperation({ summary: 'Trigger manual crypto settlement' })
  @RequirePermissions(
    buildPermissionCode('POST', '/admin/funds-layer/settlements/settle'),
  )
  async manualSettle() {
    return this.eodWorkflow.runManualCryptoSettlement('ADMIN');
  }

  @Get(':batchNo')
  @ApiOperation({ summary: 'Get settlement batch detail' })
  @RequirePermissions(
    buildPermissionCode('GET', '/admin/funds-layer/settlements/:batchNo'),
  )
  findOne(@Param('batchNo') batchNo: string) {
    return this.settlementBatch.findOneByNoForAdmin(batchNo);
  }
}

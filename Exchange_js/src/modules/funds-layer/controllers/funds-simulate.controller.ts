import {
  Body,
  Controller,
  Param,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { FundsFlowService } from '../domain/funds-flow.service';
import { SimulateFundsFlowDto } from '../dto/simulate-funds-flow.dto';
import { UpdateInternalFundStatusDto } from '../dto/internal-fund.dto';

/**
 * DEV-only endpoint to drive a funds-flow leg through its execution state
 * machine without a real custodian. The `:internalTxNo` param is the route
 * anchor; the actual leg is identified by `dto.fundsFlowId`.
 */
@ApiTags('Admin - Funds Layer Transfers')
@Controller('admin/funds-layer/transfers')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class FundsSimulateController {
  constructor(private readonly fundsFlow: FundsFlowService) {}

  @Post(':internalTxNo/simulate')
  @ApiOperation({ summary: 'Simulate a funds-flow step (DEV)' })
  @RequirePermissions(
    buildPermissionCode(
      'POST',
      '/admin/funds-layer/transfers/:internalTxNo/simulate',
    ),
  )
  @UsePipes(new ValidationPipe({ transform: true }))
  simulate(
    @Param('internalTxNo') _internalTxNo: string,
    @Body() dto: SimulateFundsFlowDto,
  ) {
    return this.fundsFlow.updateStatus(
      dto.fundsFlowId,
      { action: dto.action as UpdateInternalFundStatusDto['action'], reason: dto.reason },
      'ADMIN',
    );
  }
}

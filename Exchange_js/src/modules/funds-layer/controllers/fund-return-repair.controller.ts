import {
  Body,
  Controller,
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
import { FundTransferWorkflowService } from '../workflow/fund-transfer-workflow.service';
import { FundReturnDto } from '../dto/fund-return.dto';

/**
 * FUND_RETURN repair surface. FUND_RETURN has no automatic trigger
 * (no PAYOUT_FAILED event; V5 failure branches unbuilt), so an authenticated
 * admin triggers the Outbound→Main return transfer for a withdrawal whose
 * FUND_OUT happened but won't proceed. The transfer journey audit (REQUESTED +
 * terminal) is written inside InternalTransferWorkflowService, so this
 * controller stays a thin pass-through.
 */
@ApiTags('Admin - Funds Layer Transfers')
@Controller('admin/funds-layer/fund-return')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class FundReturnRepairController {
  constructor(private readonly fundTransfer: FundTransferWorkflowService) {}

  @Post()
  @ApiOperation({ summary: 'Trigger FUND_RETURN repair (admin)' })
  @RequirePermissions(
    buildPermissionCode('POST', '/admin/funds-layer/fund-return'),
  )
  @UsePipes(new ValidationPipe({ transform: true }))
  fundReturn(@Body() dto: FundReturnDto) {
    return this.fundTransfer.fundReturn(
      {
        withdrawId: dto.withdrawId,
        withdrawNo: dto.withdrawNo,
        assetId: dto.assetId,
        amount: dto.amount,
        reason: dto.reason,
      },
      'ADMIN',
    );
  }
}

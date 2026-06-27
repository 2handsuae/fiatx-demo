import {
  Controller,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AdminPermissionGuard } from '../modules/identity/access-control/admin-permission.guard';
import { WithdrawWorkflowService } from '../modules/trading/withdraw-transactions/withdraw-workflow.service';

@ApiTags('Payouts')
@ApiBearerAuth()
@Controller('payouts')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class PayoutCloseoutRepairController {
  constructor(
    private readonly withdrawWorkflowService: WithdrawWorkflowService,
  ) {}

  @Post(':id/re-closeout')
  @ApiOperation({ summary: 'Re-run canonical payout closeout from CONFIRMED receipt' })
  reCloseout(
    @Param('id') id: string,
  ) {
    return this.withdrawWorkflowService.reCloseoutPayout(id);
  }

  @Post(':id/re-compensate')
  @ApiOperation({ summary: 'Re-run canonical withdraw compensation from terminal payout result' })
  reCompensate(
    @Param('id') id: string,
  ) {
    return this.withdrawWorkflowService.reCompensatePayout(id);
  }
}

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
import { WithdrawWorkflowOrchestrator } from './withdraw-workflow.orchestrator';

@ApiTags('Payouts')
@ApiBearerAuth()
@Controller('payouts')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class PayoutCloseoutRepairController {
  constructor(
    private readonly withdrawWorkflowOrchestrator: WithdrawWorkflowOrchestrator,
  ) {}

  @Post(':id/re-closeout')
  @ApiOperation({ summary: 'Re-run canonical payout closeout from CONFIRMED receipt' })
  reCloseout(
    @Param('id') id: string,
  ) {
    return this.withdrawWorkflowOrchestrator.reCloseoutPayout(id);
  }

  @Post(':id/re-compensate')
  @ApiOperation({ summary: 'Re-run canonical withdraw compensation from terminal payout result' })
  reCompensate(
    @Param('id') id: string,
  ) {
    return this.withdrawWorkflowOrchestrator.reCompensatePayout(id);
  }
}

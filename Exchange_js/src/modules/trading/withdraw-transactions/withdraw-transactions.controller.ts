import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UsePipes,
  ValidationPipe,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { WithdrawTransactionsService } from './withdraw-transactions.service';
import { WithdrawWorkflowService } from './withdraw-workflow.service';
import {
  WithdrawTransactionQueryDto,
  BounceWithdrawTransactionDto,
  UnfreezeWithdrawTransactionDto,
  SanctionRefundWithdrawTransactionDto,
  InitiateWithdrawReturnClaimDto,
} from './dto/withdraw-transaction.dto';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../../modules/identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../../modules/identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../../modules/identity/access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';

@ApiTags('Withdraw Transactions')
@ApiBearerAuth()
@Controller('withdraw-transactions')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class WithdrawTransactionsController {
  constructor(
    private readonly service: WithdrawTransactionsService,
    private readonly workflowService: WithdrawWorkflowService,
  ) {}

  private assertAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin only');
    }
  }

  @Get()
  @ApiOperation({ summary: 'List withdraw transactions' })
  @UsePipes(new ValidationPipe({ transform: true }))
  findAll(@Req() req: any, @Query() query: WithdrawTransactionQueryDto) {
    this.assertAdmin(req);
    return this.service.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get withdraw transaction details' })
  findOne(@Req() req: any, @Param('id') id: string) {
    this.assertAdmin(req);
    return this.service.findOneForAdmin(id);
  }

  @Post(':id/bounce')
  @ApiOperation({ summary: 'Bounce (return) a withdraw transaction payout' })
  bounce(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: BounceWithdrawTransactionDto,
  ) {
    this.assertAdmin(req);
    return this.workflowService.onBounce(id, dto.reason, {
      actorType: 'ADMIN',
      actorNo: req.user?.userId || 'ADMIN_SYSTEM',
      actorDisplayName: req.user?.userId || 'ADMIN_SYSTEM',
      actorRolesAtTime: [req.user?.role || 'ADMIN'],
    });
  }

  private toApprovalActor(req: any): ApprovalActorContext {
    return {
      actorType: 'ADMIN',
      userId: req.user?.userId,
      userNo: req.user?.userNo,
      role: req.user?.role,
      roleCodes: req.user?.roleCodes || (req.user?.role ? [req.user.role] : []),
    };
  }

  @Post(':id/unfreeze')
  @ApiOperation({ summary: 'Unfreeze a FROZEN withdrawal under delisting/unfreeze order (maker-checker approval)' })
  unfreeze(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UnfreezeWithdrawTransactionDto,
  ) {
    this.assertAdmin(req);
    return this.workflowService.initiateUnfreeze(
      id,
      { orderRef: dto.orderRef, reason: dto.reason },
      this.toApprovalActor(req),
    );
  }

  @Post(':id/refund')
  @ApiOperation({ summary: 'Refund a FROZEN withdrawal to sender under sanction disposition (maker-checker approval)' })
  refund(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: SanctionRefundWithdrawTransactionDto,
  ) {
    this.assertAdmin(req);
    return this.workflowService.initiateRefund(
      id,
      { reason: dto.reason },
      this.toApprovalActor(req),
    );
  }

  @Post(':withdrawNo/return-claim')
  @ApiOperation({ summary: 'Recon Batch B ③: claim a payout returned by the bank after success (CFO maker-checker)' })
  @RequirePermissions(buildPermissionCode('POST', '/withdraw-transactions/:withdrawNo/return-claim'))
  initiateReturnClaim(@Param('withdrawNo') withdrawNo: string, @Body() dto: InitiateWithdrawReturnClaimDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.workflowService.initiateReturnClaim(withdrawNo, dto, this.toApprovalActor(req));
  }

  @Post(':withdrawNo/simulate-sla-timeout')
  @ApiOperation({ summary: 'Demo only: push this order\'s SLA deadline into the past so the next scan breaches it' })
  simulateSlaTimeout(@Req() req: any, @Param('withdrawNo') withdrawNo: string) {
    this.assertAdmin(req);
    return this.service.setSlaDeadlineByNo(withdrawNo, new Date(Date.now() - 1000), {
      actorId: req.user?.userId,
      actorRole: req.user?.role,
    });
  }

}

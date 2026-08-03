import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Patch,
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
  AdminUpdateWithdrawTransactionStatusDto,
  BounceWithdrawTransactionDto,
  UnfreezeWithdrawTransactionDto,
  SanctionRefundWithdrawTransactionDto,
  WithdrawTransactionAction,
} from './dto/withdraw-transaction.dto';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
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

  @Post('mock')
  @ApiOperation({ summary: 'Create 10 mock withdraw transactions' })
  createMock(@Req() req: any) {
    this.assertAdmin(req);
    return this.service.createMockData();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get withdraw transaction details' })
  findOne(@Req() req: any, @Param('id') id: string) {
    this.assertAdmin(req);
    return this.service.findOneForAdmin(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update withdraw transaction status' })
  updateStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: AdminUpdateWithdrawTransactionStatusDto,
  ) {
    this.assertAdmin(req);
    return this.service.updateStatus(
      id,
      {
        action: dto.action as unknown as WithdrawTransactionAction,
        reason: dto.reason,
      },
      {
        source: 'ADMIN_API',
        actorType: 'ADMIN',
        actorId: req.user?.userId || 'ADMIN_SYSTEM',
        actorRole: req.user?.role || 'ADMIN',
        sourcePlatform: 'ADMIN_API',
      },
    );
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
      actorId: req.user?.userId || 'ADMIN_SYSTEM',
      actorRole: req.user?.role || 'ADMIN',
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

}

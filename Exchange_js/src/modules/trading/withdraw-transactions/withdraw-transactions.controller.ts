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
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import {
  WithdrawTransactionQueryDto,
  AdminUpdateWithdrawTransactionStatusDto,
  WithdrawTransactionAction,
} from './dto/withdraw-transaction.dto';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { fakeChainTxHash } from '../../../common/utils/fake-external-refs.util';

@ApiTags('Withdraw Transactions')
@ApiBearerAuth()
@Controller('withdraw-transactions')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class WithdrawTransactionsController {
  constructor(
    private readonly service: WithdrawTransactionsService,
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
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
    return this.service.findOne(id);
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

  @Post(':id/simulate/kyt-phase1')
  @ApiOperation({ summary: '[DEV] Simulate KYT Phase 1 result' })
  async simulateKytPhase1(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { result?: string; riskScore?: number },
  ) {
    this.assertAdmin(req);
    const result = body.result || 'PASSED';
    const riskScore = body.riskScore ?? 10;
    await this.service.updateKytStatus(id, result, `SIM-KYT-${Date.now()}`, riskScore, 1);
    return { message: `KYT Phase 1 simulated: ${result}`, withdrawId: id, kytStatus: result };
  }

  @Post(':id/simulate/kyt-phase2')
  @ApiOperation({ summary: '[DEV] Simulate KYT Phase 2 (post-broadcast) result' })
  async simulateKytPhase2(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { result?: string; riskScore?: number },
  ) {
    this.assertAdmin(req);
    const result = body.result || 'PASSED';
    const riskScore = body.riskScore ?? 5;
    await this.service.updateKytStatus(id, result, `SIM-KYT2-${Date.now()}`, riskScore, 2);
    return { message: `KYT Phase 2 simulated: ${result}`, withdrawId: id, kytStatus: result };
  }

  @Post(':id/simulate/travel-rule')
  @ApiOperation({ summary: '[DEV] Simulate Travel Rule result' })
  async simulateTravelRule(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { result?: string },
  ) {
    this.assertAdmin(req);
    const result = body.result || 'PASSED';
    await this.service.updateTravelRuleStatus(id, result, result === 'PASSED' ? `SIM-TR-${Date.now()}` : null);
    return { message: `Travel Rule simulated: ${result}`, withdrawId: id, travelRuleStatus: result };
  }

  @Post(':id/simulate/payout-confirmed')
  @ApiOperation({ summary: '[DEV] Simulate payout confirmed event' })
  async simulatePayoutConfirmed(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { txHash?: string },
  ) {
    this.assertAdmin(req);
    const txHash = body.txHash ?? fakeChainTxHash(`sim:${id ?? Date.now()}`);
    await (this.prisma as any).withdrawTransaction.update({
      where: { id },
      data: { txHash },
    });
    this.eventEmitter.emit(DomainEventNames.PAYOUT_STATUS_CONFIRMED, {
      payoutId: id,
      withdrawId: id,
      txHash,
    });
    return { message: 'Payout confirmed simulated', withdrawId: id, txHash };
  }
}

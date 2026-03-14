import {
  Body,
  Controller,
  ForbiddenException,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import {
  MockApprovalTimeoutDto,
  MockChangeFollowUpDto,
} from './dto/sla-timer.dto';
import { SlaTimerMockService } from './sla-timer-mock.service';

@ApiTags('Admin - Governance SLA Timer Demo')
@Controller('admin/demo/governance/sla-timers')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class SlaTimerDemoController {
  constructor(private readonly slaTimerMockService: SlaTimerMockService) {}

  private ensureAdmin(req: any): ApprovalActorContext {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }

    return {
      actorType: 'ADMIN',
      userId: String(req.user.userId || ''),
      userNo: req.user.userNo,
      role: req.user.role,
      roleCodes: Array.isArray(req.user.roleCodes) ? req.user.roleCodes : [],
    };
  }

  private ensureDemoEnabled() {
    const value = String(process.env.GOVERNANCE_DEMO_ENABLED || '').trim().toLowerCase();
    if (!['1', 'true', 'yes', 'on'].includes(value)) {
      throw new NotFoundException('Governance demo endpoints are disabled');
    }
  }

  @Post('approval-timeout')
  @ApiOperation({ summary: 'Create an approval-timeout SLA demo chain' })
  createApprovalTimeoutMock(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: MockApprovalTimeoutDto,
  ) {
    this.ensureDemoEnabled();
    return this.slaTimerMockService.createApprovalTimeoutMock(body, this.ensureAdmin(req));
  }

  @Post('change-follow-up')
  @ApiOperation({ summary: 'Create an emergency change follow-up SLA demo chain' })
  createChangeFollowUpMock(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: MockChangeFollowUpDto,
  ) {
    this.ensureDemoEnabled();
    return this.slaTimerMockService.createChangeFollowUpMock(body, this.ensureAdmin(req));
  }

  @Post(':id/expire')
  @ApiOperation({ summary: 'Fast-forward an active SLA timer to expire for demo' })
  mockExpire(@Req() req: any, @Param('id') id: string) {
    this.ensureDemoEnabled();
    return this.slaTimerMockService.mockExpire(id, this.ensureAdmin(req));
  }
}

import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import {
  CloseSlaTimerDto,
  RecalcSlaTimerDto,
  SlaTimerQueryDto,
} from './dto/sla-timer.dto';
import { SlaTimersService } from './sla-timers.service';

@ApiTags('Admin - Governance SLA Timers')
@Controller('admin/control-gates/sla-timers')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class SlaTimersController {
  constructor(private readonly slaTimersService: SlaTimersService) {}

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

  @Get()
  @ApiOperation({ summary: 'List SLA timers' })
  list(
    @Query(new ValidationPipe({ transform: true })) query: SlaTimerQueryDto,
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    return this.slaTimersService.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get SLA timer detail' })
  getById(@Req() req: any, @Param('id') id: string) {
    this.ensureAdmin(req);
    return this.slaTimersService.getById(id);
  }

  @Post(':id/recalc')
  @ApiOperation({ summary: 'Recalculate an active SLA timer' })
  recalc(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: RecalcSlaTimerDto,
  ) {
    return this.slaTimersService.recalc(id, body, this.ensureAdmin(req));
  }

  @Post(':id/close')
  @ApiOperation({ summary: 'Close an SLA timer' })
  close(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: CloseSlaTimerDto,
  ) {
    return this.slaTimersService.close(id, body, this.ensureAdmin(req));
  }
}

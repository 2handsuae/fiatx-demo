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
import { ChangeTicketsService } from './change-tickets.service';
import { ReleaseGatesService } from './release-gates.service';
import {
  ChangeTicketQueryDto,
  CloseChangeTicketDto,
  CreateChangeTicketDto,
  GateCheckDto,
  MarkDeployStatusDto,
  ResubmitChangeTicketDto,
  SubmitChangeTicketDto,
} from './dto/change-ticket.dto';

@ApiTags('Admin - Governance Change Tickets')
@Controller('admin/governance/change-tickets')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class ChangeTicketsController {
  constructor(
    private readonly changeTicketsService: ChangeTicketsService,
    private readonly releaseGatesService: ReleaseGatesService,
  ) {}

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

  @Post()
  @ApiOperation({ summary: 'Create a change ticket' })
  create(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: CreateChangeTicketDto,
  ) {
    return this.changeTicketsService.create(body, this.ensureAdmin(req));
  }

  @Get()
  @ApiOperation({ summary: 'List change tickets' })
  list(
    @Req() req: any,
    @Query(new ValidationPipe({ transform: true })) query: ChangeTicketQueryDto,
  ) {
    return this.changeTicketsService.list(query, this.ensureAdmin(req));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get change ticket detail' })
  getById(@Req() req: any, @Param('id') id: string) {
    return this.changeTicketsService.getById(id, this.ensureAdmin(req));
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit change ticket to approval' })
  submit(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: SubmitChangeTicketDto,
  ) {
    return this.changeTicketsService.submit(id, body, this.ensureAdmin(req));
  }

  @Post(':id/resubmit')
  @ApiOperation({ summary: 'Resubmit a rejected change ticket' })
  resubmit(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: ResubmitChangeTicketDto,
  ) {
    return this.changeTicketsService.resubmit(id, body, this.ensureAdmin(req));
  }

  @Get(':id/gate-runs')
  @ApiOperation({ summary: 'List gate runs for a change ticket' })
  gateRuns(@Req() req: any, @Param('id') id: string) {
    this.ensureAdmin(req);
    return this.releaseGatesService.listGateRuns(id);
  }

  @Post(':id/gate-checks')
  @ApiOperation({ summary: 'Run a release gate check' })
  gateCheck(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: GateCheckDto,
  ) {
    return this.releaseGatesService.runGateCheck(id, body, this.ensureAdmin(req));
  }

  @Post(':id/deploy-status')
  @ApiOperation({ summary: 'Mark deploy status for a change ticket' })
  markDeployStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: MarkDeployStatusDto,
  ) {
    return this.releaseGatesService.markDeployStatus(id, body, this.ensureAdmin(req));
  }

  @Post(':id/close')
  @ApiOperation({ summary: 'Close a change ticket' })
  close(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: CloseChangeTicketDto,
  ) {
    return this.changeTicketsService.close(id, body, this.ensureAdmin(req));
  }
}

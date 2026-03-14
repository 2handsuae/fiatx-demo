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
import { ApprovalsService } from './approvals.service';
import {
  ApprovalActorContext,
} from './constants/approval.constants';
import {
  ApprovalQueryDto,
  CancelApprovalDto,
  CreateApprovalDto,
  DecisionApprovalDto,
  SubmitApprovalDto,
} from './dto/approval.dto';

@ApiTags('Admin - Governance Approvals')
@Controller('admin/control-gates/approvals')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

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
  @ApiOperation({ summary: 'Create an approval case' })
  create(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: CreateApprovalDto,
  ) {
    return this.approvalsService.create(body, this.ensureAdmin(req));
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit an approval case' })
  submit(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: SubmitApprovalDto,
  ) {
    return this.approvalsService.submit(id, body, this.ensureAdmin(req));
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve an approval case' })
  approve(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: DecisionApprovalDto,
  ) {
    return this.approvalsService.approve(id, body, this.ensureAdmin(req));
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject an approval case' })
  reject(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: DecisionApprovalDto,
  ) {
    return this.approvalsService.reject(id, body, this.ensureAdmin(req));
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel an approval case' })
  cancel(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: CancelApprovalDto,
  ) {
    return this.approvalsService.cancel(id, body, this.ensureAdmin(req));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get approval case detail' })
  getById(@Req() req: any, @Param('id') id: string) {
    return this.approvalsService.getById(id, this.ensureAdmin(req));
  }

  @Get()
  @ApiOperation({ summary: 'List approval cases' })
  list(
    @Req() req: any,
    @Query(new ValidationPipe({ transform: true })) query: ApprovalQueryDto,
  ) {
    return this.approvalsService.list(query, this.ensureAdmin(req));
  }
}

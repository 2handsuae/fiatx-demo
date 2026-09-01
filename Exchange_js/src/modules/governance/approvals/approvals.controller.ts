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
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { ApprovalsService } from './approvals.service';
import {
  ApprovalActorContext,
} from './constants/approval.constants';
import {
  ApprovalQueryDto,
  CancelApprovalDto,
  DecisionApprovalDto,
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

  // create()/submit() HTTP handlers retired (Task 4, D7) — zero HTTP callers found;
  // every internal workflow opens/submits cases via ApprovalsService.createAndSubmit()
  // directly (service-to-service), not through this controller. The underlying
  // ApprovalsService.create()/submit() methods had no other callers either and have
  // since been removed too (see task-4-report.md).

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

  @Post(':approvalNo/simulate-timeout')
  @ApiOperation({ summary: '演示用：把该审批单的超时时间拨到过去，下轮扫描即过期' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/control-gates/approvals/:approvalNo/simulate-timeout'))
  simulateTimeout(@Req() req: any, @Param('approvalNo') approvalNo: string) {
    return this.approvalsService.simulateTimeoutByNo(approvalNo, this.ensureAdmin(req));
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

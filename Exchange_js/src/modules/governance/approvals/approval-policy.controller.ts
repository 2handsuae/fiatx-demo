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
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { ApprovalActorContext, PolicyStepConfig } from './constants/approval.constants';
import { ApprovalPolicyService } from './approval-policy.service';
import { ApprovalPolicyChangeWorkflowService } from './approval-policy-change-workflow.service';

@ApiTags('Admin - Governance - Approval Policies')
@Controller('admin/governance/approval-policies')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class ApprovalPolicyController {
  constructor(
    private readonly policyService: ApprovalPolicyService,
    private readonly workflowService: ApprovalPolicyChangeWorkflowService,
  ) {}

  private buildAdminActor(req: any): ApprovalActorContext {
    return {
      actorType: 'ADMIN',
      userId: req.user.userId,
      userNo: req.user.userNo,
      role: req.user.role || 'ADMIN',
      roleCodes: req.user.roleCodes || [req.user.role || 'ADMIN'],
    };
  }

  // ─── Policy Read ──────────────────────────────────

  @Get()
  @RequirePermissions(buildPermissionCode('GET', '/admin/governance/approval-policies'))
  @ApiOperation({ summary: 'List all V1 approval policies (merged defaults + DB overrides)' })
  listPolicies(@Req() req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
    return this.policyService.listV1Policies();
  }

  // ─── Change Request Operations ────────────────────

  @Post(':actionType/change-requests')
  @RequirePermissions(buildPermissionCode('POST', '/admin/governance/approval-policies/:actionType/change-requests'))
  @ApiOperation({ summary: 'Create approval policy change request' })
  createChangeRequest(
    @Param('actionType') actionType: string,
    @Body() body: { proposedSteps: PolicyStepConfig[]; changeReason: string },
    @Req() req: any,
  ) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
    return this.workflowService.requestChange(
      actionType,
      body.proposedSteps,
      body.changeReason,
      this.buildAdminActor(req),
    );
  }

  @Get('change-requests')
  @RequirePermissions(buildPermissionCode('GET', '/admin/governance/approval-policies/change-requests'))
  @ApiOperation({ summary: 'List approval policy change requests' })
  listChangeRequests(
    @Req() req: any,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('status') status?: string,
  ) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
    return this.workflowService.listChangeRequests({
      skip: skip ? parseInt(skip, 10) : undefined,
      take: take ? parseInt(take, 10) : undefined,
      status,
    });
  }

  @Get('change-requests/:id')
  @RequirePermissions(buildPermissionCode('GET', '/admin/governance/approval-policies/change-requests/:id'))
  @ApiOperation({ summary: 'Get approval policy change request detail' })
  getChangeRequest(
    @Req() req: any,
    @Param('id') id: string,
  ) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
    return this.workflowService.getChangeRequestById(id);
  }
}

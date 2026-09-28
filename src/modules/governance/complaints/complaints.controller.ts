// 战役甲波五 T5 · 投诉两面控制器（admin 面）。路由→服务/workflow 转发，不加业务规则
// （校验/状态机/审计全在 T2-T4 服务层）。三件套（buildActor/assertAdmin/
// @RequirePermissions(buildPermissionCode(...))）逐行照 regulatory-filings.controller.ts。
// 铁律②门不可绕：propose-resolution 调 ComplaintResolutionWorkflowService（T3）、escalate 调
// ComplaintEscalationWorkflowService（T4）——两条路由都不直调 ComplaintsService，门在 workflow。
// 路径与 rbac.catalog.ts 登记的 route() 逐条一致（本任务同批新增）。
import { Body, Controller, ForbiddenException, Get, Param, Post, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import { ComplaintsService } from './complaints.service';
import { ComplaintResolutionWorkflowService } from './complaint-resolution-workflow.service';
import { ComplaintEscalationWorkflowService } from './complaint-escalation-workflow.service';
import {
  AcknowledgeComplaintBodyDto, AddNoteBodyDto, ExtendComplaintBodyDto, ResolutionBodyDto, SimulateTimeoutBodyDto,
} from './dto/complaint.dto';

@ApiTags('Admin - Complaints')
@ApiBearerAuth()
@Controller('admin/complaints')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class ComplaintsController {
  constructor(
    private readonly complaints: ComplaintsService,
    private readonly resolutionWorkflow: ComplaintResolutionWorkflowService,
    private readonly escalationWorkflow: ComplaintEscalationWorkflowService,
  ) {}

  /** 同 incidents.controller.ts / regulatory-filings.controller.ts：整个 actor 往下传。 */
  private buildActor(req: any): ApprovalActorContext {
    const user = req.user;
    return { actorType: 'ADMIN', userId: user.userId || user.sub, userNo: user.userNo, role: user.role, roleCodes: user.roleCodes || (user.role ? [user.role] : []) };
  }

  /** AdminPermissionGuard 对非 ADMIN token 是 NO-OP，本控制器全域写动作补一道类型判断。 */
  private assertAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin only');
    }
  }

  @Get()
  @ApiOperation({ summary: 'List complaints' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/complaints'))
  list() {
    return this.complaints.listAdmin();
  }

  @Get(':complaintNo')
  @ApiOperation({ summary: 'Complaint detail' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/complaints/:complaintNo'))
  detail(@Param('complaintNo') complaintNo: string) {
    return this.complaints.getAdmin(complaintNo);
  }

  @Post(':complaintNo/acknowledge')
  @ApiOperation({ summary: 'Acknowledge receipt of a complaint (RECEIVED → ACKNOWLEDGED)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/complaints/:complaintNo/acknowledge'))
  acknowledge(@Param('complaintNo') complaintNo: string, @Body() dto: AcknowledgeComplaintBodyDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.complaints.acknowledge(this.buildActor(req), complaintNo, dto);
  }

  @Post(':complaintNo/investigation')
  @ApiOperation({ summary: 'Start investigation (ACKNOWLEDGED → INVESTIGATING)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/complaints/:complaintNo/investigation'))
  startInvestigation(@Param('complaintNo') complaintNo: string, @Req() req: any) {
    this.assertAdmin(req);
    return this.complaints.startInvestigation(this.buildActor(req), complaintNo);
  }

  @Post(':complaintNo/notes')
  @ApiOperation({ summary: 'Add an internal note' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/complaints/:complaintNo/notes'))
  addNote(@Param('complaintNo') complaintNo: string, @Body() dto: AddNoteBodyDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.complaints.addNote(this.buildActor(req), complaintNo, dto.body);
  }

  @Post(':complaintNo/extend')
  @ApiOperation({ summary: 'Extend the resolution deadline once, with a mandatory explanation' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/complaints/:complaintNo/extend'))
  extend(@Param('complaintNo') complaintNo: string, @Body() dto: ExtendComplaintBodyDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.complaints.extend(this.buildActor(req), complaintNo, dto);
  }

  @Post(':complaintNo/propose-resolution')
  @ApiOperation({ summary: 'Propose a resolution (opens an approval — compliance officer decides)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/complaints/:complaintNo/propose-resolution'))
  proposeResolution(@Param('complaintNo') complaintNo: string, @Body() dto: ResolutionBodyDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.resolutionWorkflow.propose(this.buildActor(req), complaintNo, dto);
  }

  @Post(':complaintNo/escalate')
  @ApiOperation({ summary: 'Escalate a complaint into an incident (COMPLAINT_ESCALATION)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/complaints/:complaintNo/escalate'))
  escalate(@Param('complaintNo') complaintNo: string, @Req() req: any) {
    this.assertAdmin(req);
    return this.escalationWorkflow.escalate(this.buildActor(req), complaintNo);
  }

  // ⚡ 演示装置：挂 DEMO_CLOCK_WRITE（金库），非 COMPLAINT_WRITE——同
  // regulatory-filings.controller.ts simulate-deadline-timeout 路由注释。
  @Post(':complaintNo/simulate-timeout')
  @ApiOperation({ summary: 'Fast-forward a complaint deadline into the past (demo only)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/complaints/:complaintNo/simulate-timeout'))
  simulateTimeout(@Param('complaintNo') complaintNo: string, @Body() dto: SimulateTimeoutBodyDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.complaints.simulateTimeout(this.buildActor(req), complaintNo, dto.target);
  }
}

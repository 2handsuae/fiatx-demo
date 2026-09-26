// 平账三期 · 事故登记（Task 8）：HTTP 层。路由→服务转发，不加业务规则
// （校验/状态机/审计全在 Task 5-7 服务层）。登记端点必须走
// IncidentRegistrationWorkflowService（铁律③跨主体写回定性行只在 workflow）；
// 结案同理走 IncidentCloseWorkflowService（审批编排）；定损端点同理走
// IncidentAssessmentWorkflowService（甲波二 T6：reportRequired=true 时联动自动开报送单）。
// 路径与 rbac.catalog.ts 登记的 route() 逐条一致（甲波二 T6：regulator-report 两条随
// saveReportDraft/markReported 一并退役，12 → 10）。
import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import { IncidentService } from './incident.service';
import { IncidentRegistrationWorkflowService } from './incident-registration-workflow.service';
import { IncidentCloseWorkflowService } from './incident-close-workflow.service';
import { IncidentAssessmentWorkflowService } from './incident-assessment-workflow.service';
import {
  AddIncidentNoteDto, AssessIncidentBodyDto, EscalateIncidentBodyDto, IncidentListQueryDto,
  LinkRemediationBodyDto, RegisterIncidentBodyDto,
  WithdrawIncidentDto,
} from './dto/incident.dto';

@ApiTags('Admin - Incidents')
@ApiBearerAuth()
@Controller('admin/incidents')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class IncidentsController {
  constructor(
    private readonly incidents: IncidentService,
    private readonly registrationWorkflow: IncidentRegistrationWorkflowService,
    private readonly closeWorkflow: IncidentCloseWorkflowService,
    private readonly assessmentWorkflow: IncidentAssessmentWorkflowService,
  ) {}

  /** 同 internal-transfer.controller.ts：整个 actor 往下传。 */
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

  @Post()
  @ApiOperation({ summary: 'Register incident (case escalation or manual)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/incidents'))
  register(@Body() dto: RegisterIncidentBodyDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.registrationWorkflow.register(dto, this.buildActor(req));
  }

  @Get()
  @ApiOperation({ summary: 'List incidents' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/incidents'))
  list(@Query() q: IncidentListQueryDto) {
    return this.incidents.list(q);
  }

  @Get(':incidentNo')
  @ApiOperation({ summary: 'Incident detail' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/incidents/:incidentNo'))
  detail(@Param('incidentNo') incidentNo: string) {
    return this.incidents.getView(incidentNo);
  }

  @Post(':incidentNo/investigation')
  @ApiOperation({ summary: 'Start investigation' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/incidents/:incidentNo/investigation'))
  startInvestigation(@Param('incidentNo') incidentNo: string, @Req() req: any) {
    this.assertAdmin(req);
    return this.incidents.startInvestigation(incidentNo, this.buildActor(req));
  }

  @Post(':incidentNo/notes')
  @ApiOperation({ summary: 'Add investigation note' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/incidents/:incidentNo/notes'))
  addNote(@Param('incidentNo') incidentNo: string, @Body() dto: AddIncidentNoteDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.incidents.addNote(incidentNo, dto.body, this.buildActor(req));
  }

  @Post(':incidentNo/escalate')
  @ApiOperation({ summary: 'Record escalation (MLRO / CFO / senior management)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/incidents/:incidentNo/escalate'))
  escalate(@Param('incidentNo') incidentNo: string, @Body() dto: EscalateIncidentBodyDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.incidents.escalate(incidentNo, dto, this.buildActor(req));
  }

  @Post(':incidentNo/assess')
  @ApiOperation({ summary: 'Record assessment and reporting determination (auto-opens regulator filings when required)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/incidents/:incidentNo/assess'))
  assess(@Param('incidentNo') incidentNo: string, @Body() dto: AssessIncidentBodyDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.assessmentWorkflow.assess(incidentNo, dto, this.buildActor(req));
  }

  @Post(':incidentNo/remediations')
  @ApiOperation({ summary: 'Link remediation' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/incidents/:incidentNo/remediations'))
  linkRemediation(@Param('incidentNo') incidentNo: string, @Body() dto: LinkRemediationBodyDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.incidents.linkRemediation(incidentNo, dto, this.buildActor(req));
  }

  @Post(':incidentNo/close')
  @ApiOperation({ summary: 'Request close (opens approval)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/incidents/:incidentNo/close'))
  requestClose(@Param('incidentNo') incidentNo: string, @Req() req: any) {
    this.assertAdmin(req);
    return this.closeWorkflow.requestClose(incidentNo, this.buildActor(req));
  }

  @Post(':incidentNo/withdraw')
  @ApiOperation({ summary: 'Withdraw a misregistered incident' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/incidents/:incidentNo/withdraw'))
  withdraw(@Param('incidentNo') incidentNo: string, @Body() dto: WithdrawIncidentDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.incidents.withdraw(incidentNo, dto.reason, this.buildActor(req));
  }
}

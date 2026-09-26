// 战役甲波四 T5：合规办公室骨架 HTTP 层——闹钟墙 + 周期义务 + 两本登记册，四个逻辑资源
// 共一个控制器文件（brief 明确只建这一个 controller）。路由→服务转发，不加业务规则
// （校验/状态机/审计全在 T2-T4 服务层）。actor 取法/DTO 风格逐处照抄
// regulatory-filings.controller.ts。@Controller() 空前缀——四个资源各自的路径与
// rbac.catalog.ts 登记的 route() 逐条一致，不共享同一段前缀。
import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import { ComplianceClockWallService } from './compliance-clock-wall.service';
import { ComplianceObligationsService } from './compliance-obligations.service';
import { OutsourcingVendorsService } from './outsourcing-vendors.service';
import { ResponsibleIndividualsService } from './responsible-individuals.service';
import { RiReplacementWorkflowService } from './ri-replacement-workflow.service';
import {
  CreateObligationBodyDto, CreateSeatBodyDto, CreateVendorBodyDto, ProposeReplacementBodyDto,
  SetObligationStatusBodyDto, TerminateVendorBodyDto, UpdateObligationBodyDto, UpdateVendorBodyDto,
} from './dto/compliance-office.dto';

@ApiTags('Admin - Compliance Office')
@ApiBearerAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class ComplianceOfficeController {
  constructor(
    private readonly clockWall: ComplianceClockWallService,
    private readonly obligations: ComplianceObligationsService,
    private readonly vendors: OutsourcingVendorsService,
    private readonly responsibleIndividuals: ResponsibleIndividualsService,
    private readonly riReplacementWorkflow: RiReplacementWorkflowService,
  ) {}

  /** 同 regulatory-filings.controller.ts：整个 actor 往下传。 */
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

  // ── 闹钟墙（spec §2）─────────────────────────────────────────────────

  @Get('admin/compliance-office/clock-wall')
  @ApiOperation({ summary: 'Compliance clock wall — aggregate filing deadlines and obligation due dates' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/compliance-office/clock-wall'))
  clockWallView() {
    return this.clockWall.getWall();
  }

  // ── 周期义务（合规日历，spec §3）───────────────────────────────────────

  @Get('admin/compliance-obligations')
  @ApiOperation({ summary: 'List compliance obligations' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/compliance-obligations'))
  listObligations() {
    return this.obligations.list();
  }

  @Get('admin/compliance-obligations/:obligationNo')
  @ApiOperation({ summary: 'Compliance obligation detail' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/compliance-obligations/:obligationNo'))
  getObligation(@Param('obligationNo') obligationNo: string) {
    return this.obligations.getView(obligationNo);
  }

  @Post('admin/compliance-obligations')
  @ApiOperation({ summary: 'Register a compliance obligation' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/compliance-obligations'))
  createObligation(@Body() dto: CreateObligationBodyDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.obligations.create(this.buildActor(req), dto);
  }

  @Patch('admin/compliance-obligations/:obligationNo')
  @ApiOperation({ summary: 'Update a compliance obligation' })
  @RequirePermissions(buildPermissionCode('PATCH', '/admin/compliance-obligations/:obligationNo'))
  updateObligation(@Param('obligationNo') obligationNo: string, @Body() dto: UpdateObligationBodyDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.obligations.update(obligationNo, this.buildActor(req), dto);
  }

  @Post('admin/compliance-obligations/:obligationNo/status')
  @ApiOperation({ summary: 'Change obligation status (ACTIVE/DISABLED)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/compliance-obligations/:obligationNo/status'))
  setObligationStatus(@Param('obligationNo') obligationNo: string, @Body() dto: SetObligationStatusBodyDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.obligations.setStatus(obligationNo, this.buildActor(req), dto.to);
  }

  // ⚡ 演示装置（spec §3.2）
  @Post('admin/compliance-obligations/:obligationNo/simulate-due')
  @ApiOperation({ summary: 'Fast-forward obligation nextDueAt to now (demo only)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/compliance-obligations/:obligationNo/simulate-due'))
  simulateObligationDue(@Param('obligationNo') obligationNo: string, @Req() req: any) {
    this.assertAdmin(req);
    return this.obligations.simulateDue(this.buildActor(req), obligationNo);
  }

  // ── 外包商册（spec §4.1）───────────────────────────────────────────────

  @Get('admin/outsourcing-vendors')
  @ApiOperation({ summary: 'List outsourcing vendors' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/outsourcing-vendors'))
  listVendors() {
    return this.vendors.list();
  }

  @Get('admin/outsourcing-vendors/:vendorNo')
  @ApiOperation({ summary: 'Outsourcing vendor detail' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/outsourcing-vendors/:vendorNo'))
  getVendor(@Param('vendorNo') vendorNo: string) {
    return this.vendors.getView(vendorNo);
  }

  @Post('admin/outsourcing-vendors')
  @ApiOperation({ summary: 'Register an outsourcing vendor' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/outsourcing-vendors'))
  registerVendor(@Body() dto: CreateVendorBodyDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.vendors.register(this.buildActor(req), dto);
  }

  @Patch('admin/outsourcing-vendors/:vendorNo')
  @ApiOperation({ summary: 'Update an outsourcing vendor' })
  @RequirePermissions(buildPermissionCode('PATCH', '/admin/outsourcing-vendors/:vendorNo'))
  updateVendor(@Param('vendorNo') vendorNo: string, @Body() dto: UpdateVendorBodyDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.vendors.update(vendorNo, this.buildActor(req), dto);
  }

  @Post('admin/outsourcing-vendors/:vendorNo/terminate')
  @ApiOperation({ summary: 'Terminate an outsourcing vendor' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/outsourcing-vendors/:vendorNo/terminate'))
  terminateVendor(@Param('vendorNo') vendorNo: string, @Body() dto: TerminateVendorBodyDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.vendors.terminate(vendorNo, this.buildActor(req), dto);
  }

  // ── RI 册（spec §4.2）────────────────────────────────────────────────

  @Get('admin/responsible-individuals')
  @ApiOperation({ summary: 'List responsible individual seats' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/responsible-individuals'))
  listResponsibleIndividuals() {
    return this.responsibleIndividuals.list();
  }

  @Get('admin/responsible-individuals/:riNo')
  @ApiOperation({ summary: 'Responsible individual seat detail' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/responsible-individuals/:riNo'))
  getResponsibleIndividual(@Param('riNo') riNo: string) {
    return this.responsibleIndividuals.getView(riNo);
  }

  @Post('admin/responsible-individuals')
  @ApiOperation({ summary: 'Register a responsible individual seat' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/responsible-individuals'))
  createSeat(@Body() dto: CreateSeatBodyDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.responsibleIndividuals.createSeat(this.buildActor(req), dto);
  }

  // 事前审批：合规官提、高管单步批（spec §4.2）——走 workflow 正门开单，不直调服务方法。
  @Post('admin/responsible-individuals/:riNo/replacement')
  @ApiOperation({ summary: 'Propose a responsible individual replacement (opens an approval)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/responsible-individuals/:riNo/replacement'))
  proposeReplacement(@Param('riNo') riNo: string, @Body() dto: ProposeReplacementBodyDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.riReplacementWorkflow.initiateReplacement(riNo, dto, this.buildActor(req));
  }
}

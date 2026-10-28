// 战役甲波四 T5：合规办公室骨架 HTTP 层——闹钟墙 + 周期义务 + 两本登记册，四个逻辑资源
// 共一个控制器文件（brief 明确只建这一个 controller）。路由→服务转发，不加业务规则
// （校验/状态机/审计全在 T2-T4 服务层）。actor 取法/DTO 风格逐处照抄
// regulatory-filings.controller.ts。@Controller() 空前缀——四个资源各自的路径与
// rbac.catalog.ts 登记的 route() 逐条一致，不共享同一段前缀。
// 甲波六 T6：外包商册改成服务商准入——POST admin/outsourcing-vendors 是运营的「申请」（VENDOR_APPLY），合规官的直接登记 / 修改路由
// 整条退役（PATCH :vendorNo 已删）；合规评估四个写动作 + 升档归合规官独占的 DUE_DILIGENCE_WRITE，信息安全评估归 CISO 的
// INFOSEC_ASSESSMENT_WRITE，终止仍归 VENDOR_REGISTER_WRITE；写动作全在 OutsourcingVendorWorkflowService。上传端点的文件走 multer
// 内存存储（FileInterceptor 默认），落盘与元数据由 DocumentsService 负责；文件参数标 UploadedFileLike（同 lp-profile.controller.ts：
// Express.Multer.File 靠 @types/multer 的全局扩展，ts-jest 按文件取类型时拿不到）。
import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors, UsePipes, ValidationPipe } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { UploadedFileLike } from '../../../core/documents/documents.service';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import { ComplianceClockWallService } from './compliance-clock-wall.service';
import { ComplianceObligationsService } from './compliance-obligations.service';
import { OutsourcingVendorsService } from './outsourcing-vendors.service';
import { OutsourcingVendorWorkflowService } from './outsourcing-vendor-workflow.service';
import { ResponsibleIndividualsService } from './responsible-individuals.service';
import { RiReplacementWorkflowService } from './ri-replacement-workflow.service';
import {
  ApplyVendorBodyDto, CreateObligationBodyDto, CreateSeatBodyDto, ProposeReplacementBodyDto, ResubmitVendorBodyDto,
  SetObligationStatusBodyDto, TerminateVendorBodyDto, UpdateObligationBodyDto, UpgradeMaterialityDto,
} from './dto/compliance-office.dto';
import { ConcludeAssessmentDto, RecordInfosecDto, RecordScreeningDto, SaveAssessmentDto } from './dto/due-diligence.dto';

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
    private readonly vendorWorkflow: OutsourcingVendorWorkflowService,
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

  // ── 服务商准入（原外包商册，spec §4.1；甲波六 T6 改写）─────────────────────

  // 读：列表 / 详情 / 材料 / 评估视图，七职务可读（VENDOR_READ）——两步审批的每个批准人都要读得到详情。
  @Get('admin/outsourcing-vendors')
  @ApiOperation({ summary: 'List service providers (outsourcing vendors)' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/outsourcing-vendors'))
  listVendors() {
    return this.vendors.list();
  }

  @Get('admin/outsourcing-vendors/:vendorNo')
  @ApiOperation({ summary: 'Service provider detail' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/outsourcing-vendors/:vendorNo'))
  getVendor(@Param('vendorNo') vendorNo: string) {
    return this.vendors.getView(vendorNo);
  }

  @Get('admin/outsourcing-vendors/:vendorNo/documents')
  @ApiOperation({ summary: 'List the application documents of a service provider' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/outsourcing-vendors/:vendorNo/documents'))
  listVendorDocuments(@Param('vendorNo') vendorNo: string) {
    return this.vendorWorkflow.listDocuments(vendorNo);
  }

  @Get('admin/outsourcing-vendors/:vendorNo/assessment')
  @ApiOperation({ summary: 'Due diligence assessment of a service provider (screening records + flags + infosec)' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/outsourcing-vendors/:vendorNo/assessment'))
  vendorAssessment(@Param('vendorNo') vendorNo: string) {
    return this.vendorWorkflow.getAssessment(vendorNo);
  }

  // 申请（运营）：重大性由系统按四问判，申请表里没有 criticality。
  @Post('admin/outsourcing-vendors')
  @ApiOperation({ summary: 'Apply for a service provider — compliance assesses it before any approval is raised' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/outsourcing-vendors'))
  applyVendor(@Body() dto: ApplyVendorBodyDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.vendorWorkflow.apply(dto, this.buildActor(req));
  }

  @Post('admin/outsourcing-vendors/:vendorNo/resubmit')
  @ApiOperation({ summary: 'Resubmit a returned service provider application (whole form replaced; materiality never downgrades)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/outsourcing-vendors/:vendorNo/resubmit'))
  resubmitVendor(@Param('vendorNo') vendorNo: string, @Body() dto: ResubmitVendorBodyDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.vendorWorkflow.resubmit(vendorNo, dto, this.buildActor(req));
  }

  @Post('admin/outsourcing-vendors/:vendorNo/documents')
  @ApiOperation({ summary: 'Upload one application document (multipart: file + docType)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  @RequirePermissions(buildPermissionCode('POST', '/admin/outsourcing-vendors/:vendorNo/documents'))
  uploadVendorDocument(@Param('vendorNo') vendorNo: string, @UploadedFile() file: UploadedFileLike, @Body('docType') docType: string, @Req() req: any) {
    this.assertAdmin(req);
    return this.vendorWorkflow.uploadDocument(vendorNo, docType, file, this.buildActor(req));
  }

  // 合规评估（合规官独占）
  @Post('admin/outsourcing-vendors/:vendorNo/assessment/screening-records')
  @ApiOperation({ summary: 'Record one screening result (the company or one beneficial owner)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/outsourcing-vendors/:vendorNo/assessment/screening-records'))
  recordVendorScreening(@Param('vendorNo') vendorNo: string, @Body() dto: RecordScreeningDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.vendorWorkflow.recordScreening(vendorNo, dto, this.buildActor(req));
  }

  @Post('admin/outsourcing-vendors/:vendorNo/assessment/screening-records/:recordNo/evidence')
  @ApiOperation({ summary: 'Attach the evidence screenshot of a screening record (multipart: file)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  @RequirePermissions(buildPermissionCode('POST', '/admin/outsourcing-vendors/:vendorNo/assessment/screening-records/:recordNo/evidence'))
  attachVendorEvidence(@Param('vendorNo') vendorNo: string, @Param('recordNo') recordNo: string, @UploadedFile() file: UploadedFileLike, @Req() req: any) {
    this.assertAdmin(req);
    return this.vendorWorkflow.attachEvidence(vendorNo, recordNo, file, this.buildActor(req));
  }

  @Patch('admin/outsourcing-vendors/:vendorNo/assessment')
  @ApiOperation({ summary: 'Save the risk tier, assessment opinion and conditions' })
  @RequirePermissions(buildPermissionCode('PATCH', '/admin/outsourcing-vendors/:vendorNo/assessment'))
  saveVendorAssessment(@Param('vendorNo') vendorNo: string, @Body() dto: SaveAssessmentDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.vendorWorkflow.saveAssessment(vendorNo, dto, this.buildActor(req));
  }

  @Post('admin/outsourcing-vendors/:vendorNo/assessment/conclude')
  @ApiOperation({ summary: 'Conclude the assessment: return for documents / reject / send for approval (materiality picks the approval route)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/outsourcing-vendors/:vendorNo/assessment/conclude'))
  concludeVendorAssessment(@Param('vendorNo') vendorNo: string, @Body() dto: ConcludeAssessmentDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.vendorWorkflow.conclude(vendorNo, dto, this.buildActor(req));
  }

  @Post('admin/outsourcing-vendors/:vendorNo/assessment/upgrade-materiality')
  @ApiOperation({ summary: 'Upgrade a NON_MATERIAL service provider to MATERIAL (reason required; never downgrades)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/outsourcing-vendors/:vendorNo/assessment/upgrade-materiality'))
  upgradeVendorMateriality(@Param('vendorNo') vendorNo: string, @Body() dto: UpgradeMaterialityDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.vendorWorkflow.upgradeMateriality(vendorNo, dto, this.buildActor(req));
  }

  // 信息安全评估（CISO 独占，仅重大服务商需要）
  @Post('admin/outsourcing-vendors/:vendorNo/assessment/infosec')
  @ApiOperation({ summary: 'Record the CISO information-security assessment of a MATERIAL service provider' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/outsourcing-vendors/:vendorNo/assessment/infosec'))
  recordVendorInfosec(@Param('vendorNo') vendorNo: string, @Body() dto: RecordInfosecDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.vendorWorkflow.recordInfosec(vendorNo, dto, this.buildActor(req));
  }

  @Post('admin/outsourcing-vendors/:vendorNo/terminate')
  @ApiOperation({ summary: 'Terminate an active service provider' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/outsourcing-vendors/:vendorNo/terminate'))
  terminateVendor(@Param('vendorNo') vendorNo: string, @Body() dto: TerminateVendorBodyDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.vendorWorkflow.terminate(vendorNo, dto, this.buildActor(req));
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

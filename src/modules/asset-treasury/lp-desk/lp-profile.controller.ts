import { Body, Controller, Get, Param, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors, UsePipes, ValidationPipe } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { UploadedFileLike } from '../../../core/documents/documents.service';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { ConcludeAssessmentDto, RecordScreeningDto, SaveAssessmentDto } from '../../governance/compliance-office/dto/due-diligence.dto';
import { LpProfileService } from './lp-profile.service';
import { LpProfileWorkflowService } from './lp-profile-workflow.service';
import { CreateLpProfileDto, ReactivateLpProfileDto, ResubmitLpProfileDto, SuspendLpProfileDto } from './dto/lp-profile.dto';

/** 战役乙波一 T3 · LP 档案端点。申请 / 重提 / 传文件 / 启停归金库（LP_WRITE），列表 / 详情 / 文件列表 / 评估视图归 LP_READ；
 *  甲波六 T4：合规评估四个写动作（登记筛查 / 传证据 / 定档 / 下结论）归合规官独占的 DUE_DILIGENCE_WRITE；
 *  写动作全在 workflow（同 internal-transfer.controller.ts 先例）。上传端点的文件走 multer 内存存储（FileInterceptor 默认），
 *  落盘与元数据由 DocumentsService 负责。
 *  文件参数标 UploadedFileLike（multer 文件的结构子集）而非 Express.Multer.File：后者靠 @types/multer 的全局扩展，ts-jest / ts-node
 *  按文件取类型时拿不到该扩展（tsc 全量编译才有），结构类型两边都稳。 */
@ApiTags('Admin - LP Desk')
@ApiBearerAuth()
@Controller('admin/lp-profiles')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class LpProfileController {
  constructor(
    private readonly workflow: LpProfileWorkflowService,
    private readonly profiles: LpProfileService,
  ) {}

  private buildActor(req: any): ApprovalActorContext {
    const user = req.user;
    return { actorType: 'ADMIN', userId: user.userId || user.sub, userNo: user.userNo, role: user.role, roleCodes: user.roleCodes || (user.role ? [user.role] : []) };
  }

  // ── 申请 ────────────────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Submit a liquidity provider application — compliance assesses it before any approval is raised' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/lp-profiles'))
  create(@Body() dto: CreateLpProfileDto, @Req() req: any) {
    return this.workflow.initiateCreate(dto, this.buildActor(req));
  }

  @Post(':lpNo/resubmit')
  @ApiOperation({ summary: 'Resubmit a returned application (whole form replaced)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/lp-profiles/:lpNo/resubmit'))
  resubmit(@Param('lpNo') lpNo: string, @Body() dto: ResubmitLpProfileDto, @Req() req: any) {
    return this.workflow.resubmit(lpNo, dto, this.buildActor(req));
  }

  @Post(':lpNo/documents')
  @ApiOperation({ summary: 'Upload one application document (multipart: file + docType)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  @RequirePermissions(buildPermissionCode('POST', '/admin/lp-profiles/:lpNo/documents'))
  uploadDocument(@Param('lpNo') lpNo: string, @UploadedFile() file: UploadedFileLike, @Body('docType') docType: string, @Req() req: any) {
    return this.workflow.uploadDocument(lpNo, docType, file, this.buildActor(req));
  }

  @Get(':lpNo/documents')
  @ApiOperation({ summary: 'List the application documents of a liquidity provider' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/lp-profiles/:lpNo/documents'))
  listDocuments(@Param('lpNo') lpNo: string) {
    return this.workflow.listDocuments(lpNo);
  }

  // ── 合规评估 ────────────────────────────────────────────────────────

  @Get(':lpNo/assessment')
  @ApiOperation({ summary: 'Due diligence assessment of a liquidity provider (screening records + flags)' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/lp-profiles/:lpNo/assessment'))
  assessment(@Param('lpNo') lpNo: string) {
    return this.workflow.getAssessment(lpNo);
  }

  @Post(':lpNo/assessment/screening-records')
  @ApiOperation({ summary: 'Record one screening result (the company or one beneficial owner)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/lp-profiles/:lpNo/assessment/screening-records'))
  recordScreening(@Param('lpNo') lpNo: string, @Body() dto: RecordScreeningDto, @Req() req: any) {
    return this.workflow.recordScreening(lpNo, dto, this.buildActor(req));
  }

  @Post(':lpNo/assessment/screening-records/:recordNo/evidence')
  @ApiOperation({ summary: 'Attach the evidence screenshot of a screening record (multipart: file)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  @RequirePermissions(buildPermissionCode('POST', '/admin/lp-profiles/:lpNo/assessment/screening-records/:recordNo/evidence'))
  attachEvidence(@Param('lpNo') lpNo: string, @Param('recordNo') recordNo: string, @UploadedFile() file: UploadedFileLike, @Req() req: any) {
    return this.workflow.attachEvidence(lpNo, recordNo, file, this.buildActor(req));
  }

  @Patch(':lpNo/assessment')
  @ApiOperation({ summary: 'Save the risk tier, assessment opinion and conditions' })
  @RequirePermissions(buildPermissionCode('PATCH', '/admin/lp-profiles/:lpNo/assessment'))
  saveAssessment(@Param('lpNo') lpNo: string, @Body() dto: SaveAssessmentDto, @Req() req: any) {
    return this.workflow.saveAssessment(lpNo, dto, this.buildActor(req));
  }

  @Post(':lpNo/assessment/conclude')
  @ApiOperation({ summary: 'Conclude the assessment: return for documents / reject / send for approval (risk tier picks the approval route)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/lp-profiles/:lpNo/assessment/conclude'))
  conclude(@Param('lpNo') lpNo: string, @Body() dto: ConcludeAssessmentDto, @Req() req: any) {
    return this.workflow.conclude(lpNo, dto, this.buildActor(req));
  }

  // ── 启停 ────────────────────────────────────────────────────────────

  @Post(':lpNo/suspend')
  @ApiOperation({ summary: 'Suspend a liquidity provider' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/lp-profiles/:lpNo/suspend'))
  suspend(@Param('lpNo') lpNo: string, @Body() dto: SuspendLpProfileDto, @Req() req: any) {
    return this.workflow.suspend(lpNo, dto, this.buildActor(req));
  }

  @Post(':lpNo/reactivate')
  @ApiOperation({ summary: 'Reactivate a suspended liquidity provider' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/lp-profiles/:lpNo/reactivate'))
  reactivate(@Param('lpNo') lpNo: string, @Body() dto: ReactivateLpProfileDto, @Req() req: any) {
    return this.workflow.reactivate(lpNo, dto, this.buildActor(req));
  }

  // ── 读 ──────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List liquidity providers' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/lp-profiles'))
  list() {
    return this.profiles.list();
  }

  @Get(':lpNo')
  @ApiOperation({ summary: 'Liquidity provider detail' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/lp-profiles/:lpNo'))
  async detail(@Param('lpNo') lpNo: string) {
    const row = await this.profiles.findByNo(lpNo);
    return this.profiles.toView(row);
  }
}

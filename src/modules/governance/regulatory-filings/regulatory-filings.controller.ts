// 战役甲波二 · 报送台骨架（Task 5）：HTTP 层。路由→服务转发，不加业务规则
// （校验/状态机/审计全在 Task 3-4 服务层）。模板逐处照抄 incidents.controller.ts
// （buildActor/assertAdmin/@RequirePermissions(buildPermissionCode(...)) 三件套）。
// 签发端点走 RegulatoryFilingWorkflowService（铁律③跨主体协作只在 workflow——审批是
// 另一个主体）；其余九条直调 RegulatoryFilingService，本控制器不经 workflow。路径与
// rbac.catalog.ts 登记的 route() 逐条一致（战役甲波三 T3 新增 close-no-filing 第 10 条，
// route() 登记随 T6，本文件不改 rbac.catalog.ts）。
import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import { RegulatoryFilingService } from './regulatory-filing.service';
import { RegulatoryFilingWorkflowService } from './regulatory-filing-workflow.service';
import {
  CancelFilingDto, CloseFilingDto, CloseNoFilingDto, FilingEntryBodyDto, FilingListQueryDto,
  MarkFilingSubmittedBodyDto, OpenFilingBodyDto, SaveFilingDraftDto,
} from './dto/regulatory-filing.dto';

@ApiTags('Admin - Regulatory Filings')
@ApiBearerAuth()
@Controller('admin/regulatory-filings')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class RegulatoryFilingsController {
  constructor(
    private readonly filings: RegulatoryFilingService,
    private readonly workflow: RegulatoryFilingWorkflowService,
  ) {}

  /** 同 incidents.controller.ts：整个 actor 往下传。 */
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
  @ApiOperation({ summary: 'Open a filing (manual)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/regulatory-filings'))
  openManual(@Body() dto: OpenFilingBodyDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.filings.openManual(dto, this.buildActor(req));
  }

  @Get()
  @ApiOperation({ summary: 'List regulatory filings' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/regulatory-filings'))
  list(@Query() q: FilingListQueryDto) {
    return this.filings.list(q);
  }

  @Get(':filingNo')
  @ApiOperation({ summary: 'Regulatory filing detail' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/regulatory-filings/:filingNo'))
  detail(@Param('filingNo') filingNo: string) {
    return this.filings.getView(filingNo);
  }

  @Post(':filingNo/draft')
  @ApiOperation({ summary: 'Save filing draft body' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/regulatory-filings/:filingNo/draft'))
  saveDraft(@Param('filingNo') filingNo: string, @Body() dto: SaveFilingDraftDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.filings.saveDraft(filingNo, dto.body, this.buildActor(req));
  }

  @Post(':filingNo/signoff')
  @ApiOperation({ summary: 'Request sign-off (opens approval)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/regulatory-filings/:filingNo/signoff'))
  submitForSignoff(@Param('filingNo') filingNo: string, @Req() req: any) {
    this.assertAdmin(req);
    return this.workflow.submitForSignoff(filingNo, this.buildActor(req));
  }

  @Post(':filingNo/mark-submitted')
  @ApiOperation({ summary: 'Mark filing as submitted to the regulator' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/regulatory-filings/:filingNo/mark-submitted'))
  markSubmitted(@Param('filingNo') filingNo: string, @Body() dto: MarkFilingSubmittedBodyDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.filings.markSubmitted(filingNo, dto, this.buildActor(req));
  }

  @Post(':filingNo/entries')
  @ApiOperation({ summary: 'Log a correspondence entry' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/regulatory-filings/:filingNo/entries'))
  addEntry(@Param('filingNo') filingNo: string, @Body() dto: FilingEntryBodyDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.filings.addEntry(filingNo, dto, this.buildActor(req));
  }

  @Post(':filingNo/close')
  @ApiOperation({ summary: 'Close a submitted filing' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/regulatory-filings/:filingNo/close'))
  close(@Param('filingNo') filingNo: string, @Body() dto: CloseFilingDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.filings.close(filingNo, this.buildActor(req), dto.note);
  }

  @Post(':filingNo/cancel')
  @ApiOperation({ summary: 'Cancel a draft filing' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/regulatory-filings/:filingNo/cancel'))
  cancel(@Param('filingNo') filingNo: string, @Body() dto: CancelFilingDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.filings.cancel(filingNo, dto.reason, this.buildActor(req));
  }

  // 战役甲波三 T3：DRAFT→CLOSED「决定不报」新边，唯本端点可走（既有 /close 维持仅
  // SUBMITTED 语义）——仅 allowNoFilingClose 类型（STR/SAR）真放行，服务层把关。
  // rbac.catalog.ts 的 route() 登记随 T6，路径与本端点完全一致。
  @Post(':filingNo/close-no-filing')
  @ApiOperation({ summary: 'Close a filing with a no-filing decision (STR/SAR only)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/regulatory-filings/:filingNo/close-no-filing'))
  closeNoFiling(@Param('filingNo') filingNo: string, @Body() dto: CloseNoFilingDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.filings.closeNoFiling(filingNo, dto.noFilingReason, this.buildActor(req));
  }

  // 战役甲波四 T5（spec §2 ⚡）：闹钟墙快进——挂 DEMO_CLOCK_WRITE（金库），非报送台经办组。
  @Post(':filingNo/simulate-deadline-timeout')
  @ApiOperation({ summary: 'Fast-forward filing deadline into the past (demo only)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/regulatory-filings/:filingNo/simulate-deadline-timeout'))
  simulateDeadlineTimeout(@Param('filingNo') filingNo: string, @Req() req: any) {
    this.assertAdmin(req);
    return this.filings.simulateDeadlineTimeout(filingNo, this.buildActor(req));
  }
}

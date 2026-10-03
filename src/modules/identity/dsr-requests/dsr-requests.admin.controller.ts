// 战役丙波四 T5 · DSR admin 面控制器。路由→服务转发，不加业务规则（校验/状态机/审计全在服务层）。
// 三件套（buildActor/assertAdmin/@RequirePermissions(buildPermissionCode(...))）逐行照
// complaints.controller.ts。路径与 rbac.catalog.ts 登记的 route() 逐条一致（本任务同批新增）：
// list/detail 挂 DSR_READ；start-review/generate-summary/resolve 挂 DSR_WRITE（DPO 独占）；
// ⚡simulate-timeout 挂既有 DEMO_CLOCK_WRITE（金库/超管）——DPO 是经办人但拨不动钟，是演示点不是缺陷。
import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../access-control/admin-permission.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { buildPermissionCode } from '../access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { DsrRequestsService } from './dsr-requests.service';
import { ResolveDsrBodyDto } from './dsr-requests.dto';

@ApiTags('Admin - Data Subject Requests')
@ApiBearerAuth()
@Controller('admin/dsr-requests')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class DsrRequestsAdminController {
  constructor(private readonly dsr: DsrRequestsService) {}

  private buildActor(req: any): ApprovalActorContext {
    const user = req.user;
    return { actorType: 'ADMIN', userId: user.userId || user.sub, userNo: user.userNo, role: user.role, roleCodes: user.roleCodes || (user.role ? [user.role] : []) };
  }

  /** AdminPermissionGuard 对非 ADMIN token 是 NO-OP，写动作补一道类型判断。 */
  private assertAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin only');
    }
  }

  @Get()
  @ApiOperation({ summary: 'List data subject requests (filter by type / status / overdue)' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/dsr-requests'))
  list(@Query('type') type?: string, @Query('status') status?: string, @Query('overdue') overdue?: string) {
    return this.dsr.listAdmin({ type, status, overdue: overdue === 'true' });
  }

  @Get(':requestNo')
  @ApiOperation({ summary: 'Data subject request detail' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/dsr-requests/:requestNo'))
  detail(@Param('requestNo') requestNo: string) {
    return this.dsr.detailAdmin(requestNo);
  }

  @Post(':requestNo/start-review')
  @ApiOperation({ summary: 'Start review (SUBMITTED → IN_REVIEW)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/dsr-requests/:requestNo/start-review'))
  startReview(@Param('requestNo') requestNo: string, @Req() req: any) {
    this.assertAdmin(req);
    return this.dsr.startReview(this.buildActor(req), requestNo);
  }

  @Post(':requestNo/generate-summary')
  @ApiOperation({ summary: 'Generate the data summary snapshot (ACCESS requests, IN_REVIEW only, written once)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/dsr-requests/:requestNo/generate-summary'))
  generateSummary(@Param('requestNo') requestNo: string, @Req() req: any) {
    this.assertAdmin(req);
    return this.dsr.generateSummary(this.buildActor(req), requestNo);
  }

  @Post(':requestNo/resolve')
  @ApiOperation({ summary: 'Resolve a data subject request (IN_REVIEW → RESOLVED) with a resolution code and reply' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/dsr-requests/:requestNo/resolve'))
  resolve(@Param('requestNo') requestNo: string, @Body() dto: ResolveDsrBodyDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.dsr.resolve(this.buildActor(req), requestNo, dto);
  }

  // ⚡ 演示装置：挂 DEMO_CLOCK_WRITE（金库），非 DSR_WRITE——同 complaints.controller.ts simulate-timeout 路由注释。
  @Post(':requestNo/simulate-timeout')
  @ApiOperation({ summary: 'Fast-forward a request deadline into the past (demo only)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/dsr-requests/:requestNo/simulate-timeout'))
  simulateTimeout(@Param('requestNo') requestNo: string, @Req() req: any) {
    this.assertAdmin(req);
    return this.dsr.simulateTimeout(this.buildActor(req), requestNo);
  }
}

// 战役丙波三 T9 · 客户协议管理台四端点。薄壳：列表/详情转调 AgreementsReadService，提交发布/⚡快进
// 转调 AgreementPublishWorkflowService——校验（30 天预检、仅 DRAFT 可提交、仅 PUBLISHED 可快进）与
// 状态边全在服务层，本控制器不加业务规则。guard / actor 取法逐处照抄 compliance-office.controller.ts。
//
// - 权限四条登记在 rbac.catalog.ts：两条读 → COMPLIANCE_OFFICE_VIEW；提交发布 → AGREEMENT_WRITE（合规官独占）；
//   ⚡快进 → DEMO_CLOCK_WRITE（金库的拨钟组，非 AGREEMENT_WRITE——合规官不是自己的裁决人，快进是演示者操作，
//   同 obligations/报送单⚡先例；合规官看得见页面点不动 ⚡，RBAC 交叉是产物非缺陷，spec §3）。
// - 正文只读：版本正文住代码登记处（agreement-versions.constant.ts），管理台没有任何写正文的端点。
// - 响应一律显式白名单取键，不 spread 版本行：id / createdAt / updatedAt 等内部列不外漏。
import { Body, Controller, ForbiddenException, Get, Param, Post, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { AdminPermissionGuard } from '../access-control/admin-permission.guard';
import { buildPermissionCode } from '../access-control/permission-code.util';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { AgreementPublishWorkflowService } from './agreement-publish-workflow.service';
import { AgreementsReadService, AgreementVersionView } from './agreements-read.service';

export class SubmitPublishBodyDto {
  @ApiProperty({ description: 'ISO date-time; must be at least 30 days from now (VARA Market Conduct II.A.7 notice period)' })
  @IsString()
  @IsNotEmpty()
  effectiveAt!: string;
}

/** 列表项：不带正文，只有这六键。 */
function toListItem(v: AgreementVersionView) {
  return {
    versionKey: v.versionKey,
    status: v.status,
    summary: v.summary,
    effectiveAt: v.effectiveAt,
    publishedAt: v.publishedAt,
    pendingApprovalNo: v.pendingApprovalNo,
  };
}

@ApiTags('Admin - Customer Agreements')
@ApiBearerAuth()
@Controller('admin/customer-agreements')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class AgreementsAdminController {
  constructor(
    private readonly agreements: AgreementsReadService,
    private readonly publishWorkflow: AgreementPublishWorkflowService,
  ) {}

  /** 同 compliance-office.controller.ts：整个 actor 往下传。 */
  private buildActor(req: any): ApprovalActorContext {
    const user = req.user;
    return { actorType: 'ADMIN', userId: user.userId || user.sub, userNo: user.userNo, role: user.role, roleCodes: user.roleCodes || (user.role ? [user.role] : []) };
  }

  /** AdminPermissionGuard 对非 ADMIN token 是 NO-OP，写动作补一道类型判断（必须早于任何读写）。 */
  private assertAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin only');
    }
  }

  @Get()
  @ApiOperation({ summary: 'List customer agreement versions' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/customer-agreements'))
  async list() {
    return (await this.agreements.listVersions()).map(toListItem);
  }

  @Get(':versionKey')
  @ApiOperation({ summary: 'Customer agreement version detail (read-only body)' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/customer-agreements/:versionKey'))
  async detail(@Param('versionKey') versionKey: string) {
    const view = await this.agreements.getVersionView(versionKey);
    return { ...toListItem(view), sections: view.sections };
  }

  @Post(':versionKey/submit-publish')
  @ApiOperation({ summary: 'Submit an agreement version for publication (senior management approves; effective date >= +30d)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/customer-agreements/:versionKey/submit-publish'))
  async submitPublish(@Param('versionKey') versionKey: string, @Body() dto: SubmitPublishBodyDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.publishWorkflow.submitPublish(versionKey, dto.effectiveAt, this.buildActor(req));
  }

  // ⚡ 演示装置（spec §3）：权限挂 DEMO_CLOCK_WRITE，见文件头。
  @Post(':versionKey/simulate-effective')
  @ApiOperation({ summary: 'Fast-forward an announced agreement version to effective (demo only)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/customer-agreements/:versionKey/simulate-effective'))
  async simulateEffective(@Param('versionKey') versionKey: string, @Req() req: any) {
    this.assertAdmin(req);
    return this.publishWorkflow.simulateEffective(versionKey, this.buildActor(req));
  }
}

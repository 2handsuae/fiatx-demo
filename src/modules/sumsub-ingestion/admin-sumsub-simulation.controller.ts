// admin-sumsub-simulation.controller.ts
import { Controller, Post, Body, ForbiddenException, NotFoundException, BadRequestException, ConflictException, UseGuards, Req, Inject } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SumsubIngestionService } from './sumsub-ingestion.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { MaterialRequestsService } from '../identity/material-requests/material-requests.service';
import { AdminPermissionGuard } from '../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../identity/access-control/permission-code.util';
import { CustomerRestrictionWorkflowService } from '../identity/customers/customer-restriction-workflow.service';
import { CustomerRestrictionsService } from '../identity/customers/customer-restrictions.service';
import { ApprovalActorContext } from '../governance/approvals/constants/approval.constants';

@ApiTags('Admin - Sumsub Simulation')
@Controller('admin/sumsub/simulate')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class AdminSumsubSimulationController {
  constructor(
    private readonly ingestionService: SumsubIngestionService,
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly materialRequests: MaterialRequestsService,
    // 战役甲波三 T7：EOCN 存量命中 —— 不走 ingestionService.ingest()（那条链的落地
    // 留痕搭在 KYT 审计上，⚡ 场景无 KYT 单可搭，评审黄项订正），直接调客户域
    // workflow 正门，自带 CUSTOMER_RESTRICTION_ADDED/CUSTOMER_FROZEN 审计。
    private readonly restrictionWorkflow: CustomerRestrictionWorkflowService,
    private readonly restrictions: CustomerRestrictionsService,
  ) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
  }

  @Post('applicant-action-result')
  @ApiOperation({ summary: '模拟 applicantActionReviewed —— 后台三个裁决按钮打这里' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/sumsub/simulate/applicant-action-result'))
  async simulateApplicantActionResult(
    @Req() req: any,
    @Body() body: {
      requestNo: string;
      reviewAnswer: 'GREEN' | 'RED';
      reviewRejectType?: 'RETRY' | 'FINAL';
    },
  ) {
    this.ensureAdmin(req);
    if (!body.requestNo) throw new BadRequestException('requestNo is required');
    if (body.reviewAnswer === 'RED' && !body.reviewRejectType) {
      // 不许默默当成 FINAL 把单关掉，也不许默默当成 RETRY 让运营永远关不了单 ——
      // 树上两条旧路各犯了其中一个，本轮统一（设计稿 §2.2）。
      throw new BadRequestException("RED must carry reviewRejectType 'RETRY' or 'FINAL'");
    }

    const request = await this.materialRequests.findByNo(body.requestNo);
    if (!request) throw new NotFoundException(`Material request not found: ${body.requestNo}`);

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: request.customerId },
      select: { sumsubApplicantId: true },
    });

    return this.ingestionService.ingest(
      {
        type: 'applicantActionReviewed',
        applicantId: customer?.sumsubApplicantId,
        actionId: request.applicantActionId,
        externalActionId: request.externalActionId,
        reviewResult: {
          reviewAnswer: body.reviewAnswer,
          reviewRejectType: body.reviewRejectType,
        },
        createdAtMs: String(Date.now()),
      },
      { isSimulated: true, simulatedByUserId: 'ADMIN_SIMULATION' },
    );
  }

  @Post('onboarding-review-result')
  @ApiOperation({ summary: '模拟 applicantReviewed —— 入驻 ⚡ 三个裁决按钮打这里' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/sumsub/simulate/onboarding-review-result'))
  async simulateOnboardingReviewResult(
    @Req() req: any,
    @Body() body: { customerNo: string; reviewAnswer: 'GREEN' | 'RED'; reviewRejectType?: 'RETRY' | 'FINAL' },
  ) {
    this.ensureAdmin(req);
    if (!body.customerNo) throw new BadRequestException('customerNo is required');
    if (body.reviewAnswer === 'RED' && !body.reviewRejectType) {
      // 照 applicant-action-result 判例：不许默默当 FINAL 或 RETRY
      throw new BadRequestException("RED must carry reviewRejectType 'RETRY' or 'FINAL'");
    }
    const customer = await this.prisma.customerMain.findUnique({
      where: { customerNo: body.customerNo },
      select: { sumsubApplicantId: true },
    });
    if (!customer?.sumsubApplicantId) {
      throw new NotFoundException(`Customer has no Sumsub applicant: ${body.customerNo}`);
    }
    return this.ingestionService.ingest(
      {
        type: 'applicantReviewed',
        applicantId: customer.sumsubApplicantId,
        reviewResult: { reviewAnswer: body.reviewAnswer, reviewRejectType: body.reviewRejectType },
        createdAtMs: String(Date.now()),
      },
      { isSimulated: true, simulatedByUserId: 'ADMIN_SIMULATION' },
    );
  }

  @Post('tier-upgrade-review-result')
  @ApiOperation({ summary: '模拟 applicantReviewed —— 档位升级 ⚡ 三个裁决按钮打这里' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/sumsub/simulate/tier-upgrade-review-result'))
  async simulateTierUpgradeReviewResult(
    @Req() req: any,
    @Body() body: { customerNo: string; reviewAnswer: 'GREEN' | 'RED'; reviewRejectType?: 'RETRY' | 'FINAL' },
  ) {
    this.ensureAdmin(req);
    if (!body.customerNo) throw new BadRequestException('customerNo is required');
    if (body.reviewAnswer === 'RED' && !body.reviewRejectType) {
      // 照 applicant-action-result 判例：不许默默当 FINAL 或 RETRY
      throw new BadRequestException("RED must carry reviewRejectType 'RETRY' or 'FINAL'");
    }
    const customer = await this.prisma.customerMain.findUnique({
      where: { customerNo: body.customerNo },
      select: { sumsubApplicantId: true },
    });
    if (!customer?.sumsubApplicantId) {
      throw new NotFoundException(`Customer has no Sumsub applicant: ${body.customerNo}`);
    }
    const application = await this.prisma.tierUpgradeApplication.findFirst({
      where: { customer: { customerNo: body.customerNo }, status: 'IN_REVIEW' },
    });
    if (!application) {
      throw new NotFoundException(`No tier-upgrade application in review for ${body.customerNo}`);
    }
    return this.ingestionService.ingest(
      {
        type: 'applicantReviewed',
        applicantId: customer.sumsubApplicantId,
        reviewResult: { reviewAnswer: body.reviewAnswer, reviewRejectType: body.reviewRejectType },
        createdAtMs: String(Date.now()),
      },
      { isSimulated: true, simulatedByUserId: 'ADMIN_SIMULATION', context: 'TIER_UPGRADE' },
    );
  }

  @Post('onboarding-level-change')
  @ApiOperation({ summary: '模拟 applicantLevelChanged —— CDD 提交后升 EDD' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/sumsub/simulate/onboarding-level-change'))
  async simulateOnboardingLevelChange(@Req() req: any, @Body() body: { customerNo: string }) {
    this.ensureAdmin(req);
    if (!body.customerNo) throw new BadRequestException('customerNo is required');
    const customer = await this.prisma.customerMain.findUnique({
      where: { customerNo: body.customerNo },
      select: { sumsubApplicantId: true },
    });
    if (!customer?.sumsubApplicantId) {
      throw new NotFoundException(`Customer has no Sumsub applicant: ${body.customerNo}`);
    }
    return this.ingestionService.ingest(
      { type: 'applicantLevelChanged', applicantId: customer.sumsubApplicantId, levelName: 'edd-sof-sow-level', createdAtMs: String(Date.now()) },
      { isSimulated: true, simulatedByUserId: 'ADMIN_SIMULATION' },
    );
  }

  /**
   * 战役甲波三 T7：模拟 EOCN 名单更新命中一名存量 ACTIVE 客户 —— 贴 SANCTION 便签。
   * 语义站在 Sumsub 那一侧的持续监控/复筛（ongoing AML monitoring 对已入驻申请人
   * 重新过新名单），不是充值/提现/兑换某笔订单的 KYT 裁决，故不喂 ingestionService.
   * ingest()：那条链的落地留痕搭在具体订单的 KYT 审计上（DEPOSIT_FROZEN 等），
   * ⚡ 场景没有订单可搭。改为直接调 CustomerRestrictionWorkflowService.openRestriction()
   * ——workflow 正门自带 CUSTOMER_RESTRICTION_ADDED / CUSTOMER_FROZEN 审计，且把
   * 真实点击 ⚡ 按钮的 admin 记成 actor（比系统内部 actor 更强的留痕）。
   *
   * 两道业务闸（评审口径明确要求报错，不是 open() 自带的静默幂等）：
   *  - 客户须 ACTIVE 生命周期——非存量客户不适用这条模拟命中；
   *  - 客户不得已有 OPEN 的 SANCTION 便签——重复命中要显式拒绝，让演示者看见
   *    "先走完一轮定性再打下一次 ⚡"，而不是被 open() 的幂等悄悄吞掉。
   */
  @Post('eocn-sanctions-hit')
  @ApiOperation({ summary: '模拟 EOCN 名单更新命中存量 ACTIVE 客户 —— 贴 SANCTION 便签（demo only）' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/sumsub/simulate/eocn-sanctions-hit'))
  async simulateEocnSanctionsHit(
    @Req() req: any,
    @Body() body: { customerNo: string; listRef: string },
  ) {
    this.ensureAdmin(req);
    if (!body.customerNo) throw new BadRequestException('customerNo is required');
    if (!body.listRef?.trim()) throw new BadRequestException('listRef is required');

    const customer = await this.prisma.customerMain.findFirst({
      where: { customerNo: body.customerNo },
      select: { id: true, lifecycle: true },
    });
    if (!customer) throw new NotFoundException(`Customer not found: ${body.customerNo}`);
    if (customer.lifecycle !== 'ACTIVE') {
      throw new BadRequestException(
        `Customer ${body.customerNo} is not ACTIVE (lifecycle=${customer.lifecycle}) — EOCN hit simulation only applies to an existing active customer`,
      );
    }

    const existing = await this.restrictions.findOpenByCause(customer.id, 'SANCTION', null);
    if (existing) {
      throw new ConflictException(
        `Customer ${body.customerNo} already has an OPEN SANCTION restriction (${existing.restrictionNo}) — resolve it via sanction disposition before simulating another EOCN hit`,
      );
    }

    const actor: ApprovalActorContext = {
      actorType: 'ADMIN',
      userId: req.user.userId || req.user.sub,
      userNo: req.user.userNo,
      role: req.user.role,
      roleCodes: req.user.roleCodes || (req.user.role ? [req.user.role] : []),
    };

    const { restrictionNo, created } = await this.restrictionWorkflow.openRestriction(
      {
        customerId: customer.id,
        cause: 'SANCTION',
        reason: `EOCN sanctions list update (simulated): existing ACTIVE customer hit against list entry ${body.listRef}`,
        // caseRef 传了也会被 open() 按 R4 归一成 customerNo（SANCTION 是 customerLevel
        // 因由）；listRef 的可追溯性由 reason 承载,供后续定性开单时人工抄作 externalCaseRef。
        caseRef: body.listRef,
        openedBy: actor.userNo ?? actor.userId,
      },
      actor,
    );

    return {
      restrictionNo,
      created,
      customerNo: body.customerNo,
      cause: 'SANCTION' as const,
      listRef: body.listRef,
    };
  }

  // withdraw-kyt/withdraw-tr endpoints retired with the old preKyt/travelRule mock
  // pipeline (Task 5 — real Sumsub single-txn submit + applyKytVerdict replaces it;
  // see WithdrawWorkflowService). Frontend cleanup (SumsubEventsPage kyt/travelRule
  // simulate buttons) already done — removed as dead 404 buttons.
}

import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../identity/access-control/admin-permission.guard';
import { DemoScenarioControllerBase } from '../sumsub-shared/demo-scenario.base';
import { DepositDemoScenarioService } from './demo-scenario.service';
import { DEPOSIT_VERDICT_BUTTONS } from './fixtures/verdict-buttons';
import { DepositWorkflowService } from '../trading/deposit-transactions/deposit-workflow.service';
import { ApprovalActorContext } from '../governance/approvals/constants/approval.constants';
import { FeedAttributionDto } from './dto/feed-attribution.dto';

/**
 * Task 6(计划1 甲方案)起步,Task 4(计划「充值仿真裁决按钮」)改单步:Sumsub sandbox
 * 演不出制裁命中/PEP/慢 case,demo 靠 fixture 一键把一次 Sumsub 裁决 webhook 喂给
 * 某个 deposit——状态去哪由现有 handler/workflow 决定,operator 自由串联多个按钮。
 *
 * 三道安全闸之一:本 controller 只在 SUMSUB_MOCK_MODE=true 时才被
 * DepositSumsubModule 注册(见 deposit-sumsub.module.ts 的条件 `controllers` 数组)——
 * 生产环境下这个路由压根不存在,不是靠 guard 拦。
 *
 * run-verdict / verdict-buttons 两个路由的方法体收进 DemoScenarioControllerBase
 * (与提现域逐字一致,见该基类注释);本类只留路由前缀 / 权限守卫 / 域专属字段。
 */
@ApiTags('Admin - Deposit Demo Scenarios')
@ApiBearerAuth()
@Controller('admin/deposit-sumsub/demo')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class AdminDepositDemoController extends DemoScenarioControllerBase {
  protected readonly idField = 'depositId';
  protected readonly verdictButtons = DEPOSIT_VERDICT_BUTTONS;

  constructor(
    protected readonly demoScenarioService: DepositDemoScenarioService,
    private readonly depositWorkflow: DepositWorkflowService,
  ) {
    super();
  }

  /**
   * 对手方波二：⚡喂来源归因（站在 Sumsub 一侧告知对手方是谁）。与 run-verdict 同属"喂 Sumsub 侧结论"，
   * 同挂 DEMO_VERDICT_WRITE（rbac.catalog 登记）。controller 只做传输，守卫与业务全在 workflow。
   */
  @Post('feed-attribution')
  @ApiOperation({ summary: 'Feed the counterparty source attribution (VASP / unhosted) into a deposit (demo only)' })
  async feedAttribution(@Body() dto: FeedAttributionDto, @Req() req: any) {
    const actor: ApprovalActorContext = {
      actorType: 'ADMIN',
      userId: req.user?.userId,
      userNo: req.user?.userNo,
      role: req.user?.role,
      roleCodes: req.user?.roleCodes || (req.user?.role ? [req.user.role] : []),
    };
    return this.depositWorkflow.applySourceAttribution(
      dto.depositNo,
      { attribution: dto.attribution, vasp: dto.vasp },
      actor,
    );
  }
}

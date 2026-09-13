import { Controller, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../identity/access-control/admin-permission.guard';
import { DemoScenarioControllerBase } from '../sumsub-shared/demo-scenario.base';
import { WithdrawDemoScenarioService } from './demo-scenario.service';
import { WITHDRAW_VERDICT_BUTTONS } from './fixtures/verdict-buttons';

/**
 * Task 10, mirror of AdminDepositDemoController(deliberate fork): Sumsub sandbox
 * 演不出制裁命中/PEP/慢 case,demo 靠 fixture 一键把一次 Sumsub 裁决 webhook 喂给
 * 某个 withdrawal——状态去哪由现有 handler/workflow 决定,operator 自由串联多个按钮。
 *
 * 安全闸同充值版:本 controller 只在 SUMSUB_MOCK_MODE=true 时才被
 * WithdrawSumsubModule 注册(见 withdraw-sumsub.module.ts 的条件 `controllers` 数组)——
 * 生产环境下这个路由压根不存在,不是靠 guard 拦。
 *
 * run-verdict / verdict-buttons 两个路由的方法体收进 DemoScenarioControllerBase
 * (与充值域逐字一致,见该基类注释);本类只留路由前缀 / 权限守卫 / 域专属字段。
 */
@ApiTags('Admin - Withdraw Demo Scenarios')
@ApiBearerAuth()
@Controller('admin/withdraw-sumsub/demo')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class AdminWithdrawDemoController extends DemoScenarioControllerBase {
  protected readonly idField = 'withdrawId';
  protected readonly verdictButtons = WITHDRAW_VERDICT_BUTTONS;

  constructor(protected readonly demoScenarioService: WithdrawDemoScenarioService) {
    super();
  }
}

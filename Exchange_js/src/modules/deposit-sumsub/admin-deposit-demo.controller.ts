import { Controller, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../identity/access-control/admin-permission.guard';
import { DemoScenarioControllerBase } from '../sumsub-shared/demo-scenario.base';
import { DepositDemoScenarioService } from './demo-scenario.service';
import { DEPOSIT_VERDICT_BUTTONS } from './fixtures/verdict-buttons';

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

  constructor(protected readonly demoScenarioService: DepositDemoScenarioService) {
    super();
  }
}

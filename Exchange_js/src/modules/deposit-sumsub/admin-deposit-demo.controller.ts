import { BadRequestException, Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../identity/access-control/admin-permission.guard';
import { DepositDemoScenarioService } from './demo-scenario.service';

/**
 * Task 6(计划1 甲方案):Sumsub sandbox 演不出制裁命中/PEP/慢 case,demo 靠 fixture 一键
 * 把某个 deposit 沿指定剧本喂到目标状态。
 *
 * 三道安全闸之一:本 controller 只在 SUMSUB_MOCK_MODE=true 时才被
 * DepositSumsubModule 注册(见 deposit-sumsub.module.ts 的条件 `controllers` 数组)——
 * 生产环境下这个路由压根不存在,不是靠 guard 拦。
 */
@ApiTags('Admin - Deposit Demo Scenarios')
@ApiBearerAuth()
@Controller('admin/deposit-sumsub/demo')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class AdminDepositDemoController {
  constructor(private readonly demoScenarioService: DepositDemoScenarioService) {}

  @Post('run-scenario')
  @ApiOperation({ summary: 'Feed a deposit through a Sumsub mock scenario fixture (demo only)' })
  async runScenario(
    @Body() body: { depositId?: string; scenario?: string },
    @Req() req: any,
  ) {
    if (!body?.depositId) throw new BadRequestException('depositId is required');
    if (!body?.scenario) throw new BadRequestException('scenario is required');

    const actor = {
      actorId: req.user?.userId,
      actorNo: req.user?.userNo,
      actorRole: req.user?.role,
    };
    return this.demoScenarioService.runScenario(body.depositId, body.scenario, actor);
  }
}

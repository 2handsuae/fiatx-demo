import { BadRequestException, Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../identity/access-control/admin-permission.guard';
import { SwapDemoScenarioService } from './demo-scenario.service';

/**
 * Task 9, mirror of AdminDepositDemoController / AdminWithdrawDemoController
 * (deliberate fork): Sumsub sandbox 演不出制裁命中/PEP/慢 case,demo 靠 fixture
 * 一键把一次 Sumsub 裁决 webhook 喂给某笔兑换单——状态去哪由现有
 * handler/workflow 决定,operator 自由串联多个按钮。
 *
 * 安全闸同充值/提现版:本 controller 只在 SUMSUB_MOCK_MODE=true 时才被
 * SwapSumsubModule 注册(见 swap-sumsub.module.ts 的条件 `controllers` 数组)——
 * 生产环境下这个路由压根不存在,不是靠 guard 拦。
 */
@ApiTags('Admin - Swap Demo Scenarios')
@ApiBearerAuth()
@Controller('admin/swap-sumsub/demo')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class AdminSwapDemoController {
  constructor(private readonly demoScenarioService: SwapDemoScenarioService) {}

  @Post('run-verdict')
  @ApiOperation({ summary: 'Feed one Sumsub KYT verdict webhook into this swap (demo only)' })
  async runVerdict(
    @Body() body: { swapId?: string; verdict?: string },
    @Req() req: any,
  ) {
    if (!body?.swapId) throw new BadRequestException('swapId is required');
    if (!body?.verdict) throw new BadRequestException('verdict is required');

    const actor = {
      actorId: req.user?.userId,
      actorNo: req.user?.userNo,
      actorRole: req.user?.role,
    };
    return this.demoScenarioService.runVerdict(body.swapId, body.verdict, actor);
  }
}

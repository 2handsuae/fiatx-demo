import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../identity/access-control/admin-permission.guard';
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
 */
@ApiTags('Admin - Withdraw Demo Scenarios')
@ApiBearerAuth()
@Controller('admin/withdraw-sumsub/demo')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class AdminWithdrawDemoController {
  constructor(private readonly demoScenarioService: WithdrawDemoScenarioService) {}

  @Post('run-verdict')
  @ApiOperation({ summary: 'Feed one Sumsub KYT verdict webhook into this withdrawal (demo only)' })
  async runVerdict(
    @Body() body: { withdrawId?: string; verdict?: string },
    @Req() req: any,
  ) {
    if (!body?.withdrawId) throw new BadRequestException('withdrawId is required');
    if (!body?.verdict) throw new BadRequestException('verdict is required');

    const actor = {
      actorId: req.user?.userId,
      actorNo: req.user?.userNo,
      actorRole: req.user?.role,
    };
    return this.demoScenarioService.runVerdict(body.withdrawId, body.verdict, actor);
  }

  @Get('verdict-buttons')
  @ApiOperation({ summary: '列出本域可用的裁决按钮（demo only）—— 前端据此渲染 ⚡ 面板' })
  listVerdictButtons(@Req() req: any) {
    return {
      buttons: Object.values(WITHDRAW_VERDICT_BUTTONS).map((b) => ({
        key: b.key, label: b.label, source: b.source,
      })),
    };
  }
}

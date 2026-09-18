import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DemoOpsService } from './demo-ops.service';

/**
 * 云端演示自助还原（spec 2026-09-13-cloud-demo-ops-buttons-design.md）。
 * 门控在模块层：DEMO_OPS=1（仅云端 demo.env 写入）才注册本 controller——
 * 本地路由压根不存在，前端探测 404 即隐藏入口，与 SUMSUB_MOCK_MODE 门同款。
 * 权限口径（spec §3 勘误）：舞台机械不进 RBAC catalog——POST 仅要求登录
 * （同事 Quick Login 任意角色都能按），status 免登录（重铺重建用户表、
 * 旧 token 失效，轮询必须跨越登录态）。
 */
@ApiTags('Demo Ops')
@Controller('demo-ops')
export class DemoOpsController {
  constructor(private readonly demoOps: DemoOpsService) {}

  @Get('status')
  @ApiOperation({ summary: 'Boot/reseed status + recon-break child state (unauthenticated by design)' })
  status() {
    return this.demoOps.readStatus();
  }

  @Post('reset')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Full re-seed: exit the process, systemd restarts and lays fresh demo data' })
  reset() {
    return this.demoOps.requestReset();
  }

  @Post('recon-break')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Restore the 18 reconciliation break scenarios (recon:demo:break)' })
  reconBreak() {
    return this.demoOps.startReconBreak();
  }
}

import { Module } from '@nestjs/common';
import { DemoOpsService } from './demo-ops.service';
import { DemoOpsController } from './demo-ops.controller';

// 与 DepositDemoModule 的 SUMSUB_MOCK_MODE 门同款：DEMO_OPS=1（仅云端 demo.env 写入）
// 才把 controller 放进路由表——本地路由压根不存在，不是靠 guard 拦。
// （main.ts 顶部的 dotenv 前置加载保证装饰器求值时 .env 已生效，同 SUMSUB_MOCK_MODE。）
const DEMO_OPS_ENABLED = process.env.DEMO_OPS === '1';

@Module({
  providers: [DemoOpsService],
  controllers: DEMO_OPS_ENABLED ? [DemoOpsController] : [],
})
export class DemoOpsModule {}

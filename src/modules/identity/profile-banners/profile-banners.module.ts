import { Module } from '@nestjs/common';
import { ProfileBannerService } from './profile-banners.service';
import { ProfileBannerController } from './profile-banners.controller';
import { CustomersModule } from '../customers/customers.module';
import { MaterialRequestsModule } from '../material-requests/material-requests.module';

@Module({
  // CustomersModule 为 CustomerAccessService。MaterialRequestsModule 为
  // MaterialRequestsService（2026-08-17 起横幅的材料请求数据源）。本模块不被
  // 二者依赖，无环，无需 forwardRef。PrismaService 走 @Global 的 PrismaModule。
  imports: [CustomersModule, MaterialRequestsModule],
  providers: [ProfileBannerService],
  controllers: [ProfileBannerController],
  exports: [ProfileBannerService],
})
export class ProfileBannersModule {}

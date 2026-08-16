import { Module } from '@nestjs/common';
import { ProfileBannerService } from './profile-banners.service';
import { ProfileBannerController } from './profile-banners.controller';
import { CustomersModule } from '../customers/customers.module';

@Module({
  // CustomersModule 为 CustomerAccessService。本模块不被 Customers 依赖，无环，
  // 无需 forwardRef。PrismaService 走 @Global 的 PrismaModule。
  imports: [CustomersModule],
  providers: [ProfileBannerService],
  controllers: [ProfileBannerController],
  exports: [ProfileBannerService],
})
export class ProfileBannersModule {}

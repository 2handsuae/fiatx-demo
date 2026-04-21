import { Module } from '@nestjs/common';
import { ProfileBannerService } from './profile-banners.service';
import { ProfileBannerController } from './profile-banners.controller';

@Module({
  providers: [ProfileBannerService],
  controllers: [ProfileBannerController],
  exports: [ProfileBannerService],
})
export class ProfileBannersModule {}

import {
  Controller,
  Get,
  Req,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ProfileBannerService } from './profile-banners.service';

@ApiTags('Customer - Profile Banners')
@Controller('customers/me/profile-banners')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class ProfileBannerController {
  constructor(private readonly service: ProfileBannerService) {}

  @Get()
  async getBanners(@Req() req: any) {
    if (req.user?.type !== 'CUSTOMER') {
      throw new ForbiddenException('Customer token required');
    }
    const banners = await this.service.getBannersFor(req.user.userId);
    return { banners };
  }
}

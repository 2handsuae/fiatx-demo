import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../access-control/admin-permission.guard';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { buildPermissionCode } from '../access-control/permission-code.util';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { OnboardingService } from './onboarding.service';
import {
  UpdateInvestorTierDto,
} from './dto/onboarding.dto';

@ApiTags('Admin - Onboarding')
@Controller('admin/compliance')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class OnboardingAdminController {
  constructor(
    private readonly onboardingService: OnboardingService,
  ) {}

  private getAdminActor(req: any) {
    if (req.user?.type === 'CUSTOMER') {
      throw new ForbiddenException('Admin token required');
    }
    return {
      actorId: req.user?.userId || 'ADMIN_SYSTEM',
      actorRole: req.user?.role || 'ADMIN',
    };
  }

  private parseCustomerIds(raw?: string): string[] | undefined {
    if (!raw) return undefined;
    const values = raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return values.length > 0 ? values : undefined;
  }

  @Post('customers/:id/simulate-expired')
  @ApiOperation({ summary: 'Simulate CDD document expiry and recompute compliance snapshot' })
  simulateExpired(@Req() req: any, @Param('id') id: string) {
    const actor = this.getAdminActor(req);
    return this.onboardingService.simulateCustomerExpired(id, actor.actorId, actor.actorRole);
  }

  @Patch('customers/:id/investor-tier')
  @ApiOperation({ summary: 'Override investor tier with audit reason' })
  updateInvestorTier(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: UpdateInvestorTierDto,
  ) {
    const actor = this.getAdminActor(req);
    return this.onboardingService.updateInvestorTier(
      id,
      actor.actorId,
      actor.actorRole,
      body,
    );
  }
}

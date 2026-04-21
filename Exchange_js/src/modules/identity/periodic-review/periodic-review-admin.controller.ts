import {
  Body,
  Controller,
  ForbiddenException,
  Param,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../access-control/admin-permission.guard';
import { PeriodicReviewService } from './periodic-review.service';
import {
  SubmitFinalApprovalDto,
} from '../onboarding/dto/onboarding.dto';

@ApiTags('Admin - Periodic Review')
@Controller('admin/compliance')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class PeriodicReviewAdminController {
  constructor(private readonly periodicReviewService: PeriodicReviewService) {}

  private getAdminActor(req: any) {
    if (req.user?.type === 'CUSTOMER') {
      throw new ForbiddenException('Admin token required');
    }
    return {
      actorId: req.user?.userId || 'ADMIN_SYSTEM',
      actorRole: req.user?.role || 'ADMIN',
    };
  }

  @Post('customers/:id/periodic-review/trigger')
  @ApiOperation({ summary: 'Trigger periodic review cycle for approved active customer' })
  triggerPeriodicReview(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: SubmitFinalApprovalDto,
  ) {
    const actor = this.getAdminActor(req);
    return this.periodicReviewService.triggerPeriodicReview(
      id,
      actor.actorId,
      actor.actorRole,
      body.reason,
    );
  }

}

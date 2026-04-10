// client-risk-assessment.controller.ts
import { Controller, Post, Param, Body, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ClientRiskAssessmentService } from './client-risk-assessment.service';

@ApiTags('Admin - Client Risk Assessment')
@Controller('admin/compliance/customers/:customerId/risk-assessment')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class ClientRiskAssessmentController {
  constructor(private readonly service: ClientRiskAssessmentService) {}

  @Post('trigger')
  async triggerManual(
    @Param('customerId') customerId: string,
    @Body() body: { reason?: string },
    @Req() req: any,
  ) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
    return this.service.startAssessment({
      customerId,
      triggerType: 'MLRO_MANUAL',
      triggeredBy: req.user.userId,
      triggeredContext: { reason: body.reason },
    });
  }
}

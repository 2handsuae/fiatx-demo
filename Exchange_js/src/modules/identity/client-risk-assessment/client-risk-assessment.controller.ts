// client-risk-assessment.controller.ts
import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  Req,
  Inject,
  UseGuards,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ClientRiskAssessmentService } from './client-risk-assessment.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

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

/* ── List / Detail controller (flat path) ─────────────────────── */

@ApiTags('Admin - Risk Assessments')
@Controller('admin/compliance/risk-assessments')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class RiskAssessmentAdminController {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
  ) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') throw new ForbiddenException('Admin token required');
  }

  @Get()
  @ApiOperation({ summary: 'List risk assessments' })
  async list(@Req() req: any, @Query() query: any) {
    this.ensureAdmin(req);
    const skip = Math.max(0, Number(query.skip) || 0);
    const take = Math.min(200, Math.max(1, Number(query.take) || 20));
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.triggerType) where.triggerType = query.triggerType;
    if (query.customerId) where.customerId = query.customerId;

    const [items, total] = await Promise.all([
      this.prisma.clientRiskAssessment.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { customerNo: true, email: true, riskRating: true } },
        },
      }),
      this.prisma.clientRiskAssessment.count({ where }),
    ]);
    return { items, total, skip, take };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get risk assessment detail' })
  async getDetail(@Req() req: any, @Param('id') id: string) {
    this.ensureAdmin(req);
    const assessment = await this.prisma.clientRiskAssessment.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            customerNo: true,
            email: true,
            riskRating: true,
            sumsubCurrentLevelName: true,
            adminStatus: true,
          },
        },
      },
    });
    if (!assessment) throw new NotFoundException('Assessment not found');
    return assessment;
  }
}

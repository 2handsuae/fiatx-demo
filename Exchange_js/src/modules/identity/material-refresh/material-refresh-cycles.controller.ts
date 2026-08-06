// material-refresh-cycles.controller.ts
import {
  Controller,
  Get,
  Post,
  Param,
  Req,
  UseGuards,
  ForbiddenException,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SumsubClient } from '../onboarding/providers/sumsub/sumsub.client';

@ApiTags('Customer - Material Refresh')
@Controller('onboarding/refresh-cycles')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class MaterialRefreshCyclesController {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly sumsubClient: SumsubClient,
  ) {}

  @Get(':cycleId')
  async getCycle(@Param('cycleId') cycleId: string, @Req() req: any) {
    const customerId = this.ensureCustomer(req);
    const cycle = await this.prisma.materialRefreshCycle.findUnique({
      where: { id: cycleId },
    });
    if (!cycle) throw new NotFoundException('Cycle not found');
    if (cycle.customerId !== customerId) {
      throw new ForbiddenException('Not your cycle');
    }
    return {
      id: cycle.id,
      cycleNo: cycle.cycleNo,
      materialType: cycle.materialType,
      status: cycle.status,
      stage: cycle.stage,
      graceExpiresAt: cycle.graceExpiresAt,
      sumsubActionLevelName: cycle.sumsubActionLevelName,
      sumsubActionId: cycle.sumsubActionId,
    };
  }

  @Post(':cycleId/submit')
  async submitCycle(@Param('cycleId') cycleId: string, @Req() req: any) {
    const customerId = this.ensureCustomer(req);
    const cycle = await this.prisma.materialRefreshCycle.findUnique({
      where: { id: cycleId },
    });
    if (!cycle) throw new NotFoundException('Cycle not found');
    if (cycle.customerId !== customerId) {
      throw new ForbiddenException('Not your cycle');
    }
    if (cycle.status !== 'PENDING_CUSTOMER_EVIDENCE') {
      throw new ForbiddenException(`Cycle is ${cycle.status}, cannot submit`);
    }

    await this.prisma.materialRefreshCycle.update({
      where: { id: cycleId },
      data: {
        status: 'PENDING_SUMSUB_REVIEW',
        customerSubmittedAt: new Date(),
      },
    });

    return { ok: true, status: 'PENDING_SUMSUB_REVIEW' };
  }

  @Post(':cycleId/sdk-token')
  async getSdkToken(@Param('cycleId') cycleId: string, @Req() req: any) {
    const customerId = this.ensureCustomer(req);
    const cycle = await this.prisma.materialRefreshCycle.findUnique({
      where: { id: cycleId },
    });
    if (!cycle) throw new NotFoundException('Cycle not found');
    if (cycle.customerId !== customerId) {
      throw new ForbiddenException('Not your cycle');
    }
    if (cycle.status !== 'PENDING_CUSTOMER_EVIDENCE') {
      throw new ForbiddenException(`Cycle is ${cycle.status}`);
    }
    if (!cycle.sumsubActionLevelName) {
      throw new ForbiddenException('Sumsub action not yet created');
    }

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
    });
    if (!customer?.sumsubApplicantId) {
      throw new ForbiddenException('No Sumsub applicant');
    }
    if (customer.complianceStatus === 'FROZEN') {
      throw new ForbiddenException('Account is frozen');
    }

    const result = await this.sumsubClient.createActionSdkToken({
      applicantId: customer.sumsubApplicantId,
      levelName: cycle.sumsubActionLevelName,
      ttlInSecs: 600,
    });

    return {
      token: result.token,
      ttlSeconds: 600,
      levelName: cycle.sumsubActionLevelName,
      // For demo: include the mock actionId so frontend can show it in the QR / simulation UI
      mockActionId: cycle.sumsubActionId,
    };
  }

  private ensureCustomer(req: any): string {
    if (req.user?.type !== 'CUSTOMER') {
      throw new ForbiddenException('Customer token required');
    }
    return req.user.userId as string;
  }
}

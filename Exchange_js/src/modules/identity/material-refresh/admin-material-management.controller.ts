import {
  Controller, Get, Post, Param, Body, Query, Req,
  UseGuards, ForbiddenException, NotFoundException, Inject,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { MaterialRefreshService } from './material-refresh.service';

@ApiTags('Admin - Material Management')
@Controller('admin/material-management')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class AdminMaterialManagementController {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly materialRefreshService: MaterialRefreshService,
  ) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
  }

  @Get('cycles')
  @ApiOperation({ summary: 'List all material refresh cycles across customers' })
  async listCycles(
    @Req() req: any,
    @Query('customerId') customerId?: string,
    @Query('status') status?: string,
    @Query('materialType') materialType?: string,
    @Query('stage') stage?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    this.ensureAdmin(req);

    const where: any = {};
    if (customerId) where.customerId = customerId;
    if (status) where.status = status;
    if (materialType) where.materialType = materialType;
    if (stage) where.stage = stage;

    const [items, total] = await Promise.all([
      this.prisma.materialRefreshCycle.findMany({
        where,
        include: {
          customer: {
            select: { customerNo: true, email: true, riskRating: true },
          },
          holding: {
            select: { materialType: true, status: true, expiresAt: true },
          },
        },
        orderBy: [{ createdAt: 'desc' }],
        skip: parseInt(skip || '0', 10),
        take: Math.min(parseInt(take || '50', 10), 200),
      }),
      this.prisma.materialRefreshCycle.count({ where }),
    ]);

    return { items, total };
  }

  @Get('cycles/:id')
  @ApiOperation({ summary: 'Get refresh cycle detail' })
  async getCycleDetail(@Req() req: any, @Param('id') id: string) {
    this.ensureAdmin(req);

    const cycle = await this.prisma.materialRefreshCycle.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            customerNo: true,
            email: true,
            riskRating: true,
            complianceStatus: true,
            sumsubCurrentLevelName: true,
          },
        },
        holding: {
          select: {
            id: true,
            holdingNo: true,
            materialType: true,
            managementMode: true,
            status: true,
            expiresAt: true,
            verifiedAt: true,
          },
        },
      },
    });

    if (!cycle) throw new NotFoundException('Cycle not found');
    return cycle;
  }

  @Get('holdings')
  @ApiOperation({ summary: 'List all material holdings across customers' })
  async listHoldings(
    @Req() req: any,
    @Query('customerId') customerId?: string,
    @Query('status') status?: string,
    @Query('materialType') materialType?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    this.ensureAdmin(req);

    const where: any = {};
    if (customerId) where.customerId = customerId;
    if (status) where.status = status;
    if (materialType) where.materialType = materialType;

    const [items, total] = await Promise.all([
      this.prisma.customerMaterialHolding.findMany({
        where,
        include: {
          customer: {
            select: {
              customerNo: true,
              email: true,
              riskRating: true,
              sumsubCurrentLevelName: true,
            },
          },
          activeRefreshCycle: {
            select: {
              id: true,
              cycleNo: true,
              status: true,
              stage: true,
              graceExpiresAt: true,
            },
          },
        },
        orderBy: [{ expiresAt: 'asc' }],
        skip: parseInt(skip || '0', 10),
        take: Math.min(parseInt(take || '50', 10), 200),
      }),
      this.prisma.customerMaterialHolding.count({ where }),
    ]);

    return {
      items: items.map((h: any) => ({
        ...h,
        daysFromExpiry: h.expiresAt
          ? Math.floor((h.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
          : null,
      })),
      total,
    };
  }

  @Get('holdings/:id')
  @ApiOperation({ summary: 'Get material holding detail with refresh cycle history' })
  async getHoldingDetail(@Req() req: any, @Param('id') id: string) {
    this.ensureAdmin(req);

    const holding = await this.prisma.customerMaterialHolding.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            customerNo: true,
            email: true,
            riskRating: true,
            complianceStatus: true,
            sumsubCurrentLevelName: true,
          },
        },
        activeRefreshCycle: true,
        refreshCycles: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!holding) throw new NotFoundException('Holding not found');

    return {
      ...holding,
      daysFromExpiry: holding.expiresAt
        ? Math.floor((holding.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
        : null,
    };
  }

  @Post('holdings/:id/simulate-stage')
  @ApiOperation({
    summary: 'Simulate stage transition by adjusting expiresAt/graceExpiresAt and running the stage handler',
  })
  async simulateStage(
    @Req() req: any,
    @Param('id') holdingId: string,
    @Body() body: {
      targetStage: 'T_MINUS_30' | 'T_MINUS_7' | 'T_0' | 'T_PLUS_30' | 'GREEN' | 'RED';
    },
  ) {
    this.ensureAdmin(req);

    const holding = await this.prisma.customerMaterialHolding.findUnique({
      where: { id: holdingId },
    });
    if (!holding) throw new NotFoundException('Holding not found');

    const now = new Date();
    const DAY_MS = 24 * 60 * 60 * 1000;

    switch (body.targetStage) {
      case 'T_MINUS_30': {
        // Set expiresAt to now + 25 days (enters NOTIFIED zone)
        await this.prisma.customerMaterialHolding.update({
          where: { id: holdingId },
          data: { expiresAt: new Date(now.getTime() + 25 * DAY_MS), status: 'FRESH' },
        });
        await this.materialRefreshService.enterNotifiedStage(holdingId);
        return { ok: true, stage: 'NUDGE_ONLY', message: 'Holding moved to T-30 zone, cycle created' };
      }

      case 'T_MINUS_7': {
        // Set expiresAt to now + 5 days (enters URGENT zone)
        await this.prisma.customerMaterialHolding.update({
          where: { id: holdingId },
          data: { expiresAt: new Date(now.getTime() + 5 * DAY_MS) },
        });
        await this.materialRefreshService.escalateToUrgent(holdingId);
        return { ok: true, stage: 'URGENT', message: 'Holding moved to T-7 zone' };
      }

      case 'T_0': {
        // Set expiresAt to now - 1 day (enters BLOCKING zone)
        await this.prisma.customerMaterialHolding.update({
          where: { id: holdingId },
          data: { expiresAt: new Date(now.getTime() - 1 * DAY_MS) },
        });
        await this.materialRefreshService.enterBlockingStage(holdingId);
        return { ok: true, stage: 'BLOCKING', message: 'Holding expired, customer RESTRICTED' };
      }

      case 'T_PLUS_30': {
        // Find active cycle, set graceExpiresAt to past
        const cycle = await this.prisma.materialRefreshCycle.findFirst({
          where: { holdingId, status: 'PENDING_CUSTOMER_EVIDENCE' },
        });
        if (!cycle) {
          return { ok: false, message: 'No active cycle to terminate' };
        }
        await this.prisma.materialRefreshCycle.update({
          where: { id: cycle.id },
          data: { graceExpiresAt: new Date(now.getTime() - 1 * DAY_MS) },
        });
        await this.materialRefreshService.terminateCycle(cycle.id, 'simulated_grace_expired');
        return { ok: true, stage: 'GRACE_EXPIRED', message: 'Grace expired, customer offboarded' };
      }

      case 'GREEN': {
        // Simulate customer completing refresh successfully
        const cycle = await this.prisma.materialRefreshCycle.findFirst({
          where: { holdingId, status: 'PENDING_CUSTOMER_EVIDENCE' },
        });
        if (!cycle) {
          return { ok: false, message: 'No active cycle to complete' };
        }
        await this.materialRefreshService.handleSumsubActionResult({
          actionId: cycle.sumsubActionId || 'mock-action-simulate',
          reviewResult: { reviewAnswer: 'GREEN' },
        });
        return { ok: true, stage: 'CLEARED', message: 'Customer refreshed material successfully' };
      }

      case 'RED': {
        return { ok: true, stage: 'STILL_PENDING', message: 'Customer submission rejected, cycle stays PENDING for retry' };
      }

      default:
        return { ok: false, message: `Unknown targetStage: ${body.targetStage}` };
    }
  }

  @Post('customers/:customerId/simulate-tier-change')
  @ApiOperation({ summary: 'Directly set customer risk tier for demo (shortcut)' })
  async simulateTierChange(
    @Req() req: any,
    @Param('customerId') customerId: string,
    @Body() body: { targetTier: 'LOW' | 'MEDIUM' | 'HIGH' },
  ) {
    this.ensureAdmin(req);

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const policy = require('../../../../config/client-risk-assessment-policy.json');
    const tierLevelConstraint = policy.tierLevelConstraint || {};
    const allowedLevels = tierLevelConstraint[body.targetTier] || ['wave3-level-1'];
    const targetLevel = allowedLevels[0];

    // 1. Update customer tier + level
    const updateData: any = {
      riskRating: body.targetTier,
      riskRatingUpdatedAt: new Date(),
    };

    // Sync level if needed
    if (customer.sumsubCurrentLevelName !== targetLevel) {
      updateData.sumsubCurrentLevelName = targetLevel;
      if (targetLevel === 'wave3-level-2') {
        updateData.sumsubExperiencedLevel2 = true;
      }
    }

    await this.prisma.customerMain.update({
      where: { id: customerId },
      data: updateData,
    });

    // 2. Recompute holdings for new level
    await this.materialRefreshService.recomputeHoldingsForCustomer(
      customerId,
      targetLevel,
    );

    // 3. Create audit-trail ClientRiskAssessment record
    const { randomUUID } = require('crypto');
    await this.prisma.clientRiskAssessment.create({
      data: {
        assessmentNo: `CRA-SIM-${Date.now()}`,
        customerId,
        triggerType: 'MLRO_MANUAL',
        policyVersion: 'simulated',
        previousRiskTier: customer.riskRating,
        resultingRiskTier: body.targetTier,
        status: 'SIGNED',
        signedBy: 'ADMIN_SIMULATION',
        signedAt: new Date(),
        recommendedAction: 'SIMULATE_TIER_CHANGE',
        reasoning: JSON.stringify({ simulated: true, targetTier: body.targetTier }),
        traceId: `CLIENT_RISK_ASSESSMENT:sim-${randomUUID()}`,
      },
    });

    return {
      ok: true,
      previousTier: customer.riskRating,
      newTier: body.targetTier,
      newLevel: targetLevel,
      message: `Customer tier changed to ${body.targetTier}, level synced to ${targetLevel}`,
    };
  }
}

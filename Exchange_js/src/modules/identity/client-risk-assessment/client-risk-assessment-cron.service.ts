// client-risk-assessment-cron.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ClientRiskAssessmentService } from './client-risk-assessment.service';
import { ClientRiskAssessmentPolicyLoader } from './policy/policy-loader';

@Injectable()
export class ClientRiskAssessmentCronService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly assessmentService: ClientRiskAssessmentService,
    private readonly policyLoader: ClientRiskAssessmentPolicyLoader,
  ) {}

  @Cron('7 3 1 * *')  // 1st of every month, 03:07 UTC
  async runQuarterlyAssessment(): Promise<void> {
    const policy = this.policyLoader.getPolicy();
    const frequencyDays = policy.assessmentFrequencyDays.LOW || 90;
    const cutoff = new Date(Date.now() - frequencyDays * 24 * 60 * 60 * 1000);

    const dueCustomers = await this.prisma.customerMain.findMany({
      where: {
        onboardingStatus: 'APPROVED',
        OR: [
          { latestRiskAssessmentId: null },
          {
            riskAssessments: {
              some: { status: 'SIGNED', signedAt: { lt: cutoff } },
            },
          },
        ],
      },
      select: { id: true },
      take: 500,
    });

    for (const customer of dueCustomers) {
      try {
        await this.assessmentService.startAssessment({
          customerId: customer.id,
          triggerType: 'SCHEDULED_QUARTERLY',
        });
      } catch (err) {
        console.error(`Failed quarterly assessment for ${customer.id}:`, err);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

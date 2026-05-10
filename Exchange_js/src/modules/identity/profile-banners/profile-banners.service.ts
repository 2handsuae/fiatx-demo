import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';

export interface ProfileBanner {
  id: string;
  type: 'MATERIAL_REFRESH' | 'COMPLIANCE_HOLD' | 'PEP_REVIEW_PENDING';
  severity: 'INFO' | 'WARNING' | 'BLOCKING';
  title: string;
  description: string;
  cycleId?: string;
  materialType?: string;
  expiresAt?: string;
  daysFromExpiry?: number;
  ctaLabel?: string | null;
  ctaPath?: string | null;
  dismissible: boolean;
}

function formatMaterialName(m: string): string {
  const map: Record<string, string> = {
    EMIRATES_ID: 'Emirates ID',
    PASSPORT: 'Passport',
    PROOF_OF_ADDRESS: 'Proof of Address',
    SOURCE_OF_FUNDS: 'Source of Funds',
    SOURCE_OF_WEALTH: 'Source of Wealth',
  };
  return map[m] || m;
}

@Injectable()
export class ProfileBannerService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
  ) {}

  async getBannersFor(customerId: string): Promise<ProfileBanner[]> {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
    });
    if (!customer) return [];

    const banners: ProfileBanner[] = [];

    if (customer.complianceStatus === 'FROZEN') {
      banners.push({
        id: `banner-hold-${customer.id}`,
        type: 'COMPLIANCE_HOLD',
        severity: 'BLOCKING',
        title: 'Your account is frozen',
        description: 'Please contact our compliance team.',
        ctaLabel: 'Contact compliance',
        ctaPath: '/support/compliance',
        dismissible: false,
      });
    }

    if (customer.complianceFreezeReason === 'pep_review_pending') {
      banners.push({
        id: `banner-pep-${customer.id}`,
        type: 'PEP_REVIEW_PENDING',
        severity: 'WARNING',
        title: 'Compliance review in progress',
        description:
          'Your account is temporarily limited while we verify additional information.',
        ctaLabel: null,
        ctaPath: null,
        dismissible: false,
      });
    }

    const cycles = await this.prisma.materialRefreshCycle.findMany({
      where: { customerId, status: 'PENDING_CUSTOMER_EVIDENCE' },
      include: { holding: true },
      orderBy: { graceExpiresAt: 'asc' },
    });

    for (const cycle of cycles) {
      const holding = cycle.holding;
      const daysFromExpiry = holding?.expiresAt
        ? Math.floor(
            (holding.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
          )
        : null;

      const severity =
        cycle.stage === 'BLOCKING'
          ? 'BLOCKING'
          : cycle.stage === 'URGENT'
            ? 'WARNING'
            : 'INFO';

      const materialDisplay = formatMaterialName(cycle.materialType);
      const title =
        severity === 'BLOCKING'
          ? `Your ${materialDisplay} has expired`
          : `Your ${materialDisplay} expires in ${daysFromExpiry} days`;

      banners.push({
        id: `banner-mrc-${cycle.id}`,
        type: 'MATERIAL_REFRESH',
        severity,
        title,
        description:
          severity === 'BLOCKING'
            ? 'Refresh it now to restore your account.'
            : severity === 'WARNING'
              ? 'Refresh soon to avoid service interruption.'
              : 'You can refresh it at any time.',
        cycleId: cycle.id,
        materialType: cycle.materialType,
        expiresAt: holding?.expiresAt?.toISOString(),
        daysFromExpiry: daysFromExpiry ?? undefined,
        ctaLabel: `Refresh ${materialDisplay}`,
        ctaPath: `/verification?cycleId=${cycle.id}`,
        dismissible: severity === 'INFO',
      });
    }

    return banners.sort((a, b) => {
      const order = { BLOCKING: 0, WARNING: 1, INFO: 2 };
      return order[a.severity] - order[b.severity];
    });
  }
}

import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CustomerAccessService } from '../customers/customer-access.service';
import type { RestrictionCause } from '../customers/constants/restriction-cause.constant';

export interface ProfileBanner {
  id: string;
  type: 'MATERIAL_REFRESH' | 'RESTRICTION';
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

/**
 * 材料类 cause 的提示条挂 /verification 的 CTA，其余 cause 无 CTA（设计稿 §5.1）。
 * SILENT 的 cause（SANCTION / KYT_REJECTED_HARD）永远走不到这张表 ——
 * 本服务只遍历 CustomerAccess.disclosed，SILENT 行结构上进不了那个数组。
 */
const DOCUMENT_CTA_CAUSES = new Set<RestrictionCause>([
  'MATERIAL_EXPIRED',
  'PENDING_DOCUMENT',
]);

@Injectable()
export class ProfileBannerService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly customerAccessService: CustomerAccessService,
  ) {}

  async getBannersFor(customerId: string): Promise<ProfileBanner[]> {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
    });
    if (!customer) return [];

    const banners: ProfileBanner[] = [];

    const access = await this.customerAccessService.resolve(customerId);
    for (const restriction of access.disclosed) {
      const hasCta = DOCUMENT_CTA_CAUSES.has(restriction.cause);
      banners.push({
        id: `banner-restriction-${restriction.restrictionNo}`,
        type: 'RESTRICTION',
        severity: restriction.scopes.includes('ALL') ? 'BLOCKING' : 'WARNING',
        title: restriction.label,
        description: restriction.reason,
        ctaLabel: hasCta ? 'Go to verification' : null,
        ctaPath: hasCta ? '/verification' : null,
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

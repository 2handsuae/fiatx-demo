import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CustomerAccessService } from '../customers/customer-access.service';
import { MaterialRequestsService } from '../material-requests/material-requests.service';

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

@Injectable()
export class ProfileBannerService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly customerAccessService: CustomerAccessService,
    private readonly materialRequests: MaterialRequestsService,
  ) {}

  async getBannersFor(customerId: string): Promise<ProfileBanner[]> {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
    });
    if (!customer) return [];

    const banners: ProfileBanner[] = [];

    const requests = await this.materialRequests.listLiveByCustomer(customerId);
    const claimedBy = new Map(
      requests.filter((r) => r.restrictionNo).map((r) => [r.restrictionNo as string, r]),
    );

    const access = await this.customerAccessService.resolve(customerId);
    for (const restriction of access.disclosed) {
      // 2026-09-12 业主定案（波三§8）：条子+材料合并形态翻面——留条子那条（先说
      // 「你受限了」+原因），按钮借绑定材料的；材料已提交则改说审核中。
      const claim = claimedBy.get(restriction.restrictionNo);
      const submitted = claim?.status === 'SUBMITTED';
      banners.push({
        id: `banner-restriction-${restriction.restrictionNo}`,
        type: 'RESTRICTION',
        severity: restriction.scopes.includes('ALL') ? 'BLOCKING' : 'WARNING',
        title: restriction.label,
        description: submitted ? `${restriction.reason} — material submitted, under review.` : restriction.reason,
        ctaLabel: claim && !submitted ? 'Submit material' : null,
        ctaPath: claim && !submitted ? `/verification/${claim.requestNo}` : null,
        dismissible: false,
      });
    }

    for (const r of requests) {
      // 材料行只发没绑条子的（绑了的已并进条子形态行）；绑订单与否不再排除——
      // Overview/Profile 是全量面（业主定案矩阵，推翻 2026-08-18 G6 的该分支）。
      if (r.restrictionNo !== null) continue;
      banners.push({
        id: `material-request:${r.requestNo}`,
        type: 'MATERIAL_REFRESH',
        severity: 'INFO',
        title: `${formatMaterialName(r.materialType)} needs refreshing`,
        description: r.reason,
        materialType: r.materialType,
        ctaLabel: r.status === 'SUBMITTED' ? null : 'Verify now',
        ctaPath: r.status === 'SUBMITTED' ? null : `/verification/${r.requestNo}`,
        dismissible: true,
      });
    }

    return banners.sort((a, b) => {
      const order = { BLOCKING: 0, WARNING: 1, INFO: 2 };
      return order[a.severity] - order[b.severity];
    });
  }
}

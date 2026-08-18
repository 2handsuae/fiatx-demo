import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CustomerAccessService } from '../customers/customer-access.service';
import { MaterialRequestsService } from '../material-requests/material-requests.service';
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
    private readonly materialRequests: MaterialRequestsService,
  ) {}

  async getBannersFor(customerId: string): Promise<ProfileBanner[]> {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
    });
    if (!customer) return [];

    const banners: ProfileBanner[] = [];

    // 材料请求账的活行先取出来 —— RESTRICTION 那一路要用它做去重（见下）。
    const requests = await this.materialRequests.listLiveByCustomer(customerId);
    const claimedRestrictionNos = new Set(
      requests.filter((r) => r.restrictionNo).map((r) => r.restrictionNo as string),
    );

    const access = await this.customerAccessService.resolve(customerId);
    for (const restriction of access.disclosed) {
      // 去重：这张便签的故事已经由下面的材料横幅讲了（它带 CTA、更有用），
      // 不再重复出一条 RESTRICTION。服务的是 ADMIN_SUSPENSION 这类不带
      // 材料请求的限制。
      if (claimedRestrictionNos.has(restriction.restrictionNo)) continue;

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

    // ── 材料请求横幅（2026-08-17 起数据源是材料账，不再是 cycle）──
    // G6：客户级横幅 = 活行里「挂了限制的」∪「没绑单的」。
    // 绑了单又没挂限制的只在订单页露 —— 那种行在这里被过滤掉。
    for (const r of requests) {
      const blocking = r.restrictionNo !== null;
      if (!blocking && r.orderDomain !== null) continue; // 订单页管它

      banners.push({
        id: `material-request:${r.requestNo}`,
        type: 'MATERIAL_REFRESH',
        // 挂了摁人的限制 → 红；只是提醒 → 黄
        severity: blocking ? 'BLOCKING' : 'INFO',
        title: blocking
          ? `${formatMaterialName(r.materialType)} required`
          : `${formatMaterialName(r.materialType)} needs refreshing`,
        description: r.reason,
        materialType: r.materialType,
        ctaLabel: r.status === 'SUBMITTED' ? null : 'Verify now',
        ctaPath: r.status === 'SUBMITTED' ? null : `/verification/${r.requestNo}`,
        dismissible: !blocking,
      });
    }

    return banners.sort((a, b) => {
      const order = { BLOCKING: 0, WARNING: 1, INFO: 2 };
      return order[a.severity] - order[b.severity];
    });
  }
}

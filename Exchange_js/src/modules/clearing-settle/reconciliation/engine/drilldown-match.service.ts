import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { LegProjectionService, InternalLeg } from './leg-projection.service';
import { MatchEngineV2Service, ExternalLine, MatchV2Options } from './match-engine-v2.service';
import { AnomalyClassifierService, ClassifyResult } from './anomaly-classifier.service';

export interface DrilldownInput {
  /** 币种 code（AED / USDT…）。 */
  currency: string;
  /** 业务日 D（YYYY-MM-DD）。 */
  businessDate: string;
  /** D 结束（次日 00:00）。 */
  cutoff: Date;
  /** 可选 assetId（不传则按 currency 反查）。 */
  assetId?: string;
  match?: MatchV2Options;
}

export interface DrilldownResult {
  currency: string;
  businessDate: string;
  internalLegCount: number;
  externalLineCount: number;
  classified: ClassifyResult;
}

/**
 * 下钻匹配编排器（thin）：投影 → 匹配 → 定性，针对 (cutoff, currency) 返回四桶 line items。
 * spec 2026-06-20 §4。不落库（只读 + 纯计算）；落库/建 case 由 workflow/domain 层处理（G6）。
 */
@Injectable()
export class DrilldownMatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projection: LegProjectionService,
    private readonly matcher: MatchEngineV2Service,
    private readonly classifier: AnomalyClassifierService,
  ) {}

  async run(input: DrilldownInput): Promise<DrilldownResult> {
    const assetId = input.assetId ?? (await this.resolveAssetId(input.currency));
    // ① 内部腿投影（真实数据，只取终态）
    const legs: InternalLeg[] = await this.projection.project(
      assetId, input.currency, input.businessDate, input.cutoff,
    );
    // ② 外部行（当业务日，按币种）
    const lines = await this.loadExternalLines(input.currency, input.businessDate);
    // ③ 匹配（主键不含金额）+ ④ 定性（四桶）
    const matchRes = this.matcher.match(legs, lines, input.match);
    const classified = this.classifier.classify(matchRes);
    return {
      currency: input.currency,
      businessDate: input.businessDate,
      internalLegCount: legs.length,
      externalLineCount: lines.length,
      classified,
    };
  }

  private async resolveAssetId(currency: string): Promise<string> {
    const asset = await this.prisma.asset.findFirst({ where: { currency }, select: { id: true } });
    if (!asset) throw new Error(`No asset for currency ${currency}`);
    return asset.id;
  }

  /** 加载某业务日某币种的外部归一化行（datetime 落在业务日）。 */
  private async loadExternalLines(currency: string, businessDate: string): Promise<ExternalLine[]> {
    const lo = new Date(`${businessDate}T00:00:00.000Z`);
    const hi = new Date(`${businessDate}T23:59:59.999Z`);
    const rows = await this.prisma.externalStatementLine.findMany({
      where: { currency, datetime: { gte: lo, lte: hi } },
      select: {
        id: true, source: true, accountRef: true, subAccount: true, book: true, currency: true,
        direction: true, amount: true, externalRef: true, channelRef: true, datetime: true, description: true,
      },
    });
    return rows as ExternalLine[];
  }
}

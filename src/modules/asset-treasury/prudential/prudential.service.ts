// 战役乙波三 T1 · 审慎地基：只读 NLA 状态计算——查两资产（AED/USDT）的 F_OPS 运营户余额，
// USDT 经汇率单源折算 AED，汇总对比红线。纯读零写：本任务不写审计（写点在 T2 门 / T3 巡检）。
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { SystemWalletResolver } from '../../funds-layer/domain/system-wallet-resolver.service';
import { MONTHLY_OPEX_BASE_AED_MINOR, NLA_FLOOR_AED_MINOR, usdtMinorToAedMinor } from './prudential.constants';

export interface PrudentialAssetStatus {
  assetCode: string;
  currency: string;
  balanceMinor: string;
  aedEquivalentMinor: string;
}

export interface PrudentialStatus {
  perAsset: PrudentialAssetStatus[];
  nlaAedMinor: string;
  floorAedMinor: string;
  headroomAedMinor: string;
  breached: boolean;
  monthlyOpexBaseAedMinor: string;
  coefficient: '1.2';
}

@Injectable()
export class PrudentialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly systemWallets: SystemWalletResolver,
    private readonly accounting: AccountingService,
  ) {}

  /** 查两资产（AED/USDT）→ 逐资产 resolve F_OPS 钱包（确认在册，同注资单先例）→
   *  按 currency 对应 ledger 取 TB 运营户余额（口径同 vendor-payment.service.ts:98-109：
   *  available = creditsPosted − debitsPosted − debitsPending）→ AED 直加、USDT 经
   *  usdtMinorToAedMinor 折算 → 汇总 NLA，比红线算余量/缺口。 */
  async computeStatus(): Promise<PrudentialStatus> {
    const assets = await this.prisma.asset.findMany({
      where: { currency: { in: ['AED', 'USDT'] }, status: 'ACTIVE' },
    });

    const perAsset: PrudentialAssetStatus[] = [];
    let nlaAedMinor = 0n;

    for (const asset of assets) {
      await this.systemWallets.resolve(asset.id, 'F_OPS');
      const ledger = TB_LEDGERS[asset.currency as keyof typeof TB_LEDGERS];
      const tbAccountId = await this.accounting.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.FIRM_OPS,
        ledger,
        ownerType: 'SYSTEM',
      });
      const bal = await this.accounting.lookupBalance(tbAccountId);
      const balanceMinor = bal.creditsPosted - bal.debitsPosted - bal.debitsPending;
      const aedEquivalentMinor = asset.currency === 'AED' ? balanceMinor : usdtMinorToAedMinor(balanceMinor);
      nlaAedMinor += aedEquivalentMinor;
      perAsset.push({
        assetCode: asset.code,
        currency: asset.currency,
        balanceMinor: balanceMinor.toString(),
        aedEquivalentMinor: aedEquivalentMinor.toString(),
      });
    }

    const headroomAedMinor = nlaAedMinor - NLA_FLOOR_AED_MINOR;

    return {
      perAsset,
      nlaAedMinor: nlaAedMinor.toString(),
      floorAedMinor: NLA_FLOOR_AED_MINOR.toString(),
      headroomAedMinor: headroomAedMinor.toString(),
      breached: nlaAedMinor < NLA_FLOOR_AED_MINOR,
      monthlyOpexBaseAedMinor: MONTHLY_OPEX_BASE_AED_MINOR.toString(),
      coefficient: '1.2',
    };
  }
}

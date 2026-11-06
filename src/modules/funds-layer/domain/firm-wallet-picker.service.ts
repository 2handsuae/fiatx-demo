import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, Wallet } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';

/** 公司侧「钱从哪只钱包出」可由人选的 vault（戊波二 spec §0 裁定 4）：运营户、手续费户。
 *  结算户里的钱正在往客户走、LP 前厅里的钱是 LP 刚交来还没验收——这两个口袋不许挪作他用。 */
const SELECTABLE_FROM_VAULTS = ['F_OPS', 'F_FEE'] as const;

/** 付款单 / 公司调拨单 / 认损补缺单三处同调的 from 钱包守卫。与 SystemWalletResolver 同处：
 *  Resolver 是「按角色找唯一那只」，这里是「人选了一只，验它配不配」。 */
@Injectable()
export class FirmWalletPickerService {
  constructor(private readonly prisma: PrismaService) {}

  /** 通过则返回钱包行；不通过一律 400 FROM_WALLET_NOT_ELIGIBLE（铁律⑥：话术只用 walletNo，不带 UUID）。 */
  async assertEligible(walletId: string, assetId: string, tx?: Prisma.TransactionClient): Promise<Wallet> {
    const db = (tx ?? this.prisma) as any;
    const [wallet, asset] = await Promise.all([
      db.wallet.findUnique({ where: { id: walletId } }),
      db.asset.findUnique({ where: { id: assetId }, select: { network: true, code: true } }),
    ]);
    if (!wallet) {
      throw new BadRequestException({ code: 'FROM_WALLET_NOT_ELIGIBLE', message: 'The chosen from wallet does not exist' });
    }
    if (!asset) {
      throw new BadRequestException({ code: 'ASSET_NOT_FOUND', message: 'The asset of this order does not exist' });
    }
    if (wallet.ownerType !== 'PLATFORM' || wallet.network !== asset.network || !(SELECTABLE_FROM_VAULTS as readonly string[]).includes(wallet.vaultCode)) {
      throw new BadRequestException({
        code: 'FROM_WALLET_NOT_ELIGIBLE',
        message: `Wallet ${wallet.walletNo} cannot be chosen as the from wallet for ${asset.code} — only a Company Operations or Company Fees wallet on the ${asset.network} network can be`,
      });
    }
    return wallet;
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { assertAssetTransition, AssetAction } from './constants/asset-transitions.constant';

@Injectable()
export class AssetsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(params: {
    skip?: number;
    take?: number;
    where?: Prisma.AssetWhereInput;
    orderBy?: Prisma.AssetOrderByWithRelationInput;
  }) {
    const { skip, take, where, orderBy } = params;
    const [items, total] = await Promise.all([
      this.prisma.asset.findMany({ skip, take, where, orderBy }),
      this.prisma.asset.count({ where }),
    ]);
    return { items, total };
  }

  /** 铁律⑥：对外只认 assetNo，内部 id 不再是查询键 */
  async findOne(assetNo: string) {
    const item = await this.prisma.asset.findUnique({ where: { assetNo } });
    if (!item) throw new NotFoundException('Asset not found');
    return item;
  }

  async findByAssetNo(assetNo: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    return db.asset.findUnique({ where: { assetNo } });
  }

  async findByCode(code: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    return db.asset.findUnique({ where: { code } });
  }

  async suspendAsset(assetId: string, reason: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const asset = await db.asset.findUnique({ where: { id: assetId }, select: { id: true, assetNo: true, status: true } });
    if (!asset) throw new NotFoundException('Asset not found');
    const to = assertAssetTransition(asset.status, AssetAction.SUSPEND);
    return db.asset.update({
      where: { id: assetId },
      data: { status: to, suspendedAt: new Date(), suspendReason: reason, approvalCaseNo: null },
      select: { id: true, assetNo: true, status: true },
    });
  }

  async reactivateAsset(assetId: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const asset = await db.asset.findUnique({ where: { id: assetId }, select: { id: true, assetNo: true, status: true } });
    if (!asset) throw new NotFoundException('Asset not found');
    const to = assertAssetTransition(asset.status, AssetAction.REACTIVATE);
    return db.asset.update({
      where: { id: assetId },
      data: { status: to, suspendedAt: null, suspendReason: null, approvalCaseNo: null },
      select: { id: true, assetNo: true, status: true },
    });
  }

  /** 待批的暂停 / 恢复单号挂在资产上（详情页待批徽章读它） */
  async linkApprovalCase(assetNo: string, approvalCaseNo: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await db.asset.update({ where: { assetNo }, data: { approvalCaseNo } });
  }

  async clearApprovalCase(assetNo: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await db.asset.update({ where: { assetNo }, data: { approvalCaseNo: null } });
  }
}

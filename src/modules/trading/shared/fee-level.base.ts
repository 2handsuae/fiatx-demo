// src/modules/trading/shared/fee-level.base.ts
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { isValidTag } from '../../identity/customer-tags/constants/customer-tag.constant';
import {
  assertFeeLevelTransition,
  FeeLevelAction,
  assertFeeChangeRequestTransition,
  FeeChangeRequestAction,
} from './fee-level-transitions.constant';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';

/**
 * C1 · fee-level 双服务共同骨架（withdrawal-fee-level / swap-fee-level）。
 * 只收两域逐字一致的方法（domain 差仅体现为 Prisma model 名 / requestNo 前缀常量）。
 * 域形状真分叉的方法（findAll/findById/findByLevelCode 的 include、createLevel、
 * assertNotLastActiveDefault、validateTiersJson、findActiveByAsset/findActiveByPair）
 * 不进本类，原样留在两个子类。
 */
export abstract class FeeLevelServiceBase {
  constructor(protected readonly prisma: PrismaService) {}

  /** prisma.withdrawalFeeLevel | prisma.swapFeeLevel（按 db 取值以支持事务客户端） */
  protected abstract levelDelegate(db: PrismaService | Prisma.TransactionClient): any;

  /** 对应 change-request 表（按 db 取值以支持事务客户端） */
  protected abstract changeRequestDelegate(db: PrismaService | Prisma.TransactionClient): any;

  /** createChangeRequest 生成 requestNo 用的前缀（'WFC' | 'SFC'） */
  protected abstract get requestNoPrefix(): string;

  /**
   * 分档校验规则两域不同（feeItems 必填 vs rateMarkupBps 必填），逻辑本身留在子类。
   * 此处仅声明签名——createChangeRequest 需要调用它，TypeScript 要求基类知道这个成员存在。
   */
  abstract validateTiersJson(tiersJson: string): unknown;

  protected computeHash(tiersJson: string): string {
    return createHash('sha256').update(tiersJson).digest('hex');
  }

  validateAudienceFields(
    isDefault: boolean,
    requiredTags?: string[],
    validFrom?: string,
    validTo?: string,
  ): void {
    if (isDefault && (requiredTags?.length ?? 0) > 0) {
      throw new BadRequestException('Default tier (isDefault) cannot also set requiredTags — the two are semantically conflicting');
    }
    if ((requiredTags?.length ?? 0) > 1) {
      throw new BadRequestException('A single fee level can require at most one tag (or everyone)');
    }
    for (const tag of requiredTags ?? []) {
      if (!isValidTag(tag)) {
        throw new BadRequestException(`Invalid requiredTags entry: ${tag}`);
      }
    }
    if (validFrom && validTo && new Date(validFrom) > new Date(validTo)) {
      throw new BadRequestException('validFrom must not be after validTo');
    }
  }

  async linkApprovalCase(levelCode: string, caseId: string, caseNo: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await this.levelDelegate(db).update({
      where: { levelCode },
      data: { approvalCaseId: caseId, approvalCaseNo: caseNo },
    });
  }

  async activateLevel(levelCode: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    const level = await this.levelDelegate(db).findUnique({ where: { levelCode } });
    if (!level) throw new NotFoundException(`Level ${levelCode} not found`);
    const to = assertFeeLevelTransition(level.status, FeeLevelAction.APPROVE);
    await this.levelDelegate(db).update({
      where: { levelCode },
      data: { status: to, approvalCaseId: null, approvalCaseNo: null },
    });
  }

  async declineLevel(levelCode: string, tx?: Prisma.TransactionClient): Promise<void> {
    await this.moveLevel(levelCode, FeeLevelAction.DECLINE, tx);
  }

  async cancelLevel(levelCode: string, tx?: Prisma.TransactionClient): Promise<void> {
    await this.moveLevel(levelCode, FeeLevelAction.CANCEL, tx);
  }

  async retireLevel(levelCode: string, tx?: Prisma.TransactionClient): Promise<void> {
    await this.moveLevel(levelCode, FeeLevelAction.RETIRE, tx);
  }

  private async moveLevel(levelCode: string, action: FeeLevelAction, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    const level = await this.levelDelegate(db).findUnique({ where: { levelCode } });
    if (!level) throw new NotFoundException(`Level ${levelCode} not found`);
    const to = assertFeeLevelTransition(level.status, action);
    await this.levelDelegate(db).update({ where: { levelCode }, data: { status: to, approvalCaseId: null, approvalCaseNo: null } });
  }

  async clearApprovalCase(levelCode: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await this.levelDelegate(db).update({ where: { levelCode }, data: { approvalCaseId: null, approvalCaseNo: null } });
  }

  async deleteById(id: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await this.levelDelegate(db).delete({ where: { id } });
  }

  // ─── Change Request CRUD ─────────────────────────────────

  async createChangeRequest(
    dto: {
      levelId: string;
      levelCode: string;
      proposedTiersJson: string;
      changeReason: string;
      requestedByUserId: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;

    const pendingRequest = await this.changeRequestDelegate(db).findFirst({
      where: { levelId: dto.levelId, status: 'PENDING_APPROVAL' },
    });
    if (pendingRequest) {
      throw new ConflictException(`Level ${dto.levelCode} already has a pending change request: ${pendingRequest.requestNo}`);
    }

    this.validateTiersJson(dto.proposedTiersJson);

    const level = await this.levelDelegate(db).findUnique({ where: { id: dto.levelId } });
    if (!level) throw new NotFoundException(`Level ${dto.levelId} not found`);

    for (let attempt = 0; attempt < 3; attempt++) {
      const requestNo = generateReferenceNo(this.requestNoPrefix);
      try {
        return await this.changeRequestDelegate(db).create({
          data: {
            requestNo,
            levelId: dto.levelId,
            levelCode: dto.levelCode,
            currentTiersJson: level.tiersJson,
            currentConfigHash: level.configHash,
            proposedTiersJson: dto.proposedTiersJson,
            changeReason: dto.changeReason,
            requestedByUserId: dto.requestedByUserId,
            status: 'PENDING_APPROVAL',
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          if (attempt === 2) throw new ConflictException('Failed to generate unique requestNo after 3 attempts');
          continue;
        }
        throw e;
      }
    }
    throw new ConflictException('Failed to generate unique requestNo after 3 attempts');
  }

  async linkApprovalCaseToRequest(requestNo: string, caseId: string, caseNo: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await this.changeRequestDelegate(db).update({
      where: { requestNo },
      data: { approvalCaseId: caseId, approvalCaseNo: caseNo },
    });
  }

  async executeChange(requestNo: string, tx?: Prisma.TransactionClient) {
    const run = async (db: Prisma.TransactionClient | PrismaService) => {
      const request = await this.changeRequestDelegate(db).findUnique({ where: { requestNo } });
      if (!request) throw new NotFoundException(`Change request ${requestNo} not found`);
      const to = assertFeeChangeRequestTransition(request.status, FeeChangeRequestAction.APPROVE);

      const level = await this.levelDelegate(db).findUnique({ where: { id: request.levelId } });
      if (!level) throw new NotFoundException(`Level for request ${requestNo} not found`);
      if (level.status !== 'ACTIVE') {
        throw new ConflictException(`Level ${level.levelCode} is ${level.status}, must be ACTIVE to apply change`);
      }

      if (request.currentConfigHash !== level.configHash) {
        throw new ConflictException(
          `Conflict: level config changed since request was created (snapshot hash: ${request.currentConfigHash}, actual: ${level.configHash})`,
        );
      }

      const newHash = this.computeHash(request.proposedTiersJson);

      const updatedLevel = await this.levelDelegate(db).update({
        where: { id: level.id },
        data: { tiersJson: request.proposedTiersJson, configHash: newHash },
      });

      const updatedRequest = await this.changeRequestDelegate(db).update({
        where: { requestNo },
        data: { status: to, executedAt: new Date() },
      });

      return { level: updatedLevel, request: updatedRequest };
    };

    if (tx) return run(tx);
    return this.prisma.$transaction(async (txn) => run(txn));
  }

  async rejectChangeRequest(requestNo: string, tx?: Prisma.TransactionClient): Promise<void> {
    await this.moveChangeRequest(requestNo, FeeChangeRequestAction.DECLINE, tx);
  }

  async cancelChangeRequest(requestNo: string, tx?: Prisma.TransactionClient): Promise<void> {
    await this.moveChangeRequest(requestNo, FeeChangeRequestAction.CANCEL, tx);
  }

  async expireChangeRequest(requestNo: string, tx?: Prisma.TransactionClient): Promise<void> {
    await this.moveChangeRequest(requestNo, FeeChangeRequestAction.EXPIRE, tx);
  }

  private async moveChangeRequest(requestNo: string, action: FeeChangeRequestAction, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    const request = await this.changeRequestDelegate(db).findUnique({ where: { requestNo } });
    if (!request) throw new NotFoundException(`Change request ${requestNo} not found`);
    const to = assertFeeChangeRequestTransition(request.status, action);
    await this.changeRequestDelegate(db).update({ where: { requestNo }, data: { status: to } });
  }

  async findChangeRequestById(id: string) {
    const request = await this.changeRequestDelegate(this.prisma).findUnique({ where: { id } });
    if (!request) throw new NotFoundException(`Change request not found: ${id}`);
    return request;
  }
}

import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { QueryClearingDto } from './dto/clearing.dto';
import { Prisma } from '@prisma/client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';

@Injectable()
export class ClearingsService {
  constructor(private prisma: PrismaService) {}

  private toCanonicalSourcePath(expr: string): string {
    if (expr === 'source') return 'src';
    if (expr.startsWith('source.')) return `src.${expr.slice('source.'.length)}`;
    return expr;
  }

  private resolveTemplatePath(context: any, expr: string): any {
    const normalized = this.toCanonicalSourcePath(expr.trim());
    const keys = normalized.split('.');
    let value = context;

    for (const key of keys) {
      if (value && Object.prototype.hasOwnProperty.call(value, key)) {
        value = value[key];
      } else {
        return undefined;
      }
    }

    return value;
  }

  private evalDecimal(expr: string, context: any, field: string): Prisma.Decimal {
    const value = this.resolveTemplatePath(context, expr);
    if (value === undefined || value === null || value === '') {
      throw new BadRequestException({
        code: 'CLEARING_TEMPLATE_EVAL_FAILED',
        message: `Clearing template field "${field}" cannot be resolved from "${expr}"`,
      });
    }

    try {
      const amount = new Prisma.Decimal(value);
      if (amount.lt(0)) {
        throw new BadRequestException({
          code: 'CLEARING_TEMPLATE_EVAL_FAILED',
          message: `Clearing template field "${field}" resolved to negative value`,
        });
      }
      return amount;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException({
        code: 'CLEARING_TEMPLATE_EVAL_FAILED',
        message: `Clearing template field "${field}" is not a valid decimal`,
      });
    }
  }

  private evalString(
    expr: string,
    context: any,
    field: string,
    required = true,
  ): string | null {
    const value = this.resolveTemplatePath(context, expr);
    if (value === undefined || value === null || value === '') {
      if (!required) return null;
      throw new BadRequestException({
        code: 'CLEARING_TEMPLATE_EVAL_FAILED',
        message: `Clearing template field "${field}" cannot be resolved from "${expr}"`,
      });
    }

    return String(value);
  }

  async triggerClearing(params: {
    sourceType: string;
    sourceId: string;
    eventCode: string;
    context: any;
  }, tx?: Prisma.TransactionClient) {
    const { sourceType, sourceId, eventCode, context } = params;
    const client = tx || this.prisma;

    // 1. Idempotency check
    const existing = await (client as any).clearing.findFirst({
      where: { sourceType, sourceId, clearingType: eventCode },
    });

    if (existing) {
      return existing;
    }

    // 2. Find Event and Template
    const event = await (client as any).acctEvent.findUnique({
      where: { eventCode },
    });

    if (!event || !(event as any).clearingTemplateCode) {
      return null;
    }

    const template = await (client as any).clearingTemplate.findUnique({
      where: { code: (event as any).clearingTemplateCode },
      include: { lineTemplates: true },
    });

    if (!template) {
      throw new BadRequestException({
        code: 'CLEARING_TEMPLATE_EVAL_FAILED',
        message: `Clearing template "${(event as any).clearingTemplateCode}" not found`,
      });
    }

    const executeCreate = async (transactionClient: Prisma.TransactionClient) => {
      const outAssetId = this.evalString(
        template.outAssetSource,
        context,
        'outAssetSource',
      )!;
      const outAmount = this.evalDecimal(
        template.outAmountSource,
        context,
        'outAmountSource',
      );
      const inAssetId = this.evalString(
        template.inAssetSource,
        context,
        'inAssetSource',
      )!;
      const inAmount = this.evalDecimal(
        template.inAmountSource,
        context,
        'inAmountSource',
      );
      const feeAssetId = this.evalString(
        template.feeAssetSource,
        context,
        'feeAssetSource',
      )!;
      const feeAmount = this.evalDecimal(
        template.feeAmountSource,
        context,
        'feeAmountSource',
      );

      const outPayoutId = template.outPayoutIdSource
        ? this.evalString(
            template.outPayoutIdSource,
            context,
            'outPayoutIdSource',
            false,
          )
        : null;
      const inPayinId = template.inPayinIdSource
        ? this.evalString(
            template.inPayinIdSource,
            context,
            'inPayinIdSource',
            false,
          )
        : null;

      // 3. Update Withdrawal Record with template-derived amounts
      if (sourceType === 'WITHDRAWAL') {
        await (transactionClient as any).withdrawTransaction.update({
          where: { id: sourceId },
          data: {
            feeAmount,
            netAmount: inAmount,
          }
        });
      }

      // 4. Create Clearing Record
      const clearing = await (transactionClient as any).clearing.create({
        data: {
          clearingNo: generateReferenceNo('CL'),
          clearingType: eventCode,
          sourceType,
          sourceId,
          outAssetId,
          outAmount,
          inAssetId,
          inAmount,
          feeAssetId,
          feeAmount,
          feeMethod: template.feeMethod,
          outPayoutId,
          inPayinId,
          clearingStatus: 'CLEARED',
          memo: template.memoTemplate || `Auto clearing for ${eventCode}`,
        },
      });

      // 5. Create lines based on template expressions
      for (const lt of template.lineTemplates) {
        const lineAmount = this.evalDecimal(
          lt.amountSource,
          context,
          `lineTemplates[${lt.lineNo}].amountSource`,
        );
        const lineAssetId = this.evalString(
          lt.assetSource,
          context,
          `lineTemplates[${lt.lineNo}].assetSource`,
        )!;
        const linePartyId = lt.partyIdSource
          ? this.evalString(
              lt.partyIdSource,
              context,
              `lineTemplates[${lt.lineNo}].partyIdSource`,
              false,
            )
          : null;
        const lineRefId = lt.refIdSource
          ? this.evalString(
              lt.refIdSource,
              context,
              `lineTemplates[${lt.lineNo}].refIdSource`,
              false,
            )
          : null;

        await (transactionClient as any).clearingLine.create({
          data: {
            clearingId: clearing.id,
            lineNo: lt.lineNo,
            lineType: lt.lineType,
            partyType: lt.partyType,
            partyId: linePartyId,
            assetId: lineAssetId,
            amount: lineAmount,
            refType: lt.refTypeConst || null,
            refId: lineRefId,
          },
        });
      }

      return clearing;
    };

    if (tx) {
      return executeCreate(tx);
    }

    return await (this.prisma as any).$transaction(async (transactionClient: any) => {
      return executeCreate(transactionClient);
    });
  }

  async findAll(query: QueryClearingDto) {
    const { skip = 0, take = 10, sourceId, clearingStatus, sortBy, sortOrder } = query;
    const where: any = {};
    if (sourceId) {
      where.sourceId = { contains: sourceId };
    }
    if (clearingStatus) {
      where.clearingStatus = clearingStatus;
    }

    const orderBy: any = {};
    if (sortBy) {
        orderBy[sortBy] = sortOrder || 'asc';
    } else {
        orderBy.createdAt = 'desc';
    }

    const [items, total] = await Promise.all([
      (this.prisma as any).clearing.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          lines: true,
          outPayout: true,
          inPayin: true,
        },
      }),
      (this.prisma as any).clearing.count({ where }),
    ]);

    // Enrich with Asset Codes and Source Nos
    const enrichedItems = await Promise.all(items.map(async (item: any) => {
        let outAssetNo = null;
        let inAssetNo = null;
        let sourceNo = null;

        // Fetch Asset Codes
        if (item.outAssetId) {
            const asset = await (this.prisma as any).asset.findUnique({ where: { id: item.outAssetId }, select: { code: true } });
            outAssetNo = asset?.code;
        }
        if (item.inAssetId) {
            const asset = await (this.prisma as any).asset.findUnique({ where: { id: item.inAssetId }, select: { code: true } });
            inAssetNo = asset?.code;
        }

        // Fetch Source No based on type
        if (item.sourceId) {
            try {
                if (item.sourceType === 'WITHDRAWAL') {
                    const src = await (this.prisma as any).withdrawTransaction.findUnique({ where: { id: item.sourceId }, select: { withdrawNo: true } });
                    sourceNo = src?.withdrawNo;
                } else if (item.sourceType === 'DEPOSIT') {
                    const src = await (this.prisma as any).depositTransaction.findUnique({ where: { id: item.sourceId }, select: { depositNo: true } });
                    sourceNo = src?.depositNo;
                } else if (item.sourceType === 'SWAP') {
                     const src = await (this.prisma as any).swapTransaction.findUnique({ where: { id: item.sourceId }, select: { swapNo: true } });
                     sourceNo = src?.swapNo;
                }
            } catch (e) {}
        }

        return {
            ...item,
            outAssetNo,
            inAssetNo,
            sourceNo
        };
    }));

    return { items: enrichedItems, total };
  }

  async findOne(id: string) {
    const clearing = await (this.prisma as any).clearing.findUnique({
      where: { id },
      include: {
        lines: {
          orderBy: { lineNo: 'asc' },
        },
        outPayout: true,
        inPayin: true,
      },
    });
    if (!clearing) {
      throw new NotFoundException(`Clearing with ID ${id} not found`);
    }

    // Manually fetch Asset Codes (since relations are missing in schema)
    const [outAsset, inAsset, feeAsset] = await Promise.all([
        (this.prisma as any).asset.findUnique({ where: { id: clearing.outAssetId } }),
        (this.prisma as any).asset.findUnique({ where: { id: clearing.inAssetId } }),
        clearing.feeAssetId ? (this.prisma as any).asset.findUnique({ where: { id: clearing.feeAssetId } }) : null
    ]);

    // Flatten "No" fields for frontend convenience
    return {
        ...clearing,
        outAssetNo: outAsset?.code || null,
        inAssetNo: inAsset?.code || null,
        feeAssetNo: feeAsset?.code || null,
        outPayoutNo: clearing.outPayout?.payoutNo || null,
        inPayinNo: clearing.inPayin?.payinNo || null
    };
  }

  async findLine(id: string) {
    const line = await (this.prisma as any).clearingLine.findUnique({
      where: { id },
      include: {
        clearing: {
            select: { clearingNo: true }
        }
      }
    });

    if (!line) {
      throw new NotFoundException(`Clearing Line with ID ${id} not found`);
    }

    // Enrich with Party No and Asset Code
    let partyNo = null;
    if (line.partyId) {
        try {
            if (line.partyType === 'CUSTOMER') {
                const source = await (this.prisma as any).customerMain.findUnique({ where: { id: line.partyId }, select: { customerNo: true } });
                partyNo = source?.customerNo;
            } else if (line.partyType === 'LIQUIDITY_PROVIDER') {
                const source = await (this.prisma as any).liquidityProvider.findUnique({ where: { id: line.partyId }, select: { lpNo: true } });
                partyNo = source?.lpNo;
            }
        } catch (e) {}
    }

    let assetCode = null;
    try {
        const asset = await (this.prisma as any).asset.findUnique({ where: { id: line.assetId }, select: { code: true } });
        assetCode = asset?.code;
    } catch (e) {}

    return {
        ...line,
        clearingNo: line.clearing?.clearingNo,
        partyNo,
        assetCode
    };
  }

  async findAllLines(query: any) {
    const { skip, take, clearingId, sortBy, sortOrder } = query;
    const where: any = {};
    if (clearingId) {
      where.clearingId = clearingId;
    }

    const orderBy: any = {};
    if (sortBy) {
        orderBy[sortBy] = sortOrder || 'asc';
    } else {
        orderBy.createdAt = 'desc';
    }

    const [items, total] = await Promise.all([
      (this.prisma as any).clearingLine.findMany({
        where,
        skip: skip ? Number(skip) : 0,
        take: take ? Number(take) : 10,
        orderBy,
        include: {
          clearing: true,
        },
      }),
      (this.prisma as any).clearingLine.count({ where }),
    ]);

    // Attach No fields for better readability
    const itemsWithNo = await Promise.all(items.map(async (item: any) => {
        let partyNo = null;
        if (item.partyId) {
            try {
                if (item.partyType === 'CUSTOMER') {
                    const source = await (this.prisma as any).customerMain.findUnique({ where: { id: item.partyId }, select: { customerNo: true } });
                    partyNo = source?.customerNo;
                } else if (item.partyType === 'LIQUIDITY_PROVIDER') {
                    const source = await (this.prisma as any).liquidityProvider.findUnique({ where: { id: item.partyId }, select: { lpNo: true } });
                    partyNo = source?.lpNo;
                }
            } catch (e) {}
        }

        let assetNo = null;
        if (item.assetId) {
            const asset = await (this.prisma as any).asset.findUnique({ where: { id: item.assetId }, select: { code: true } });
            assetNo = asset?.code;
        }

        return { 
            ...item, 
            partyNo,
            assetNo
        };
    }));

    return { items: itemsWithNo, total };
  }

  async reClear(id: string) {
    const clearing = await this.findOne(id);

    // Logic to re-clear:
    // 1. Find the matching template (usually via clearingType/sourceType)
    // 2. Re-calculate lines
    // 3. Update the clearing instance

    // For now, this is a placeholder that just updates the updatedAt timestamp
    // and returns the clearing instance to satisfy the frontend requirement.
    return (this.prisma as any).clearing.update({
      where: { id },
      data: { updatedAt: new Date() },
      include: { lines: true },
    });
  }

  async updateStatusBySource(sourceId: string, status: string, tx?: Prisma.TransactionClient) {
    const client = tx || this.prisma;
    return (client as any).clearing.updateMany({
      where: { sourceId },
      data: { clearingStatus: status, updatedAt: new Date() },
    });
  }
}

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  CreateAcctEventDto,
  UpdateAcctEventDto,
  AcctEventQueryDto,
} from './dto/acct-event.dto';
import { Prisma } from '@prisma/client';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult, AuditTriggerType } from '../../audit-logging/dto/audit-log.dto';

@Injectable()
export class AcctEventsService {
  private readonly logger = new Logger(AcctEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async create(createDto: CreateAcctEventDto) {
    const existing = await this.prisma.acctEvent.findUnique({
      where: { eventCode: createDto.eventCode },
    });
    if (existing) {
      throw new BadRequestException(
        `Event code ${createDto.eventCode} already exists`,
      );
    }

    if (createDto.postingReversalOfEventCode) {
      const reversalTarget = await this.prisma.acctEvent.findUnique({
        where: { eventCode: createDto.postingReversalOfEventCode },
      });
      if (!reversalTarget) {
        throw new BadRequestException(
          `Posting reversal target event ${createDto.postingReversalOfEventCode} not found`,
        );
      }
    }

    const created = await this.prisma.acctEvent.create({
      data: createDto,
    });

    await this.auditLogsService.recordSystem({
      triggerType: AuditTriggerType.CONFIG_CHANGE,
      action: AuditActions.ACCT_EVENT_UPDATED,
      entityType: AuditEntityTypes.ACCT_EVENT,
      entityId: created.id,
      result: AuditResult.SUCCESS,
      reason: 'Accounting event created',
      sourcePlatform: 'ADMIN_API',
    });

    return created;
  }

  async findAll(query: AcctEventQueryDto) {
    const {
      skip,
      take,
      eventCode,
      entityType,
      ownerScope,
      assetType,
      triggerType,
      isActive,
    } = query;
    const where: Prisma.AcctEventWhereInput = {};

    if (eventCode) where.eventCode = { contains: eventCode };
    if (entityType) where.entityType = entityType;
    if (ownerScope) where.ownerScope = ownerScope;
    if (assetType) where.assetType = assetType;
    if (triggerType) where.triggerType = triggerType;
    if (isActive) where.isActive = isActive === 'true';

    const [items, total] = await Promise.all([
      this.prisma.acctEvent.findMany({
        skip: skip ? Number(skip) : 0,
        take: take ? Number(take) : 20,
        where,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.acctEvent.count({ where }),
    ]);

    return { items, total };
  }

  async findOne(eventCode: string) {
    const item = await this.prisma.acctEvent.findUnique({
      where: { eventCode },
      include: {
        postingReversalEvent: true,
        clearingReversalEvent: true,
      },
    });
    if (!item) throw new NotFoundException('AcctEvent not found');
    return item;
  }

  async update(eventCode: string, updateDto: UpdateAcctEventDto) {
    const before = await this.prisma.acctEvent.findUnique({
      where: { eventCode },
    });
    if (!before) {
      throw new NotFoundException('AcctEvent not found');
    }

    try {
      const updated = await this.prisma.acctEvent.update({
        where: { eventCode },
        data: updateDto,
      });

      await this.auditLogsService.recordSystem({
        triggerType: AuditTriggerType.CONFIG_CHANGE,
        action: AuditActions.ACCT_EVENT_UPDATED,
        entityType: AuditEntityTypes.ACCT_EVENT,
        entityId: updated.id,
        result: AuditResult.SUCCESS,
        reason: 'Accounting event updated',
        sourcePlatform: 'ADMIN_API',
      });

      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025')
          throw new NotFoundException('AcctEvent not found');
      }
      throw error;
    }
  }

  async remove(eventCode: string) {
    // Soft delete by setting isActive to false
    return this.update(eventCode, { isActive: false });
  }
}

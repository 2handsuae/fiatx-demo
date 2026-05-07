import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  CreateJournalHeaderTemplateDto,
  UpdateJournalHeaderTemplateDto,
  JournalHeaderTemplateQueryDto,
} from './dto/journal-header-template.dto';
import { Prisma } from '@prisma/client';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';

@Injectable()
export class JournalHeaderTemplatesService {
  private readonly logger = new Logger(JournalHeaderTemplatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async create(createDto: CreateJournalHeaderTemplateDto) {
    const existing = await this.prisma.journalHeaderTemplate.findUnique({
      where: { templateCode: createDto.templateCode },
    });
    if (existing) {
      throw new BadRequestException(
        `Template code ${createDto.templateCode} already exists`,
      );
    }

    // Verify relations
    const event = await this.prisma.acctEvent.findUnique({
      where: { eventCode: createDto.eventCode },
    });
    if (!event)
      throw new BadRequestException(
        `Event code ${createDto.eventCode} not found`,
      );

    const asset = await this.prisma.asset.findUnique({
      where: { id: createDto.baseAssetId },
    });
    if (!asset)
      throw new BadRequestException(
        `Asset ID ${createDto.baseAssetId} not found`,
      );

    const created = await this.prisma.journalHeaderTemplate.create({
      data: createDto,
    });

    await this.auditLogsService.recordSystem({

      action: AuditActions.JOURNAL_TEMPLATE_UPDATED,
      entityType: AuditEntityTypes.JOURNAL_HEADER_TEMPLATE,
      entityId: created.id,
      entityNo: created.templateCode,
      result: AuditResult.SUCCESS,
      reason: 'Journal header template created',
      sourcePlatform: 'ADMIN_API',
    });

    return created;
  }

  async findAll(query: JournalHeaderTemplateQueryDto) {
    const { skip, take, templateCode, eventCode, status } = query;
    const where: Prisma.JournalHeaderTemplateWhereInput = {};

    if (templateCode) where.templateCode = { contains: templateCode };
    if (eventCode) where.eventCode = eventCode;
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      this.prisma.journalHeaderTemplate.findMany({
        skip: skip ? Number(skip) : 0,
        take: take ? Number(take) : 20,
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          acctEvent: true,
          baseAsset: true,
        },
      }),
      this.prisma.journalHeaderTemplate.count({ where }),
    ]);

    return { items, total };
  }

  async findOne(id: string) {
    const item = await this.prisma.journalHeaderTemplate.findUnique({
      where: { id },
      include: {
        acctEvent: true,
        baseAsset: true,
      },
    });
    if (!item) throw new NotFoundException('Template not found');
    return item;
  }

  async update(id: string, updateDto: UpdateJournalHeaderTemplateDto) {
    const before = await this.findOne(id);
    if (updateDto.baseAssetId) {
      const asset = await this.prisma.asset.findUnique({
        where: { id: updateDto.baseAssetId },
      });
      if (!asset)
        throw new BadRequestException(
          `Asset ID ${updateDto.baseAssetId} not found`,
        );
    }

    try {
      const updated = await this.prisma.journalHeaderTemplate.update({
        where: { id },
        data: updateDto,
      });

      await this.auditLogsService.recordSystem({
  
        action: AuditActions.JOURNAL_TEMPLATE_UPDATED,
        entityType: AuditEntityTypes.JOURNAL_HEADER_TEMPLATE,
        entityId: updated.id,
        entityNo: updated.templateCode,
        result: AuditResult.SUCCESS,
        reason: 'Journal header template updated',
        sourcePlatform: 'ADMIN_API',
      });

      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025')
          throw new NotFoundException('Template not found');
      }
      throw error;
    }
  }

  async remove(id: string) {
    return this.update(id, { status: 'INACTIVE' as any }); // Or actual delete if preferred
  }
}

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  CreateJournalLineTemplateDto,
  UpdateJournalLineTemplateDto,
  JournalLineTemplateQueryDto,
} from './dto/journal-line-template.dto';
import { Prisma } from '@prisma/client';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult, AuditTriggerType } from '../../audit-logging/dto/audit-log.dto';

@Injectable()
export class JournalLineTemplatesService {
  private readonly logger = new Logger(JournalLineTemplatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async create(createDto: CreateJournalLineTemplateDto) {
    // 1. Validate Header Template
    const header = await this.prisma.journalHeaderTemplate.findUnique({
      where: { id: createDto.templateId },
    });
    if (!header)
      throw new BadRequestException(
        `Journal Header Template ${createDto.templateId} not found`,
      );

    // 2. Validate COA
    const coa = await this.prisma.coa.findUnique({
      where: { code: createDto.accountCode },
    });
    if (!coa)
      throw new BadRequestException(
        `Account Code ${createDto.accountCode} not found`,
      );

    // 3. Check Uniqueness
    const existing = await this.prisma.journalLineTemplate.findUnique({
      where: {
        templateId_lineNo: {
          templateId: createDto.templateId,
          lineNo: createDto.lineNo,
        },
      },
    });
    if (existing)
      throw new BadRequestException(
        `Line No ${createDto.lineNo} already exists for this template`,
      );

    const created = await this.prisma.journalLineTemplate.create({
      data: {
        ...createDto,
        dimensionsRule: createDto.dimensionsRule || '{}',
      },
    });

    await this.auditLogsService.recordSystem({
      triggerType: AuditTriggerType.CONFIG_CHANGE,
      action: AuditActions.JOURNAL_TEMPLATE_UPDATED,
      module: AuditModules.JOURNAL_LINE_TEMPLATES,
      entityType: AuditEntityTypes.JOURNAL_LINE_TEMPLATE,
      entityId: created.id,
      result: AuditResult.SUCCESS,
      reason: 'Journal line template created',
      afterData: {
        templateId: created.templateId,
        lineNo: created.lineNo,
        accountCode: created.accountCode,
      },
      sourcePlatform: 'ADMIN_API',
    });

    return created;
  }

  async findAll(query: JournalLineTemplateQueryDto) {
    const where: Prisma.JournalLineTemplateWhereInput = {};
    if (query.templateId) where.templateId = query.templateId;

    return this.prisma.journalLineTemplate.findMany({
      where,
      orderBy: { lineNo: 'asc' },
      include: {
        account: true,
      },
    });
  }

  async findOne(id: string) {
    const item = await this.prisma.journalLineTemplate.findUnique({
      where: { id },
      include: {
        account: true,
      },
    });
    if (!item) throw new NotFoundException('Line Template not found');
    return item;
  }

  async update(id: string, updateDto: UpdateJournalLineTemplateDto) {
    const before = await this.findOne(id);
    if (updateDto.accountCode) {
      const coa = await this.prisma.coa.findUnique({
        where: { code: updateDto.accountCode },
      });
      if (!coa)
        throw new BadRequestException(
          `Account Code ${updateDto.accountCode} not found`,
        );
    }

    try {
      const updated = await this.prisma.journalLineTemplate.update({
        where: { id },
        data: updateDto,
      });

      await this.auditLogsService.recordSystem({
        triggerType: AuditTriggerType.CONFIG_CHANGE,
        action: AuditActions.JOURNAL_TEMPLATE_UPDATED,
        module: AuditModules.JOURNAL_LINE_TEMPLATES,
        entityType: AuditEntityTypes.JOURNAL_LINE_TEMPLATE,
        entityId: updated.id,
        result: AuditResult.SUCCESS,
        reason: 'Journal line template updated',
        beforeData: {
          templateId: before.templateId,
          lineNo: before.lineNo,
          accountCode: before.accountCode,
          drCr: before.drCr,
        },
        afterData: {
          templateId: updated.templateId,
          lineNo: updated.lineNo,
          accountCode: updated.accountCode,
          drCr: updated.drCr,
        },
        sourcePlatform: 'ADMIN_API',
      });

      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025')
          throw new NotFoundException('Line Template not found');
      }
      throw error;
    }
  }

  async remove(id: string) {
    const before = await this.findOne(id);
    try {
      const deleted = await this.prisma.journalLineTemplate.delete({
        where: { id },
      });
      await this.auditLogsService.recordSystem({
        triggerType: AuditTriggerType.CONFIG_CHANGE,
        action: AuditActions.JOURNAL_TEMPLATE_UPDATED,
        module: AuditModules.JOURNAL_LINE_TEMPLATES,
        entityType: AuditEntityTypes.JOURNAL_LINE_TEMPLATE,
        entityId: id,
        result: AuditResult.SUCCESS,
        reason: 'Journal line template deleted',
        beforeData: {
          templateId: before.templateId,
          lineNo: before.lineNo,
          accountCode: before.accountCode,
        },
        sourcePlatform: 'ADMIN_API',
      });
      return deleted;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025')
          throw new NotFoundException('Line Template not found');
      }
      throw error;
    }
  }

  // Helper to reorder lines if needed (not strictly required but good to have)
  async reorderLines(
    templateId: string,
    lines: { id: string; lineNo: number }[],
  ) {
    // Transactional update
    return this.prisma.$transaction(
      lines.map((line) =>
        this.prisma.journalLineTemplate.update({
          where: { id: line.id },
          data: { lineNo: line.lineNo },
        }),
      ),
    );
  }
}

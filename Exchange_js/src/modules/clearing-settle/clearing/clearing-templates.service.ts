import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CreateClearingTemplateDto, UpdateClearingTemplateDto, QueryClearingTemplateDto } from './dto/clearing.dto';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult, AuditTriggerType } from '../../audit-logging/dto/audit-log.dto';

@Injectable()
export class ClearingTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async create(dto: CreateClearingTemplateDto) {
    const { lineTemplates, ...headerData } = dto;
    const created = await this.prisma.clearingTemplate.create({
      data: {
        ...headerData,
        lineTemplates: lineTemplates ? {
          create: lineTemplates
        } : undefined
      },
      include: {
        lineTemplates: true
      }
    });
    await this.auditLogsService.recordSystem({
      triggerType: AuditTriggerType.CONFIG_CHANGE,
      action: AuditActions.CLEARING_TEMPLATE_UPDATED,
      module: AuditModules.CLEARING_TEMPLATES,
      entityType: AuditEntityTypes.CLEARING_TEMPLATE,
      entityId: created.id,
      entityNo: created.code,
      result: AuditResult.SUCCESS,
      reason: 'Clearing template created',
      afterData: {
        code: created.code,
        isEnabled: created.isEnabled,
        lineTemplateCount: created.lineTemplates?.length || 0,
      },
      sourcePlatform: 'ADMIN_API',
    });
    return created;
  }

  async findAll(query: QueryClearingTemplateDto) {
    const { skip = 0, take = 10, code, status } = query;
    const where: any = {};
    if (code) {
      where.code = { contains: code };
    }
    if (status) {
      where.isEnabled = status === 'ACTIVE';
    }

    const [items, total] = await Promise.all([
      this.prisma.clearingTemplate.findMany({
        where,
        skip,
        take,
        orderBy: { updatedAt: 'desc' },
        include: { lineTemplates: true }
      }),
      this.prisma.clearingTemplate.count({ where })
    ]);

    return { items, total };
  }

  async findOne(id: string) {
    const template = await this.prisma.clearingTemplate.findUnique({
      where: { id },
      include: { lineTemplates: true }
    });
    if (!template) {
      throw new NotFoundException(`Clearing template with ID ${id} not found`);
    }
    return template;
  }

  async update(id: string, dto: UpdateClearingTemplateDto) {
    const { lineTemplates, ...headerData } = dto;
    const before = await this.findOne(id);
    
    // For simplicity in MVP, if lineTemplates provided, we replace all existing ones
    if (lineTemplates) {
      await this.prisma.clearingLineTemplate.deleteMany({
        where: { clearingTemplateId: id }
      });
    }

    const updated = await this.prisma.clearingTemplate.update({
      where: { id },
      data: {
        ...headerData,
        lineTemplates: lineTemplates ? {
          create: lineTemplates
        } : undefined
      },
      include: {
        lineTemplates: true
      }
    });
    await this.auditLogsService.recordSystem({
      triggerType: AuditTriggerType.CONFIG_CHANGE,
      action: AuditActions.CLEARING_TEMPLATE_UPDATED,
      module: AuditModules.CLEARING_TEMPLATES,
      entityType: AuditEntityTypes.CLEARING_TEMPLATE,
      entityId: updated.id,
      entityNo: updated.code,
      result: AuditResult.SUCCESS,
      reason: 'Clearing template updated',
      beforeData: {
        code: before.code,
        isEnabled: before.isEnabled,
        lineTemplateCount: before.lineTemplates?.length || 0,
      },
      afterData: {
        code: updated.code,
        isEnabled: updated.isEnabled,
        lineTemplateCount: updated.lineTemplates?.length || 0,
      },
      sourcePlatform: 'ADMIN_API',
    });
    return updated;
  }

  async remove(id: string) {
    const before = await this.findOne(id);
    const deleted = await this.prisma.clearingTemplate.delete({
      where: { id }
    });
    await this.auditLogsService.recordSystem({
      triggerType: AuditTriggerType.CONFIG_CHANGE,
      action: AuditActions.CLEARING_TEMPLATE_UPDATED,
      module: AuditModules.CLEARING_TEMPLATES,
      entityType: AuditEntityTypes.CLEARING_TEMPLATE,
      entityId: id,
      entityNo: before.code,
      result: AuditResult.SUCCESS,
      reason: 'Clearing template deleted',
      beforeData: {
        code: before.code,
        isEnabled: before.isEnabled,
      },
      sourcePlatform: 'ADMIN_API',
    });
    return deleted;
  }
}

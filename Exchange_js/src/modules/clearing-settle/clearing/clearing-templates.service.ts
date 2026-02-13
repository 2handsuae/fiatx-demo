import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CreateClearingTemplateDto, UpdateClearingTemplateDto, QueryClearingTemplateDto } from './dto/clearing.dto';

@Injectable()
export class ClearingTemplatesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateClearingTemplateDto) {
    const { lineTemplates, ...headerData } = dto;
    return this.prisma.clearingTemplate.create({
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
    
    // For simplicity in MVP, if lineTemplates provided, we replace all existing ones
    if (lineTemplates) {
      await this.prisma.clearingLineTemplate.deleteMany({
        where: { clearingTemplateId: id }
      });
    }

    return this.prisma.clearingTemplate.update({
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
  }

  async remove(id: string) {
    return this.prisma.clearingTemplate.delete({
      where: { id }
    });
  }
}

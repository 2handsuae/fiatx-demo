import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CreateCoaDto, UpdateCoaDto, CoaQueryDto } from './dto/coa.dto';
import { Prisma } from '@prisma/client';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';

@Injectable()
export class CoaService {
  private readonly logger = new Logger(CoaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async create(createCoaDto: CreateCoaDto) {
    const { requiredTags, ...rest } = createCoaDto;

    // Check uniqueness
    const existing = await this.prisma.coa.findUnique({
      where: { code: createCoaDto.code },
    });
    if (existing) {
      throw new BadRequestException(
        `Coa with code ${createCoaDto.code} already exists`,
      );
    }

    const item = await this.prisma.coa.create({
      data: {
        ...rest,
        requiredTags: JSON.stringify(requiredTags || []),
      },
    });

    await this.auditLogsService.recordSystem({

      action: AuditActions.COA_CONFIG_UPDATED,
      entityType: AuditEntityTypes.COA,
      entityId: item.id,
      entityNo: item.code,
      result: AuditResult.SUCCESS,
      reason: 'COA created',
      sourcePlatform: 'ADMIN_API',
    });

    return {
      ...item,
      requiredTags: JSON.parse(item.requiredTags),
    };
  }

  async findAll(query: CoaQueryDto) {
    const { skip, take, code, name, sortBy, sortOrder } = query;
    const where: Prisma.CoaWhereInput = {};

    if (code) where.code = { contains: code };
    if (name) where.name = { contains: name };

    const orderBy: Prisma.CoaOrderByWithRelationInput = {};
    if (sortBy) {
      // Safe cast if we assume input is validated or we check allowed fields
      orderBy[sortBy as keyof Prisma.CoaOrderByWithRelationInput] =
        sortOrder || 'asc';
    } else {
      orderBy.code = 'asc';
    }

    const [items, total] = await Promise.all([
      this.prisma.coa.findMany({
        skip: skip ? Number(skip) : 0,
        take: take ? Number(take) : 20,
        where,
        orderBy,
      }),
      this.prisma.coa.count({ where }),
    ]);

    const parsedItems = items.map((item) => ({
      ...item,
      requiredTags: JSON.parse(item.requiredTags),
    }));

    return { items: parsedItems, total };
  }

  async findOne(id: string) {
    const item = await this.prisma.coa.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Coa not found');
    return {
      ...item,
      requiredTags: JSON.parse(item.requiredTags),
    };
  }

  async update(id: string, updateCoaDto: UpdateCoaDto) {
    const before = await this.findOne(id);
    const { requiredTags, ...rest } = updateCoaDto;
    const data: Prisma.CoaUpdateInput = { ...rest };

    if (requiredTags) {
      data.requiredTags = JSON.stringify(requiredTags);
    }

    try {
      const item = await this.prisma.coa.update({
        where: { id },
        data,
      });
      await this.auditLogsService.recordSystem({
  
        action: AuditActions.COA_CONFIG_UPDATED,
        entityType: AuditEntityTypes.COA,
        entityId: item.id,
        entityNo: item.code,
        result: AuditResult.SUCCESS,
        reason: 'COA updated',
        sourcePlatform: 'ADMIN_API',
      });
      return {
        ...item,
        requiredTags: JSON.parse(item.requiredTags),
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025')
          throw new NotFoundException('Coa not found');
      }
      throw error;
    }
  }

  async remove(id: string) {
    const before = await this.findOne(id);
    try {
      const deleted = await this.prisma.coa.delete({ where: { id } });
      await this.auditLogsService.recordSystem({
  
        action: AuditActions.COA_CONFIG_UPDATED,
        entityType: AuditEntityTypes.COA,
        entityId: deleted.id,
        entityNo: deleted.code,
        result: AuditResult.SUCCESS,
        reason: 'COA deleted',
        sourcePlatform: 'ADMIN_API',
      });
      return deleted;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025')
          throw new NotFoundException('Coa not found');
      }
      throw error;
    }
  }
}

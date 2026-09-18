import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { randomUUID } from 'crypto';
import { AdminPermissionGuard } from '../../modules/identity/access-control/admin-permission.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditLogsService } from './audit-logs.service';
import { AuditEntityTypes } from './constants/audit-actions.constant';
import {
  AuditActorContext,
  AuditCategory,
  AuditLogQueryDto,
  AuditSubjectRole,
} from './dto/audit-log.dto';

@ApiTags('Admin - Audit Logs')
@Controller('admin/audit-logs')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class AuditLogsController {
  constructor(
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private ensureAdmin(req: any): AuditActorContext {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }

    return {
      actorType: req.user.type,
      actorNo: req.user.userNo || 'UNKNOWN',
      actorDisplayName: req.user.userNo || 'UNKNOWN',
      actorRolesAtTime: [req.user.role || 'UNKNOWN'],
    };
  }

  @Get()
  @ApiOperation({ summary: 'List audit logs with filters' })
  async findAll(
    @Req() req: any,
    @Query(new ValidationPipe({ transform: true })) query: AuditLogQueryDto,
  ) {
    const actor = this.ensureAdmin(req);
    const result = await this.auditLogsService.findAll(query);

    // AUDIT_LOG_QUERIED：本批唯一允许 controller 直接写审计的例外——这个动作只存在于
    // controller 层，没有对应 workflow。词表声明 correlationMode=NONE（查询不属于任何
    // 业务旅程），不传 correlationId。写入用 recordByActor（写路径 createEventWithUniqueNo
    // → db.auditLogEvent.create），不会回头调 findAll，不会递归。
    //
    // requestId 必须现铸随机值，不能省略（不同于 brief 给的示意代码）：查询没有
    // primarySubjectType/primarySubjectNo/correlationId 可用于分辨两次不同的调用，
    // buildIdempotencyKey() 的六个组成部分在省略 requestId 时对任何两次查询都完全相同
    // （NA/NA/NO_CORRELATION/NO_REQUEST_ID 恒定），会导致除第一条外的所有
    // AUDIT_LOG_QUERIED 写入被幂等键静默去重——查询审计实质上只会落一条。
    //
    // .catch() 兜底：审计侧问题不能把一个本该 200 的只读列表查询变成 500
    // 只读列表查询的留痕不是 operator 持久化动作（铁律①管不到它），查询主流程不因审计写入失败而失败——此为本文件自立理据（2026-09-02 终审更正：原援引的账号锁定兜底先例已按法一纪律3拆除）。
    await this.auditLogsService
      .recordByActor(
        {
          action: 'AUDIT_LOG_QUERIED',
          actionDomain: 'AUDIT',
          category: AuditCategory.GOVERNANCE,
          isReadOnly: true,
          ownerCustomerNo: query.ownerCustomerNo,
          subjects: query.ownerCustomerNo
            ? [{ subjectType: AuditEntityTypes.CUSTOMER, subjectNo: query.ownerCustomerNo, subjectRole: AuditSubjectRole.OWNER }]
            : undefined,
          sourceIp: req.ip,
          userAgent: req.headers?.['user-agent'],
          endpoint: 'GET /admin/audit-logs',
          sourcePlatform: 'ADMIN_API',
          metadata: { query, hitCount: result.total },
          requestId: randomUUID(),
        },
        actor,
      )
      .catch(() => undefined);

    return result;
  }

  @Get(':eventNo')
  @ApiOperation({ summary: 'Get audit log detail by event no' })
  findOne(@Req() req: any, @Param('eventNo') eventNo: string) {
    this.ensureAdmin(req);
    return this.auditLogsService.findOne(eventNo);
  }
}

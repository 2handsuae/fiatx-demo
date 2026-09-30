// 战役丙波一 T4 · 通知两面控制器（client 面）。骨架照
// complaints.client.controller.ts 形状：`@Controller('client/me')` +
// `AuthGuard('jwt')` + ensureCustomer。三条路由不进 rbac.catalog（客户面零权限码）。
//
// customerId 取 req.user.userId（JWT payload.sub，内部 UUID），service 内借
// resolveOwner 查出 customerNo 再 where ownerCustomerNo——同订单通知发送路径一致的
// 归属查法，见 notifications.service.ts resolveOwner()。
//
// 标已读不写审计：spec §0 备案 3，铁律①的「operator 持久化动作」不含客户纯读位标记，
// 已在评审阶段确认，不在此处补审计调用。
import { Controller, ForbiddenException, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';

@ApiTags('Client - Notifications')
@Controller('client/me')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class NotificationsClientController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  @ApiOperation({ summary: 'List my notifications (paged, newest first)' })
  async list(@Req() req: any, @Query('skip') skip?: string, @Query('take') take?: string) {
    const customerId = this.ensureCustomer(req);
    return this.notifications.listForCustomer(
      customerId,
      skip ? Number(skip) : 0,
      take ? Number(take) : 20,
    );
  }

  @Get('notifications/unread-count')
  @ApiOperation({ summary: 'My unread notification count' })
  async unreadCount(@Req() req: any): Promise<{ count: number }> {
    const customerId = this.ensureCustomer(req);
    const count = await this.notifications.unreadCountForCustomer(customerId);
    return { count };
  }

  @Post('notifications/:id/read')
  @ApiOperation({ summary: 'Mark one of my notifications as read' })
  async markRead(@Req() req: any, @Param('id') id: string): Promise<{ ok: true }> {
    const customerId = this.ensureCustomer(req);
    await this.notifications.markReadForCustomer(customerId, id);
    return { ok: true };
  }

  private ensureCustomer(req: any): string {
    if (req.user?.type !== 'CUSTOMER') throw new ForbiddenException('Customer token required');
    return req.user.userId as string;
  }
}

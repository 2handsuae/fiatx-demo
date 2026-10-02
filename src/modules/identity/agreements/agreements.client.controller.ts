// 战役丙波三 T6 · 客户协议客户端三端点。薄壳：全部转调 AgreementsReadService。
//
// - current 公开（注册页未登录要取正文；demo 口径不做防刷）——与 auth/customer/register 同为不挂 guard 的先例。
// - me / consent 方法级挂 AuthGuard('jwt')（不能上类：类级 guard 会连带 current）；customer 提取照
//   notifications.client.controller.ts。
// - 三条路由不进 rbac.catalog（客户面零权限码，波一先例）。
// - 响应一律显式白名单取键，不 spread 整行：版本行的 status / publishedAt 等内部列不外漏。
// - consent 的版本归属 / 在途版禁拒等校验全在 T2 recordConsent，本控制器不再叠一层。
// - consent 的 source：弹窗与阅读页共用本端点（spec §3），靠 body 可选 source 区分 MODAL / PAGE，缺省 PAGE；
//   REGISTER 只由注册链路写，经本端点传 REGISTER 一律按 PAGE 落（审计 source 不可由客户端冒充注册口）。
import { Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgreementConsentAction, AgreementsReadService, AgreementVersionView } from './agreements-read.service';

/** 客户端看到的一版协议：只有这四键。 */
function toClientView(v: AgreementVersionView) {
  return { versionKey: v.versionKey, effectiveAt: v.effectiveAt, summary: v.summary, sections: v.sections };
}

@ApiTags('Client - Agreements')
@Controller('client/agreements')
export class AgreementsClientController {
  constructor(private readonly agreements: AgreementsReadService) {}

  @Get('current')
  @ApiOperation({ summary: 'Current effective customer agreement (public — the register page reads it before login)' })
  async current() {
    return toClientView(await this.agreements.getCurrentEffective());
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Effective + in-notice + previously superseded agreement versions (all with sections) and my consent state' })
  async me(@Req() req: any) {
    const { customerId } = this.ensureCustomer(req);
    const current = await this.agreements.getCurrentEffective();
    const pending = await this.agreements.getPendingPublished();
    const previous = await this.agreements.getPreviousSuperseded();
    const consent = await this.agreements.consentStateFor(customerId);
    return {
      current: toClientView(current),
      pending: pending ? toClientView(pending) : null,
      previous: previous ? toClientView(previous) : null,
      consent,
    };
  }

  @Post(':versionKey/consent')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Accept or decline an agreement version (ACCEPTED for effective / in-notice; DECLINED for effective only)' })
  async consent(
    @Req() req: any,
    @Param('versionKey') versionKey: string,
    @Body() body: { action: AgreementConsentAction; source?: 'MODAL' | 'PAGE' },
  ): Promise<void> {
    const customer = this.ensureCustomer(req);
    await this.agreements.recordConsent(customer, versionKey, body.action, body.source === 'MODAL' ? 'MODAL' : 'PAGE');
  }

  private ensureCustomer(req: any): { customerId: string; customerNo: string } {
    if (req.user?.type !== 'CUSTOMER') throw new ForbiddenException('Customer token required');
    return { customerId: req.user.userId as string, customerNo: req.user.userNo as string };
  }
}

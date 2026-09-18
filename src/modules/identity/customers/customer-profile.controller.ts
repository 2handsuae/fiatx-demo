import { Controller, ForbiddenException, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CustomerAccessService } from './customer-access.service';

/**
 * 客户端「我是谁 / 我被卡了什么」投影（站6 自 OnboardingCustomerController 迁入）。
 *
 * 一期入驻流程拆除（业主方案2）时发现 `/onboarding/me` 是客户端全局资料钩子
 * （useCustomerProfile → AuthContext / 限制横幅 / 资料页）的唯一数据源——二期活件
 * 寄居在一期路由下。端点迁回客户模块，URL 保持 `/onboarding/me` 不动（客户端零改）；
 * 一期专属字段（verification 编排 actions / 周期评审 cycle）客户端本就声明可选，
 * 响应里不再下发。
 *
 * tipping-off 红线（沿袭原实现头注）：响应只许 lifecycle / disclosedBlocked /
 * disclosed —— 含 SILENT（制裁）限制贡献的 blocked / openCount 出现在客户面
 * 即属通风报信。禁止在此处补字段。
 *
 * 波二加 submitted / canReapply 两个派生布尔（入驻会话事实，非限制账事实）；
 * 原始时间戳不下发——内部术语不出客户面。
 */
@ApiTags('Customer - Profile')
@Controller('onboarding')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class CustomerProfileController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customerAccess: CustomerAccessService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Get my profile, lifecycle and disclosed restrictions' })
  async getMe(@Req() req: any) {
    if (req.user?.type !== 'CUSTOMER') {
      throw new ForbiddenException('Customer token required');
    }
    const customerId = req.user.userId as string;
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: {
        customerNo: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        companyName: true,
        customerType: true,
        riskRating: true,
        eddRequired: true,
        tradingTier: true,
        createdAt: true,
        lastLoginAt: true,
        onboardingSubmittedAt: true,
        onboardingFinalRejectedAt: true,
      },
    });
    if (!customer) {
      throw new ForbiddenException('Customer not found');
    }
    const access = await this.customerAccess.resolve(customerId);
    const { onboardingSubmittedAt, onboardingFinalRejectedAt, ...profile } = customer;
    return {
      ...profile,
      lifecycle: access.lifecycle,
      disclosedBlocked: [...access.disclosedBlocked],
      disclosed: access.disclosed,
      submitted: onboardingSubmittedAt !== null,
      canReapply: onboardingFinalRejectedAt === null,
    };
  }
}

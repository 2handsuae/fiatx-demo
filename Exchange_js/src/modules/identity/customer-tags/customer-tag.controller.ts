import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../access-control/admin-permission.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { buildPermissionCode } from '../access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CustomerTagService } from './customer-tag.service';
import { CUSTOMER_TAG_DEFINITIONS } from './constants/customer-tag.constant';

@ApiTags('Admin - Customer Tags')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class CustomerTagController {
  constructor(
    private readonly customerTagService: CustomerTagService,
    private readonly prisma: PrismaService,
  ) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin access required');
    }
  }

  private buildAdminActor(req: any): ApprovalActorContext {
    const user = req.user;
    return {
      actorType: 'ADMIN',
      userId: user.userId || user.sub,
      userNo: user.userNo,
      role: user.role,
      roleCodes: user.roleCodes || (user.role ? [user.role] : []),
    };
  }

  private async resolveCustomerId(customerNo: string): Promise<string> {
    const customer = await this.prisma.customerMain.findFirst({
      where: { customerNo },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundException(`Customer ${customerNo} not found`);
    }
    return customer.id;
  }

  @Get('customer-tags/catalog')
  @ApiOperation({ summary: 'List the fixed customer tag registry (STATIC + DERIVED)' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/customer-tags/catalog'))
  getCatalog() {
    return CUSTOMER_TAG_DEFINITIONS;
  }

  @Get('customers/:customerNo/effective-tags')
  @ApiOperation({ summary: 'Get a customer\'s effective tags (explicit + derived) as of now' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/customers/:customerNo/effective-tags'))
  async getEffectiveTags(@Param('customerNo') customerNo: string) {
    const customerId = await this.resolveCustomerId(customerNo);
    const tags = await this.customerTagService.effectiveTags(customerId, new Date());
    return [...tags];
  }

  @Post('customers/:customerNo/tags')
  @ApiOperation({ summary: 'Assign a STATIC tag to a customer' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/customers/:customerNo/tags'))
  async assignTag(
    @Req() req: any,
    @Param('customerNo') customerNo: string,
    @Body() body: { tagCode: string },
  ) {
    this.ensureAdmin(req);
    const customerId = await this.resolveCustomerId(customerNo);
    return this.customerTagService.assign(customerId, body.tagCode, this.buildAdminActor(req));
  }

  @Delete('customers/:customerNo/tags/:tagCode')
  @ApiOperation({ summary: 'Revoke a STATIC tag from a customer' })
  @RequirePermissions(buildPermissionCode('DELETE', '/admin/customers/:customerNo/tags/:tagCode'))
  async revokeTag(
    @Req() req: any,
    @Param('customerNo') customerNo: string,
    @Param('tagCode') tagCode: string,
  ) {
    this.ensureAdmin(req);
    const customerId = await this.resolveCustomerId(customerNo);
    return this.customerTagService.revoke(customerId, tagCode, this.buildAdminActor(req));
  }
}

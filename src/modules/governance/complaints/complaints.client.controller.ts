// 战役甲波五 T5 · 投诉两面控制器（client 面）。逐行照
// material-requests.client.controller.ts 形状：`@Controller('client/me')` +
// `AuthGuard('jwt')` + ensureCustomer。三条路由不进 rbac.catalog（客户面零权限码）。
//
// Complaint.ownerCustomerNo 是业务键列（铁律⑥），本控制器取 req.user.userNo（JWT
// payload 的 customerNo，见 customer-auth.service.ts login() / jwt.strategy.ts
// validate()），不取 req.user.userId（内部 UUID）——同
// withdrawal-address.controller.ts customerNo 取法先例。
//
// 「别人的号 / 不存在的号统一查无」：ComplaintsService.getForCustomer 已经把两种情形都
// 收成同一个 NotFoundException（见该方法注释），本控制器不必像 material-requests 那样
// 另建一个「查无」哨兵值——直接转发、让异常原样冒出去即可。
import { Body, Controller, ForbiddenException, Get, Param, Post, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ComplaintsService } from './complaints.service';
import { SubmitComplaintBodyDto } from './dto/complaint.dto';

@ApiTags('Client - Complaints')
@Controller('client/me')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class ComplaintsClientController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Post('complaints')
  @ApiOperation({ summary: 'Submit a complaint' })
  async submit(@Req() req: any, @Body() dto: SubmitComplaintBodyDto): Promise<{ complaintNo: string }> {
    const customerNo = this.ensureCustomer(req);
    return this.complaints.submit(customerNo, dto);
  }

  @Get('complaints')
  @ApiOperation({ summary: 'List my complaints' })
  async listMine(@Req() req: any) {
    const customerNo = this.ensureCustomer(req);
    return this.complaints.listForCustomer(customerNo);
  }

  @Get('complaints/:complaintNo')
  @ApiOperation({ summary: 'My complaint detail (submitted, ack, journey timeline, final response)' })
  async getMine(@Req() req: any, @Param('complaintNo') complaintNo: string) {
    const customerNo = this.ensureCustomer(req);
    return this.complaints.getForCustomer(customerNo, complaintNo);
  }

  private ensureCustomer(req: any): string {
    if (req.user?.type !== 'CUSTOMER') throw new ForbiddenException('Customer token required');
    return req.user.userNo as string;
  }
}

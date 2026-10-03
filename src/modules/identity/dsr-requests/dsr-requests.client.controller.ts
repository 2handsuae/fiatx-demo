// 战役丙波四 T7 · DSR（资料请求）client 面三路由。样板 complaints.client.controller.ts：
// `client/me` 前缀 + JWT + ensureCustomer + ValidationPipe；三条路由不进 rbac.catalog（客户面零权限码）。
//
// 本面取 req.user.userId（JWT sub = customerMain.id）——DataSubjectRequest.customerId 是内部 id 列，
// 服务按它过滤「只列自己的」；对外一律 requestNo（铁律⑥），投影里零 id。
// tipping-off 红线（decisions:65）：dueAt 是内部办理时限，不下发——客户面只说"30 天内答复"，
// 投影在 DsrRequestsService.toClientRow（显式字段，无 select *）。
import { Body, Controller, ForbiddenException, Get, Param, Post, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientDsrRow, DsrRequestsService } from './dsr-requests.service';
import { SubmitDsrBodyDto } from './dsr-requests.dto';

@ApiTags('Client - Data Requests')
@Controller('client/me')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class DsrRequestsClientController {
  constructor(private readonly dsr: DsrRequestsService) {}

  @Post('dsr-requests')
  @ApiOperation({ summary: 'Submit a data request (access / rectification / erasure)' })
  async submit(@Req() req: any, @Body() dto: SubmitDsrBodyDto): Promise<{ requestNo: string }> {
    return this.dsr.submit({ id: this.ensureCustomer(req) }, dto);
  }

  @Get('dsr-requests')
  @ApiOperation({ summary: 'List my data requests' })
  async listMine(@Req() req: any): Promise<ClientDsrRow[]> {
    return this.dsr.listForCustomer(this.ensureCustomer(req));
  }

  @Get('dsr-requests/:requestNo')
  @ApiOperation({ summary: 'My data request detail (status, answer, data summary or clause reference)' })
  async getMine(@Req() req: any, @Param('requestNo') requestNo: string): Promise<ClientDsrRow> {
    return this.dsr.getForCustomer(this.ensureCustomer(req), requestNo);
  }

  private ensureCustomer(req: any): string {
    if (req.user?.type !== 'CUSTOMER') throw new ForbiddenException('Customer token required');
    return req.user.userId as string;
  }
}

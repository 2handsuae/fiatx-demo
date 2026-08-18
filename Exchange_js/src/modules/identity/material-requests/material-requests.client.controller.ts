import { Controller, ForbiddenException, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { MaterialRequestsService, type MaterialRequestRow } from './material-requests.service';
import { SumsubClient } from '../onboarding/providers/sumsub/sumsub.client';
import {
  materialLabel,
  type ClientMaterialRequestRow,
  type ClientVerificationSessionView,
} from './dto/material-request.dto';
import { MATERIAL_REQUEST_LIVE_STATUSES } from './constants/material-request.constant';

/** 「没什么可做」的统一回复。别人的号、不存在的号、已提交、已终态 —— 逐字相同。 */
const NOTHING_TO_DO: ClientVerificationSessionView = { submitted: true, sdkToken: null };

@ApiTags('Client - Material Requests')
@Controller('client/me')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class MaterialRequestsClientController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService & Record<string, any>,
    private readonly requests: MaterialRequestsService,
    private readonly sumsubClient: SumsubClient,
  ) {}

  @Get('material-requests')
  @ApiOperation({ summary: '我当前还欠着的材料（横幅与订单页都读这一个）' })
  async listMine(@Req() req: any): Promise<ClientMaterialRequestRow[]> {
    const customerId = this.ensureCustomer(req);
    const rows = await this.requests.listLiveByCustomer(customerId);
    return rows.map((r) => this.toClientRow(r));
  }

  @Get('material-requests/:requestNo/session')
  @ApiOperation({ summary: '取认证会话（模拟模式下 sdkToken 是 mock 值）' })
  async getSession(
    @Req() req: any,
    @Param('requestNo') requestNo: string,
  ): Promise<ClientVerificationSessionView> {
    const customerId = this.ensureCustomer(req);
    const row = await this.loadOwn(customerId, requestNo);
    // 不属于自己 / 不存在 / 已提交 / 已终态 —— 四种情形回同一句话。
    // 尤其不能对「别人的号」回 403：那等于确认了这个号真实存在。
    if (!row || row.status !== 'PENDING_SUBMISSION') return NOTHING_TO_DO;

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { sumsubApplicantId: true },
    });
    if (!customer?.sumsubApplicantId) return NOTHING_TO_DO;

    const { token } = await this.sumsubClient.createActionSdkToken({
      applicantId: customer.sumsubApplicantId,
      levelName: row.levelName,
      externalActionId: row.externalActionId,
      ttlInSecs: 600,
    });
    return { submitted: false, sdkToken: token };
  }

  @Post('material-requests/:requestNo/submit')
  @ApiOperation({ summary: '提交回执。幂等恒 2xx，不吐状态机信息' })
  async submit(@Req() req: any, @Param('requestNo') requestNo: string): Promise<{ ok: true }> {
    const customerId = this.ensureCustomer(req);
    const row = await this.loadOwn(customerId, requestNo);
    if (row) {
      await this.requests.markSubmitted(requestNo, {
        actorType: 'CUSTOMER',
        actorId: customerId,
        actorRole: 'CUSTOMER',
      });
    }
    // 无论落没落章都回同一句 —— 重复提交、别人的号、不存在的号，客户看到的一样
    return { ok: true };
  }

  private ensureCustomer(req: any): string {
    if (req.user?.type !== 'CUSTOMER') throw new ForbiddenException('Customer token required');
    return req.user.userId as string;
  }

  private async loadOwn(customerId: string, requestNo: string): Promise<MaterialRequestRow | null> {
    const row = await this.requests.findByNo(requestNo);
    return row && row.customerId === customerId ? row : null;
  }

  /**
   * G5 / spec I2：这个投影是客户面的唯一出口。
   * Sumsub 侧 id 与铸 token 的钥匙都不在里面 —— 由
   * material-request.contract.spec.ts 扫本文件源码守着，不靠人记得。
   */
  private toClientRow(r: MaterialRequestRow): ClientMaterialRequestRow {
    return {
      requestNo: r.requestNo,
      materialType: r.materialType,
      materialLabel: materialLabel(r.materialType),
      status: r.status as (typeof MATERIAL_REQUEST_LIVE_STATUSES)[number],
      blocking: r.restrictionNo !== null,
      orderDomain: r.orderDomain,
      orderRef: r.orderRef,
      reason: r.reason,
      issuedAt: r.issuedAt.toISOString(),
    };
  }
}

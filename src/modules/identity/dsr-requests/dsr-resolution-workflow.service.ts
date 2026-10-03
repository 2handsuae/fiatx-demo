// 战役丙波四 终审修 F1 · DSR 办结 workflow。
//
// 铁律③各管各的：DSR 办结横跨三个主体——DSR 自己（DsrRequestsService）、材料请求（MaterialRequestIssuerService，
// REVERIFY 才连带开单）、通知（NotificationsService）。跨主体协作只发生在 workflow，所以这套编排放这里，
// DsrRequestsService.resolve 只做本主体的事（校验 + 状态迁移 + 写 resolution 字段 + 审计）。本 workflow 只调
// 各主体已有的服务方法，不直写任何表、不重抄主体侧校验。
//
// 顺序固定（控制器裁定，与 spec §4.1 原文「先 resolve 后开单」相反）：
//   1. dsr.assertResolvable —— 本主体办结前置（迁移边 / resolutionCode×type / ACCESS 需摘要 / ERASURE 需条款）一次判完，
//      不过就 400，此时什么副作用都还没发生；
//   2. REVERIFY 才 issuer.issue —— 开 Emirates ID 重验材料单取号；开单失败（如 NO_SUMSUB_APPLICANT 400）则整个办结失败：
//      不落 resolve、不审计、不通知，单据仍 IN_REVIEW；
//   3. dsr.resolve(…, materialRequestNo) —— 落库 + 审计（带回材料请求号）；
//   4. notifyDsrResolved —— 持久物先于信号，通知是旁路副作用，抛错吞掉、不回滚办结。
// 反序（先 resolve 后开单）会在开单失败时留下「已办结却没有材料单」的悬空态，所以先开单。
import { Injectable } from '@nestjs/common';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { MaterialRequestIssuerService } from '../material-requests/material-request-issuer.service';
import { DsrResolutionCode } from './dsr.constants';
import { DsrRequestsService, DsrResolveInput } from './dsr-requests.service';

@Injectable()
export class DsrResolutionWorkflowService {
  constructor(
    private readonly dsr: DsrRequestsService,
    private readonly materialRequestIssuer: MaterialRequestIssuerService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async resolve(actor: ApprovalActorContext, requestNo: string, dto: DsrResolveInput): Promise<{ requestNo: string }> {
    const { row } = await this.dsr.assertResolvable(requestNo, dto);

    // RECTIFICATION_REVERIFY：连带开材料请求（Emirates ID 重验）。不挂限制（restrict:false，纯提醒式补料）；
    // 话术中性，只引 DSR 单号。
    let materialRequestNo: string | null = null;
    if (dto.resolutionCode === DsrResolutionCode.RECTIFICATION_REVERIFY) {
      ({ requestNo: materialRequestNo } = await this.materialRequestIssuer.issue({
        customerId: row.customerId,
        materialType: 'EMIRATES_ID',
        orderDomain: null,
        orderRef: null,
        restrict: false,
        origin: 'OPERATOR_ISSUED',
        reason: `Please re-verify your identity details following your data request ${requestNo}.`,
        issuedBy: actor.userNo ?? actor.userId,
        actor,
      }));
    }

    const result = await this.dsr.resolve(actor, requestNo, dto, materialRequestNo);

    try {
      await this.notificationsService.notifyDsrResolved({ customerId: row.customerId, requestNo });
    } catch (err) {
      console.error(`[DsrResolutionWorkflowService] notifyDsrResolved failed for ${requestNo}:`, err);
    }
    return result;
  }
}

// 战役甲波二 · 事件联动（Task 6）：定损→自动开单编排点。
// 铁律③：跨主体协作只发生在 workflow——本服务先驱动 IncidentService.assess 完成事故自己的
// 判定留痕（INCIDENT_ASSESSED 审计不动，reportRequired/reportBasisCodes 仍是判定的一部分），
// reportRequired=true 时再横向调用 RegulatoryFilingService.openForIncident 按勾选的依据码
// 逐码开报送单——通报是事故定损结论的直接产物，不是另一段跨主体审批往返，故不经
// createAndSubmit（区别于 IncidentCloseWorkflowService 那种真审批编排）。
// 头注释体例照 incident-registration-workflow.service.ts。
import { Injectable } from '@nestjs/common';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import { AssessIncidentDto } from './incident.constants';
import { IncidentService } from './incident.service';
import { RegulatoryFilingService } from '../regulatory-filings/regulatory-filing.service';

@Injectable()
export class IncidentAssessmentWorkflowService {
  constructor(
    private readonly incidents: IncidentService,
    private readonly filings: RegulatoryFilingService,
  ) {}

  async assess(incidentNo: string, dto: AssessIncidentDto, actor: ApprovalActorContext): Promise<{ incidentNo: string; status: string; filingsOpened: string[] }> {
    const result = await this.incidents.assess(incidentNo, dto, actor); // 判定留痕照旧（INCIDENT_ASSESSED）
    let filingsOpened: string[] = [];
    if (dto.reportRequired) {
      const row = await this.incidents.findByNo(incidentNo);
      filingsOpened = (await this.filings.openForIncident(row, dto.reportBasisCodes ?? [], actor)).filingNos;
    }
    return { incidentNo, status: result.status, filingsOpened };
  }
}

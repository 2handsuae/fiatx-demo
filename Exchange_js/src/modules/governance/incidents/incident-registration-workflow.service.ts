// 平账三期 · 事故登记编排点（plan Task 5 Step 3 架构裁决）。
// 铁律③：跨主体写只在 workflow——定性行 reconciliationDisposition.incidentNo 是对账主体的数据，
// 不许在 IncidentService 里直写。本服务编排两步：① 建事故单（IncidentService.register，只写
// incidents 自己的表）；② 未授权转出类型才需要写回定性行，调用 Task 9 在 disposition 侧新增的
// DispositionService.attachIncident（本任务先以接口 mock 测，Task 9 落真）。
import { Inject, Injectable } from '@nestjs/common';
import { IncidentTypes, RegisterIncidentDto } from './incident.constants';
import { IncidentService } from './incident.service';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import { RecordDispositionDto } from '../../clearing-settle/reconciliation/dto/disposition.dto';

/**
 * Task 9 先行提供该方法签名（disposition.service.ts 新增）：
 *   attachIncident(dispositionNo: string, incidentNo: string): Promise<void>
 * 只写 incidentNo 一列、已占用则 409。本任务只声明接口 + 用 mock 测试调用契约；
 * 真实实现与 DI 接线见 incidents.module.ts 顶部注释。
 */
export interface DispositionIncidentLink {
  attachIncident(dispositionNo: string, incidentNo: string): Promise<void>;
  /**
   * 平账三期 Task 3 续作（事故路原子落定性，控制方拍板提案 1）：UNAUTHORIZED_OUTFLOW
   * 缺 sourceDispositionNo、但带 explainedExternalLineId+findingNote 时，workflow 先调
   * 这个方法把定性落库，再拿 dispositionNo 顶上 sourceDispositionNo 走原有
   * incidents.register() 流程。causeCode/matchType/disposition 三者在 register() 里定死
   * （UNAUTHORIZED_OUTFLOW 是 INCIDENT 出口唯一码、只锚外部行），不开放调用方另传组合。
   */
  record(dto: RecordDispositionDto & { caseNo: string }, actor: ApprovalActorContext): Promise<{ dispositionNo: string }>;
}

export const DISPOSITION_INCIDENT_LINK = 'DISPOSITION_INCIDENT_LINK';

@Injectable()
export class IncidentRegistrationWorkflowService {
  constructor(
    private readonly incidents: IncidentService,
    @Inject(DISPOSITION_INCIDENT_LINK) private readonly dispositionLink: DispositionIncidentLink,
  ) {}

  /** 事故登记的真正入口（HTTP 层调这个，不直接调 IncidentService.register）。 */
  async register(dto: RegisterIncidentDto, actor: ApprovalActorContext): Promise<{ incidentNo: string }> {
    let effectiveDto = dto;
    // 原子路（Task 3 续作）：UNAUTHORIZED_OUTFLOW 且没带 sourceDispositionNo，但带了
    // 定性所需的两个新字段——先落定性，再拿新出的 dispositionNo 顶上，走回原有校验/建单。
    // 两者都没带则原样落到下面的 incidents.register()，走既有的 400（话术不变）。
    if (
      dto.type === IncidentTypes.UNAUTHORIZED_OUTFLOW &&
      !dto.sourceDispositionNo &&
      dto.explainedExternalLineId &&
      dto.findingNote
    ) {
      const { dispositionNo } = await this.dispositionLink.record(
        {
          caseNo: dto.sourceCaseNo as string,
          matchType: 'ORPHAN_EXTERNAL',
          explainedExternalLineId: dto.explainedExternalLineId,
          causeCode: 'UNAUTHORIZED_OUTFLOW',
          disposition: 'INCIDENT',
          findingNote: dto.findingNote,
        },
        actor,
      );
      effectiveDto = { ...dto, sourceDispositionNo: dispositionNo };
    }

    const { incidentNo } = await this.incidents.register(effectiveDto, actor);
    if (effectiveDto.type === IncidentTypes.UNAUTHORIZED_OUTFLOW) {
      // register() 里已校验 sourceDispositionNo 非空且定性行合法（原子路的 dispositionNo
      // 刚从 record() 建出，天然满足），这里必然存在。
      await this.dispositionLink.attachIncident(effectiveDto.sourceDispositionNo as string, incidentNo);
    }
    return { incidentNo };
  }
}

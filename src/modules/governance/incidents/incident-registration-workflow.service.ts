// 平账三期 · 事故登记编排点（plan Task 5 Step 3 架构裁决）。
// 铁律③：跨主体写只在 workflow——定性行 reconciliationDisposition.incidentNo 是对账主体的数据，
// 不许在 IncidentService 里直写。本服务编排两步：① 建事故单（IncidentService.register，只写
// incidents 自己的表）；② 未授权转出类型才需要写回定性行，调用 Task 9 在 disposition 侧新增的
// DispositionService.attachIncident（本任务先以接口 mock 测，Task 9 落真）。
import { Inject, Injectable } from '@nestjs/common';
import { IncidentTypes, RegisterIncidentDto } from './incident.constants';
import { IncidentService } from './incident.service';
import { getIncidentTypeConfig } from './incident-type-registry';
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
    // 战役甲波五 T4 修复轮1（评审 Minor 2）：人工登记拒绝清单必须先于 assertOperator——
    // 否则一个不持经办能力的 actor 会先吃 403，永远到不了 IncidentService.register()
    // 内部的那条 400，清单对非运营 actor 形同虚设（门被权限检查挡在前面）。
    this.incidents.assertManuallyRegistrable(dto.type);
    // 甲波一 T5 修1（M1 修复）：经办桶断言必须先于任何跨主体写。下面的原子路
    // （UNAUTHORIZED_OUTFLOW 缺 sourceDispositionNo 时）会先调 dispositionLink.record()
    // 把定性行落库，再拿新出的 dispositionNo 顶上走 incidents.register()——若断言留在
    // IncidentService.register() 内部才做，一个不持经办桶的 actor 会先把定性行写出来，
    // 才在下一步 403，留下一条永远等不到 incidentNo 回填的孤儿定性行。断言前移到这里，
    // 防在任何写之前（IncidentService.register() 内部仍保留同一断言，两处都过、非互斥）。
    await this.incidents.assertOperator(getIncidentTypeConfig(dto.type), actor);
    let effectiveDto = dto;
    // 原子路（Task 3 续作）：UNAUTHORIZED_OUTFLOW 且没带 sourceDispositionNo，但带了
    // 定性所需的两个新字段——先落定性，再拿新出的 dispositionNo 顶上，走回原有校验/建单。
    // 两者都没带则原样落到下面的 incidents.register()，走既有的 400（话术不变）。
    //
    // 评审修复（Important 2）：补 `dto.sourceCaseNo` 合取——此前守卫没查它，缺
    // sourceCaseNo 但带了 explainedExternalLineId+findingNote 时会把 `caseNo: undefined`
    // 喂进 dispositionLink.record()，在 reconciliationCase.findUnique 上炸出一个裸
    // Prisma 错误。补上这一条，缺 sourceCaseNo 就落回下面既有的干净 400（话术不变）。
    if (
      dto.type === IncidentTypes.UNAUTHORIZED_OUTFLOW &&
      !dto.sourceDispositionNo &&
      dto.sourceCaseNo &&
      dto.explainedExternalLineId &&
      dto.findingNote
    ) {
      const { dispositionNo } = await this.dispositionLink.record(
        {
          caseNo: dto.sourceCaseNo,
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
    // 评审修复（C1 挂接链）：此前只罩 UNAUTHORIZED_OUTFLOW 一种类型——LARGE_UNEXPLAINED
    // 升级路（案件页 Escalate to incident 带 sourceDispositionNo）从头到尾没人把事故号
    // 写回定性行，Task 4 放宽的读/写闸（union 条件）在运行系统里永远触发不到。放宽成
    // 「带了 sourceDispositionNo 就 attach」——register() 已经按类型校验过它指向的定性
    // 行合法（UNAUTHORIZED_OUTFLOW 走 assertUnauthorizedOutflow，LARGE_UNEXPLAINED 若
    // 带了它走 assertLargeUnexplained 新增的可选行级校验，见 incident.service.ts），
    // attachIncident 自带存在性 + 重复挂接校验，这里零改动、直接复用。
    if (effectiveDto.sourceDispositionNo) {
      await this.dispositionLink.attachIncident(effectiveDto.sourceDispositionNo, incidentNo);
    }
    return { incidentNo };
  }
}

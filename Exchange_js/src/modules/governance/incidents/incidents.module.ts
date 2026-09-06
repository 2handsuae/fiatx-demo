// 平账三期 · 事故登记（治理件）模块骨架。
import { ConflictException, Injectable, Module, NotFoundException } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { IncidentService } from './incident.service';
import { DISPOSITION_INCIDENT_LINK, DispositionIncidentLink, IncidentRegistrationWorkflowService } from './incident-registration-workflow.service';

/**
 * 占位适配器——Task 9 落地 disposition.service.ts 的 attachIncident() 前，本模块用它顶住
 * DISPOSITION_INCIDENT_LINK 这个 DI token（不然 IncidentsModule 注册进 GovernanceModule 后，
 * 整个后端在 Task 9 之前会因为解不出这个依赖直接起不来）。行为与 Task 9 brief 定的签名一致
 * （只写 incidentNo 一列、已占用则 409），单测走 mock 接口不经过这个类。
 * Task 9 落地后：把下面 providers 里的这一条换成从 ReconciliationModule 导入的真
 * DispositionService，删除本类。
 */
@Injectable()
class InterimDispositionIncidentLink implements DispositionIncidentLink {
  constructor(private readonly prisma: PrismaService) {}

  async attachIncident(dispositionNo: string, incidentNo: string): Promise<void> {
    const disp = await (this.prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo } });
    if (!disp) throw new NotFoundException(`定性行不存在：${dispositionNo}`);
    if (disp.incidentNo) throw new ConflictException(`定性行 ${dispositionNo} 已挂事故 ${disp.incidentNo}，不能再挂`);
    await (this.prisma as any).reconciliationDisposition.update({ where: { dispositionNo }, data: { incidentNo } });
  }
}

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [
    IncidentService,
    IncidentRegistrationWorkflowService,
    InterimDispositionIncidentLink,
    { provide: DISPOSITION_INCIDENT_LINK, useExisting: InterimDispositionIncidentLink },
  ],
  exports: [IncidentService, IncidentRegistrationWorkflowService],
})
export class IncidentsModule {}

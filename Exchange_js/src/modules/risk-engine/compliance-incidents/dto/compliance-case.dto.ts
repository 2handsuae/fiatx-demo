import {
  ComplianceIncidentActorContext,
  ComplianceIncidentQueryDto,
  CreateIncidentFromAlertDto,
  LinkIncidentAlertDto,
  UpdateComplianceIncidentActionDto,
} from './compliance-incident.dto';
import {
  FinalizeCaseReportDto,
  UpsertCaseReportDraftDto,
} from './compliance-incident-report.dto';

export class ComplianceCaseQueryDto extends ComplianceIncidentQueryDto {}

export class CreateCaseFromAlertDto extends CreateIncidentFromAlertDto {}

export class LinkCaseAlertDto extends LinkIncidentAlertDto {}

export class UpdateComplianceCaseActionDto extends UpdateComplianceIncidentActionDto {}

export class UpsertComplianceCaseReportDraftDto extends UpsertCaseReportDraftDto {}

export class FinalizeComplianceCaseReportDto extends FinalizeCaseReportDto {}

export interface ComplianceCaseActorContext
  extends ComplianceIncidentActorContext {}

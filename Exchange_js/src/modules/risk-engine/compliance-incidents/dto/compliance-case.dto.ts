import {
  ComplianceIncidentActorContext,
  ComplianceIncidentQueryDto,
  CreateIncidentFromAlertDto,
  LinkIncidentAlertDto,
  UpdateComplianceIncidentActionDto,
} from './compliance-incident.dto';
import {
  CloseCaseExternalFilingDto,
  FinalizeCaseReportDto,
  RecordCaseExternalFilingFeedbackDto,
  ReviewCaseByMlroDto,
  SubmitCaseExternalFilingDto,
  SubmitCaseToMlroDto,
  UpsertCaseReportDraftDto,
} from './compliance-incident-report.dto';

export class ComplianceCaseQueryDto extends ComplianceIncidentQueryDto {}

export class CreateCaseFromAlertDto extends CreateIncidentFromAlertDto {}

export class LinkCaseAlertDto extends LinkIncidentAlertDto {}

export class UpdateComplianceCaseActionDto extends UpdateComplianceIncidentActionDto {}

export class UpsertComplianceCaseReportDraftDto extends UpsertCaseReportDraftDto {}

export class FinalizeComplianceCaseReportDto extends FinalizeCaseReportDto {}

export class SubmitComplianceCaseToMlroDto extends SubmitCaseToMlroDto {}

export class ReviewComplianceCaseByMlroDto extends ReviewCaseByMlroDto {}

export class SubmitComplianceCaseExternalFilingDto extends SubmitCaseExternalFilingDto {}

export class RecordComplianceCaseExternalFilingFeedbackDto extends RecordCaseExternalFilingFeedbackDto {}

export class CloseComplianceCaseExternalFilingDto extends CloseCaseExternalFilingDto {}

export interface ComplianceCaseActorContext
  extends ComplianceIncidentActorContext {}

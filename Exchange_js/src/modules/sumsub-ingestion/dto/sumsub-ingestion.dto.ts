import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum SimulationScenario {
  LOW_RISK_PASS = 'LOW_RISK_PASS',
  MANUAL_REVIEW = 'MANUAL_REVIEW',
  RESUBMIT_REQUIRED = 'RESUBMIT_REQUIRED',
  EDD_ESCALATE = 'EDD_ESCALATE',
  EDD_PASS = 'EDD_PASS',
  WORKFLOW_FAIL = 'WORKFLOW_FAIL',
}

export class SimulateEventDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  customerNo?: string;

  @IsEnum(SimulationScenario)
  scenario!: SimulationScenario;

  @IsOptional()
  overrides?: Record<string, unknown>;
}

export class ListSumsubEventsQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  eventType?: string;

  @IsOptional()
  @IsString()
  externalUserId?: string;

  @IsOptional()
  @IsString()
  applicantId?: string;

  @IsOptional()
  skip?: number;

  @IsOptional()
  take?: number;
}

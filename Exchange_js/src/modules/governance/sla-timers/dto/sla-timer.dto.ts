import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  DEFAULT_SLA_DEMO_DUE_IN_SECONDS,
  SLA_TIMER_STATUS_VALUES,
  SLA_TIMER_SUBJECT_TYPE_VALUES,
  SLA_TIMER_TYPE_VALUES,
  SLA_TIMER_WORKFLOW_TYPE_VALUES,
} from '../constants/sla-timer.constants';

export class CloseSlaTimerDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  traceId?: string;
}

export class RecalcSlaTimerDto {
  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(86400)
  dueInSeconds?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(86400)
  graceSeconds?: number;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  traceId?: string;
}

export class MockApprovalTimeoutDto {
  @ApiPropertyOptional({ default: DEFAULT_SLA_DEMO_DUE_IN_SECONDS })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(86400)
  dueInSeconds?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(86400)
  graceSeconds?: number;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  traceId?: string;
}

export class MockChangeFollowUpDto {
  @ApiPropertyOptional({ default: DEFAULT_SLA_DEMO_DUE_IN_SECONDS })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(86400)
  dueInSeconds?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(86400)
  graceSeconds?: number;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  traceId?: string;

  @IsOptional()
  @IsString()
  releaseVersion?: string;

  @IsOptional()
  @IsBoolean()
  simulateDeployFailure?: boolean;
}

export class SlaTimerQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;

  @IsOptional()
  @IsString()
  timerNo?: string;

  @ApiPropertyOptional({ enum: SLA_TIMER_TYPE_VALUES })
  @IsOptional()
  @IsIn(SLA_TIMER_TYPE_VALUES)
  timerType?: string;

  @ApiPropertyOptional({ enum: SLA_TIMER_STATUS_VALUES })
  @IsOptional()
  @IsIn(SLA_TIMER_STATUS_VALUES)
  status?: string;

  @ApiPropertyOptional({ enum: SLA_TIMER_WORKFLOW_TYPE_VALUES })
  @IsOptional()
  @IsIn(SLA_TIMER_WORKFLOW_TYPE_VALUES)
  workflowType?: string;

  @IsOptional()
  @IsString()
  workflowNo?: string;

  @ApiPropertyOptional({ enum: SLA_TIMER_SUBJECT_TYPE_VALUES })
  @IsOptional()
  @IsIn(SLA_TIMER_SUBJECT_TYPE_VALUES)
  subjectType?: string;

  @IsOptional()
  @IsString()
  subjectNo?: string;

  @IsOptional()
  @IsString()
  ownerUserId?: string;

  @IsOptional()
  @IsString()
  traceId?: string;

  @IsOptional()
  @IsString()
  keyword?: string;
}

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
  CHANGE_TICKET_DEPLOY_STATUS_VALUES,
  CHANGE_TICKET_RELEASE_ENV_VALUES,
  CHANGE_TICKET_STATUS_VALUES,
  CHANGE_TICKET_TYPE_VALUES,
} from '../constants/change-ticket.constants';

export class CreateChangeTicketDto {
  @IsIn(CHANGE_TICKET_TYPE_VALUES)
  changeType!: string;

  @IsString()
  scopeSummary!: string;

  @IsString()
  testEvidenceRef!: string;

  @IsString()
  rollbackPlanRef!: string;

  @IsOptional()
  @IsBoolean()
  emergency?: boolean;

  @IsOptional()
  @IsString()
  emergencyReason?: string;

  @IsOptional()
  @IsDateString()
  postApprovalDueAt?: string;

  @IsOptional()
  @IsString()
  traceId?: string;
}

export class SubmitChangeTicketDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  traceId?: string;
}

export class ResubmitChangeTicketDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  traceId?: string;
}

export class CloseChangeTicketDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  traceId?: string;
}

export class GateCheckDto {
  @IsIn(CHANGE_TICKET_RELEASE_ENV_VALUES)
  targetEnv!: string;

  @IsString()
  releaseVersion!: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  traceId?: string;
}

export class MarkDeployStatusDto {
  @IsIn(CHANGE_TICKET_RELEASE_ENV_VALUES)
  targetEnv!: string;

  @IsString()
  releaseVersion!: string;

  @IsIn(CHANGE_TICKET_DEPLOY_STATUS_VALUES)
  deployStatus!: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  traceId?: string;
}

export class ChangeTicketQueryDto {
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
  ticketNo?: string;

  @ApiPropertyOptional({ enum: CHANGE_TICKET_STATUS_VALUES })
  @IsOptional()
  @IsIn(CHANGE_TICKET_STATUS_VALUES)
  status?: string;

  @ApiPropertyOptional({ enum: CHANGE_TICKET_TYPE_VALUES })
  @IsOptional()
  @IsIn(CHANGE_TICKET_TYPE_VALUES)
  changeType?: string;

  @IsOptional()
  @IsString()
  latestApprovalStatus?: string;

  @IsOptional()
  @IsString()
  traceId?: string;

  @IsOptional()
  @IsString()
  releaseVersion?: string;

  @IsOptional()
  @IsString()
  keyword?: string;
}

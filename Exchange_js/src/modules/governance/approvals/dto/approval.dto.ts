import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateApprovalDto {
  @IsString()
  actionType!: string;

  @IsString()
  entityRef!: string;

  @IsOptional()
  @IsString()
  docRef?: string;

  @ApiPropertyOptional({ type: Object, description: 'Frozen snapshot of the approval subject (request) at creation time' })
  @IsOptional()
  @IsObject()
  objectSnapshot?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  traceId?: string;

  @IsOptional()
  @IsString()
  workflowType?: string;

  @IsOptional()
  @IsString()
  workflowId?: string;

  @IsOptional()
  @IsString()
  workflowNo?: string;

  @IsOptional()
  @IsString()
  checkerRole?: string;
}

export class SubmitApprovalDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  traceId?: string;

  @IsOptional()
  @IsString()
  workflowType?: string;

  @IsOptional()
  @IsString()
  workflowId?: string;

  @IsOptional()
  @IsString()
  workflowNo?: string;
}

export class DecisionApprovalDto {
  @IsOptional()
  @IsString()
  checkerRole?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  traceId?: string;

  @IsOptional()
  @IsString()
  workflowType?: string;

  @IsOptional()
  @IsString()
  workflowId?: string;

  @IsOptional()
  @IsString()
  workflowNo?: string;
}

export class CancelApprovalDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  traceId?: string;

  @IsOptional()
  @IsString()
  workflowType?: string;

  @IsOptional()
  @IsString()
  workflowId?: string;

  @IsOptional()
  @IsString()
  workflowNo?: string;
}

export class ApprovalQueryDto {
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
  approvalNo?: string;

  @IsOptional()
  @IsString()
  actionType?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  entityRef?: string;

  @IsOptional()
  @IsString()
  traceId?: string;

  @IsOptional()
  @IsString()
  keyword?: string;
}

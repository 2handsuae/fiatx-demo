import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  DELETE_REQUEST_STATUS_VALUES,
  DELETE_REQUEST_TARGET_TYPE_VALUES,
} from '../constants/delete-request.constants';

export class CreateDeleteRequestDto {
  @IsIn(DELETE_REQUEST_TARGET_TYPE_VALUES)
  targetType!: string;

  @IsString()
  targetNo!: string;

  @IsString()
  deleteReason!: string;

  @IsOptional()
  @IsString()
  docRef?: string;

  @IsOptional()
  @IsString()
  traceId?: string;
}

export class SubmitDeleteRequestDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  traceId?: string;
}

export class CancelDeleteRequestDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  traceId?: string;
}

export class ConsumeDeleteRequestDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  traceId?: string;
}

export class DeleteRequestQueryDto {
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
  requestNo?: string;

  @ApiPropertyOptional({ enum: DELETE_REQUEST_TARGET_TYPE_VALUES })
  @IsOptional()
  @IsIn(DELETE_REQUEST_TARGET_TYPE_VALUES)
  targetType?: string;

  @IsOptional()
  @IsString()
  targetNo?: string;

  @ApiPropertyOptional({ enum: DELETE_REQUEST_STATUS_VALUES })
  @IsOptional()
  @IsIn(DELETE_REQUEST_STATUS_VALUES)
  status?: string;

  @IsOptional()
  @IsString()
  traceId?: string;

  @IsOptional()
  @IsString()
  approvalNo?: string;

  @IsOptional()
  @IsString()
  createdByUserNo?: string;

  @IsOptional()
  @IsString()
  consumedByUserNo?: string;

  @IsOptional()
  @IsString()
  keyword?: string;
}

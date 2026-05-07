import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class CreateRoleChangeRequestDto {
  @IsUUID()
  targetUserId!: string;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @ArrayMinSize(1)
  roleCodes!: string[];

  @IsString()
  @IsNotEmpty()
  changeReason!: string;

  @IsOptional()
  @IsString()
  traceId?: string;
}

export class RoleChangeRequestQueryDto {
  @IsOptional()
  @IsString()
  targetUserId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

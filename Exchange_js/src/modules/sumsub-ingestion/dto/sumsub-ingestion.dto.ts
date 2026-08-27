import { IsEnum, IsOptional, IsString } from 'class-validator';


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

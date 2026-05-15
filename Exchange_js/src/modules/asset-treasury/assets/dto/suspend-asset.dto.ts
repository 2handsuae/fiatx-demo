import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';

export class SuspendAssetDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @IsString()
  reason!: string;
}

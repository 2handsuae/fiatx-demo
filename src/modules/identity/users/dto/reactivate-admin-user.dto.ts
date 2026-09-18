import { IsNotEmpty, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class ReactivateAdminUserDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @IsString()
  reason!: string;
}

import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';

export class SuspendAdminUserDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @IsString()
  reason!: string;
}

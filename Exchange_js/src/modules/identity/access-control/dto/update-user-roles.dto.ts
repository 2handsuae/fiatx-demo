import { Transform } from 'class-transformer';
import { ArrayUnique, IsArray, IsNotEmpty, IsString } from 'class-validator';

export class UpdateUserRolesDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  roleCodes!: string[];

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @IsString()
  changeReason!: string;
}

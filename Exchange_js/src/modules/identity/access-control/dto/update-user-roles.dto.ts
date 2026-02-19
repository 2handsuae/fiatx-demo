import { ArrayUnique, IsArray, IsString } from 'class-validator';

export class UpdateUserRolesDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  roleCodes!: string[];
}

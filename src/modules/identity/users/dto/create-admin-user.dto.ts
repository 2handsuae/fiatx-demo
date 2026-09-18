import { Transform } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class CreateAdminUserDto {
  @IsEmail()
  email!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  roleCodes!: string[];

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @IsString()
  changeReason!: string;
}

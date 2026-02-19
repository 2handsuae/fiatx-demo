import { ArrayMinSize, IsArray, IsEmail, IsString } from 'class-validator';

export class CreateAdminUserDto {
  @IsEmail()
  email!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  roleCodes!: string[];
}

import { IsString, MinLength } from 'class-validator';

export class AcceptAdminInvitationDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}

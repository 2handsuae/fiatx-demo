import { IsNotEmpty, IsString } from 'class-validator';

export class RetireSwapFeeLevelDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

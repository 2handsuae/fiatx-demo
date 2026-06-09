import { IsEnum, IsOptional, IsString } from 'class-validator';
import { InternalFundAction } from '../../asset-treasury/internal-funds/dto/internal-fund.dto';

export class SimulateFundsFlowDto {
  @IsString() fundsFlowId!: string;

  // Validate against the full state-machine action enum (incl. SUBMIT / RETURN /
  // SIGN_FAIL) so this can't drift from the FIAT/CRYPTO transition maps.
  @IsEnum(InternalFundAction)
  action!: InternalFundAction;

  @IsOptional() @IsString() reason?: string;
}

import { IsEnum } from 'class-validator';
import { FundsOrderAction } from './funds-order.dto';

export class AdvanceFundsOrderDto {
  @IsEnum(FundsOrderAction)
  action!: FundsOrderAction;
}

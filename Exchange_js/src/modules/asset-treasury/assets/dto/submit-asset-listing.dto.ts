import {
  IsString,
  IsEnum,
  IsInt,
  IsOptional,
  IsBoolean,
  IsNumber,
  Min,
  Max,
  MaxLength,
  ValidateIf,
  IsNotEmpty,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { AssetType } from './asset.dto';

function IsGreaterThanOrEqual(property: string, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isGreaterThanOrEqual',
      target: object.constructor,
      propertyName,
      constraints: [property],
      options: validationOptions,
      validator: {
        validate(value: any, args: ValidationArguments) {
          const [relatedPropertyName] = args.constraints;
          const relatedValue = (args.object as any)[relatedPropertyName];
          return typeof value === 'number' && typeof relatedValue === 'number' && value >= relatedValue;
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be greater than or equal to ${args.constraints[0]}`;
        },
      },
    });
  };
}

export { AssetType };

export class SubmitAssetListingDto {
  @IsString()
  @MaxLength(16)
  currency!: string;

  @IsEnum(AssetType)
  type!: AssetType;

  @ValidateIf((o) => o.type === AssetType.CRYPTO)
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  network?: string;

  @IsInt()
  @Min(0)
  @Max(18)
  decimals!: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  contractAddress?: string;

  @IsNumber()
  @Min(0)
  minDepositAmount!: number;

  @IsNumber()
  @Min(0)
  @IsGreaterThanOrEqual('minDepositAmount')
  maxDepositAmount!: number;

  @IsNumber()
  @Min(0)
  minWithdrawAmount!: number;

  @IsNumber()
  @Min(0)
  @IsGreaterThanOrEqual('minWithdrawAmount')
  maxWithdrawAmount!: number;

  @IsBoolean()
  depositEnabled!: boolean;

  @IsBoolean()
  withdrawalEnabled!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  description?: string;
}

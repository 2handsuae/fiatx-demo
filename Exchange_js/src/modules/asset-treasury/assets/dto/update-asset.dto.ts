import {
  IsOptional,
  IsBoolean,
  IsNumber,
  IsString,
  Min,
  MaxLength,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

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
          if (value === undefined || value === null) return true; // skip if not provided
          const [relatedPropertyName] = args.constraints;
          const relatedValue = (args.object as any)[relatedPropertyName];
          if (relatedValue === undefined || relatedValue === null) return true;
          return typeof value === 'number' && typeof relatedValue === 'number' && value >= relatedValue;
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be greater than or equal to ${args.constraints[0]}`;
        },
      },
    });
  };
}

/**
 * Fields editable while asset is in PROVISIONING status.
 * Identity fields (type, currency, network, decimals) are NOT editable
 * because they are tied to the TB ledger.
 */
export class UpdateAssetDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  contractAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minDepositAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @IsGreaterThanOrEqual('minDepositAmount')
  maxDepositAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minWithdrawAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @IsGreaterThanOrEqual('minWithdrawAmount')
  maxWithdrawAmount?: number;

  @IsOptional()
  @IsBoolean()
  depositEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  withdrawalEnabled?: boolean;
}

import { IsString, Matches } from 'class-validator';

export class MoneyDto {
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'amount must be a non-negative decimal with at most 2 places',
  })
  amount!: string;

  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  currency!: string;
}

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MoneyDto } from './dto/money.dto';
import { ProcessWagerTransactionUseCase } from '../../application/use-cases/process-wager-transaction.use-case';
import { GetTransactionUseCase } from '../../application/use-cases/query.use-cases';
import { NoopAuthGuard } from '../../infrastructure/auth/noop-auth.guard';
import { WagerTransactionKind, WagerTransactionStatus } from '../../domain';

class CreateWagerDto {
  @IsString()
  providerId!: string;

  @IsString()
  externalTransactionId!: string;

  @IsUUID()
  playerId!: string;

  @IsUUID()
  walletId!: string;

  @IsString()
  roundId!: string;

  @IsString()
  gameId!: string;

  @IsEnum(WagerTransactionKind)
  kind!: WagerTransactionKind;

  @IsObject()
  @ValidateNested()
  @Type(() => MoneyDto)
  money!: MoneyDto;

  @IsOptional()
  @IsString()
  referenceExternalTransactionId?: string;
}

@Controller()
@UseGuards(NoopAuthGuard)
export class WageringController {
  constructor(
    private readonly processWager: ProcessWagerTransactionUseCase,
    private readonly getTx: GetTransactionUseCase,
  ) {}

  @Post('wagering/transactions')
  async create(
    @Body() body: CreateWagerDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!idempotencyKey?.trim()) {
      throw new HttpException(
        { error: 'INVALID_PAYLOAD', message: 'Idempotency-Key header is required' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const result = await this.processWager.execute({
      ...body,
      idempotencyKey: idempotencyKey.trim(),
    });

    if (
      result.status === WagerTransactionStatus.Pending ||
      result.status === WagerTransactionStatus.PendingReference
    ) {
      res.status(HttpStatus.ACCEPTED);
    } else if (result.status === WagerTransactionStatus.Rejected) {
      res.status(HttpStatus.UNPROCESSABLE_ENTITY);
    } else {
      res.status(HttpStatus.OK);
    }

    return {
      transactionId: result.transactionId,
      status: result.status,
      balance: result.balanceAtProcessing ?? result.balance,
      idempotentReplay: result.idempotentReplay,
      failureCode: result.failureCode,
    };
  }

  @Get('wagering/transactions/:transactionId')
  async getById(@Param('transactionId') transactionId: string) {
    return this.getTx.byId(transactionId);
  }

  @Get('providers/:providerId/wagering/transactions/:externalTransactionId')
  async getByExternal(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalTransactionId: string,
  ) {
    return this.getTx.byProviderExternal(providerId, externalTransactionId);
  }
}

void HttpCode;

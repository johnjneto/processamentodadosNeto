import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsObject, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { MoneyDto } from './dto/money.dto';
import { CreateWalletUseCase } from '../../application/use-cases/create-wallet.use-case';
import {
  GetLedgerUseCase,
  GetWalletUseCase,
  ReconcileWalletUseCase,
} from '../../application/use-cases/query.use-cases';
import { NoopAuthGuard } from '../../infrastructure/auth/noop-auth.guard';

class CreateWalletDto {
  @IsUUID()
  playerId!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => MoneyDto)
  initialBalance!: MoneyDto;
}

@Controller('wallets')
@UseGuards(NoopAuthGuard)
export class WalletsController {
  constructor(
    private readonly createWallet: CreateWalletUseCase,
    private readonly getWallet: GetWalletUseCase,
    private readonly getLedger: GetLedgerUseCase,
    private readonly reconcile: ReconcileWalletUseCase,
  ) {}

  @Post()
  @HttpCode(201)
  async create(@Body() body: CreateWalletDto) {
    return this.createWallet.execute(body);
  }

  @Get(':walletId')
  async get(@Param('walletId') walletId: string) {
    return this.getWallet.execute(walletId);
  }

  @Get(':walletId/ledger')
  async ledger(
    @Param('walletId') walletId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.getLedger.execute(
      walletId,
      cursor,
      limit ? Number(limit) : 50,
    );
  }

  @Post(':walletId/reconciliation')
  async reconciliation(@Param('walletId') walletId: string) {
    return this.reconcile.execute(walletId);
  }
}

// silence unused Headers import helper for future auth correlation
void Headers;

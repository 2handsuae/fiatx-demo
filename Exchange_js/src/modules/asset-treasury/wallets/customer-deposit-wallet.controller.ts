import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CustomerDepositWalletService } from './customer-deposit-wallet.service';
import { CreateDepositWalletDto } from './dto/create-deposit-wallet.dto';

@ApiTags('client/deposit-wallets')
@ApiBearerAuth()
@Controller('client/deposit-wallets')
@UseGuards(AuthGuard('jwt'))
export class CustomerDepositWalletController {
  constructor(private readonly service: CustomerDepositWalletService) {}

  @Post()
  @ApiOperation({ summary: 'Create or return existing deposit wallet for current customer' })
  async create(@Request() req: any, @Body() dto: CreateDepositWalletDto) {
    if (req.user?.type !== 'CUSTOMER') {
      throw new ForbiddenException('Customer token required');
    }
    return this.service.createOrReturn(req.user.userId, dto.assetId);
  }
}

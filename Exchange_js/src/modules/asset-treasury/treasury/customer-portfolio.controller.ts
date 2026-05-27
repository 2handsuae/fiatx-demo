import {
  Controller,
  Get,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CustomerPortfolioService } from './customer-portfolio.service';

@ApiTags('client/portfolio')
@ApiBearerAuth()
@Controller('client/portfolio')
@UseGuards(AuthGuard('jwt'))
export class CustomerPortfolioController {
  constructor(private readonly portfolioService: CustomerPortfolioService) {}

  @Get('balances')
  @ApiOperation({ summary: 'Get current customer portfolio balances from TB ledger' })
  async getBalances(@Request() req: any) {
    if (req.user?.type !== 'CUSTOMER') {
      throw new ForbiddenException('Customer token required');
    }
    return this.portfolioService.getPortfolioBalances(req.user.userId);
  }
}

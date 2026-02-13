import { Controller, Get, UseGuards, Query } from '@nestjs/common';
import { UsersService } from './users.service';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get()
  @ApiOperation({ summary: 'List all users' })
  async findAll(@Query('skip') skip?: string, @Query('take') take?: string) {
    return this.usersService.findAll({
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : 20,
      orderBy: { createdAt: 'desc' },
    });
  }
}

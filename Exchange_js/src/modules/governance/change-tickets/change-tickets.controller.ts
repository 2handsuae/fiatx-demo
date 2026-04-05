import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import { ChangeTicketsService } from './change-tickets.service';
import {
  ChangeTicketQueryDto,
  CreateChangeTicketDto,
  SubmitChangeTicketDto,
} from './dto/change-ticket.dto';

class ConsumeChangeTicketDto {
  @IsBoolean()
  success!: boolean;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  traceId?: string;
}

@ApiTags('Admin - Governance Change Tickets')
@Controller('admin/control-gates/change-tickets')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class ChangeTicketsController {
  constructor(private readonly changeTicketsService: ChangeTicketsService) {}

  private ensureAdmin(req: any): ApprovalActorContext {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }

    return {
      actorType: 'ADMIN',
      userId: String(req.user.userId || ''),
      userNo: req.user.userNo,
      role: req.user.role,
      roleCodes: Array.isArray(req.user.roleCodes) ? req.user.roleCodes : [],
    };
  }

  @Post()
  @ApiOperation({ summary: 'Create a change ticket' })
  create(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: CreateChangeTicketDto,
  ) {
    return this.changeTicketsService.create(body, this.ensureAdmin(req));
  }

  @Get()
  @ApiOperation({ summary: 'List change tickets' })
  list(
    @Req() req: any,
    @Query(new ValidationPipe({ transform: true })) query: ChangeTicketQueryDto,
  ) {
    return this.changeTicketsService.list(query, this.ensureAdmin(req));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get change ticket detail' })
  getById(@Req() req: any, @Param('id') id: string) {
    return this.changeTicketsService.getById(id, this.ensureAdmin(req));
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit change ticket to approval' })
  submit(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: SubmitChangeTicketDto,
  ) {
    return this.changeTicketsService.submit(id, body, this.ensureAdmin(req));
  }

  @Post(':id/consume')
  @ApiOperation({ summary: 'Consume a ready change ticket' })
  consume(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: ConsumeChangeTicketDto,
  ) {
    return this.changeTicketsService.consume(id, body, this.ensureAdmin(req));
  }
}

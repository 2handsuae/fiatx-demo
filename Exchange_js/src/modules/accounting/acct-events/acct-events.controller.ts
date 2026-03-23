import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AcctEventsService } from './acct-events.service';
import { AcctEventQueryDto } from './dto/acct-event.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';

@ApiTags('Account Events')
@Controller('acct-events')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class AcctEventsController {
  constructor(private readonly acctEventsService: AcctEventsService) {}

  @Get()
  @ApiOperation({ summary: 'List all accounting events' })
  findAll(@Query() query: AcctEventQueryDto) {
    return this.acctEventsService.findAll(query);
  }

  @Get(':eventCode')
  @ApiOperation({ summary: 'Get an accounting event by code' })
  findOne(@Param('eventCode') eventCode: string) {
    return this.acctEventsService.findOne(eventCode);
  }
}

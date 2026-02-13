import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { AcctEventsService } from './acct-events.service';
import { AcctConfigService } from './acct-config.service';
import {
  CreateAcctEventDto,
  UpdateAcctEventDto,
  AcctEventQueryDto,
} from './dto/acct-event.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Account Events')
@Controller('acct-events')
export class AcctEventsController {
  constructor(
    private readonly acctEventsService: AcctEventsService,
    private readonly acctConfigService: AcctConfigService,
  ) {}

  @Post('sync-defaults')
  @ApiOperation({ summary: 'Sync default accounting events and templates' })
  syncDefaults() {
    return this.acctConfigService.syncDefaults();
  }

  @Post()
  @ApiOperation({ summary: 'Create a new accounting event' })
  create(@Body() createDto: CreateAcctEventDto) {
    return this.acctEventsService.create(createDto);
  }

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

  @Patch(':eventCode')
  @ApiOperation({ summary: 'Update an accounting event' })
  update(
    @Param('eventCode') eventCode: string,
    @Body() updateDto: UpdateAcctEventDto,
  ) {
    return this.acctEventsService.update(eventCode, updateDto);
  }

  @Delete(':eventCode')
  @ApiOperation({ summary: 'Deactivate an accounting event' })
  remove(@Param('eventCode') eventCode: string) {
    return this.acctEventsService.remove(eventCode);
  }
}

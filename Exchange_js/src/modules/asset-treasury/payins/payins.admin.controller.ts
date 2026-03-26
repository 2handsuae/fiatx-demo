import {
  Body,
  Controller,
  ForbiddenException,
  Param,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { MockPayinEventDto } from './dto/payin.dto';
import { PayinsService } from './payins.service';

@ApiTags('admin/treasury/payins')
@ApiBearerAuth()
@Controller('admin/treasury/payins')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class PayinsAdminController {
  constructor(private readonly service: PayinsService) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
  }

  @Post(':id/mock-event')
  @ApiOperation({ summary: 'Apply a simulation-only payin listener event' })
  @UsePipes(new ValidationPipe({ transform: true }))
  mockEvent(@Req() req: any, @Param('id') id: string, @Body() dto: MockPayinEventDto) {
    this.ensureAdmin(req);
    return this.service.applyMockEvent(id, dto);
  }
}

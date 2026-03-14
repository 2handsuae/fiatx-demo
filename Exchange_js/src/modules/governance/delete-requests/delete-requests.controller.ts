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
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import { DeleteRequestsService } from './delete-requests.service';
import {
  CancelDeleteRequestDto,
  CreateDeleteRequestDto,
  DeleteRequestQueryDto,
  ExecuteDeleteRequestDto,
  SubmitDeleteRequestDto,
} from './dto/delete-request.dto';

@ApiTags('Admin - Governance Delete Requests')
@Controller('admin/governance/delete-requests')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class DeleteRequestsController {
  constructor(private readonly deleteRequestsService: DeleteRequestsService) {}

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
  @ApiOperation({ summary: 'Create a delete request' })
  create(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: CreateDeleteRequestDto,
  ) {
    return this.deleteRequestsService.create(body, this.ensureAdmin(req));
  }

  @Get()
  @ApiOperation({ summary: 'List delete requests' })
  list(
    @Req() req: any,
    @Query(new ValidationPipe({ transform: true })) query: DeleteRequestQueryDto,
  ) {
    return this.deleteRequestsService.list(query, this.ensureAdmin(req));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get delete request detail' })
  getById(@Req() req: any, @Param('id') id: string) {
    return this.deleteRequestsService.getById(id, this.ensureAdmin(req));
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit delete request to approval' })
  submit(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: SubmitDeleteRequestDto,
  ) {
    return this.deleteRequestsService.submit(id, body, this.ensureAdmin(req));
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a delete request' })
  cancel(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: CancelDeleteRequestDto,
  ) {
    return this.deleteRequestsService.cancel(id, body, this.ensureAdmin(req));
  }

  @Post(':id/execute')
  @ApiOperation({ summary: 'Execute a delete request' })
  execute(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: ExecuteDeleteRequestDto,
  ) {
    return this.deleteRequestsService.execute(id, body, this.ensureAdmin(req));
  }
}

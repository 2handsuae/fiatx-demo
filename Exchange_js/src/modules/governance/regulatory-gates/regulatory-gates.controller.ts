import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
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
import {
  BindRegulatoryGateReceiptDto,
  CreateRegulatoryGateDto,
  MarkRegulatoryGateEffectiveDto,
  RecordRegulatoryGateFeedbackDto,
  RegulatoryGateQueryDto,
  RevokeRegulatoryGateDto,
  SubmitRegulatoryGateDto,
  UpdateRegulatoryGateDto,
} from './dto/regulatory-gates.dto';
import { RegulatoryGatesService } from './regulatory-gates.service';

@ApiTags('Admin - Regulatory Gates')
@Controller('admin/governance/regulatory-gates')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class RegulatoryGatesController {
  constructor(private readonly regulatoryGatesService: RegulatoryGatesService) {}

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

  @Get()
  @ApiOperation({ summary: 'List regulatory gate items' })
  list(
    @Req() req: any,
    @Query(new ValidationPipe({ transform: true })) query: RegulatoryGateQueryDto,
  ) {
    this.ensureAdmin(req);
    return this.regulatoryGatesService.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get regulatory gate detail' })
  get(@Req() req: any, @Param('id') id: string) {
    this.ensureAdmin(req);
    return this.regulatoryGatesService.getById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create regulatory gate item' })
  create(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: CreateRegulatoryGateDto,
  ) {
    return this.regulatoryGatesService.create(body, this.ensureAdmin(req));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update regulatory gate item' })
  update(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: UpdateRegulatoryGateDto,
  ) {
    return this.regulatoryGatesService.update(id, body, this.ensureAdmin(req));
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit regulatory filing for gate item' })
  submit(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: SubmitRegulatoryGateDto,
  ) {
    return this.regulatoryGatesService.submit(id, body, this.ensureAdmin(req));
  }

  @Post(':id/record-feedback')
  @ApiOperation({ summary: 'Record filing feedback for gate item' })
  recordFeedback(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true }))
    body: RecordRegulatoryGateFeedbackDto,
  ) {
    return this.regulatoryGatesService.recordFeedback(
      id,
      body,
      this.ensureAdmin(req),
    );
  }

  @Post(':id/bind-receipt')
  @ApiOperation({ summary: 'Bind regulatory receipt for gate item' })
  bindReceipt(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: BindRegulatoryGateReceiptDto,
  ) {
    return this.regulatoryGatesService.bindReceipt(id, body, this.ensureAdmin(req));
  }

  @Post(':id/mark-effective')
  @ApiOperation({ summary: 'Mark regulatory gate item as effective' })
  markEffective(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true }))
    body: MarkRegulatoryGateEffectiveDto,
  ) {
    return this.regulatoryGatesService.markEffective(
      id,
      body,
      this.ensureAdmin(req),
    );
  }

  @Post(':id/revoke')
  @ApiOperation({ summary: 'Revoke regulatory gate item' })
  revoke(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: RevokeRegulatoryGateDto,
  ) {
    return this.regulatoryGatesService.revoke(id, body, this.ensureAdmin(req));
  }
}

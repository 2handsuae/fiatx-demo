import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../access-control/admin-permission.guard';
import { PeriodicReviewService } from './periodic-review.service';
import {
  CreateResponseSessionDto,
  MockCompleteSessionDto,
} from '../onboarding/dto/onboarding.dto';

@ApiTags('Customer - Periodic Review')
@Controller('periodic-review')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class PeriodicReviewCustomerController {
  constructor(private readonly periodicReviewService: PeriodicReviewService) {}

  private ensureCustomer(req: any) {
    if (req.user?.type !== 'CUSTOMER') {
      throw new ForbiddenException('Customer token required');
    }
    return req.user.userId as string;
  }

  @Get('me')
  @ApiOperation({ summary: 'Get my periodic review status and active cycle' })
  getMyPeriodicReview(@Req() req: any): Promise<any> {
    const customerId = this.ensureCustomer(req);
    return this.periodicReviewService.getMyPeriodicReview(customerId);
  }

  @Get('responses')
  @ApiOperation({ summary: 'List my periodic review CDD/EDD responses with latest provider session status.' })
  listMyResponses(@Req() req: any): Promise<any> {
    const customerId = this.ensureCustomer(req);
    return this.periodicReviewService.listMyResponses(customerId);
  }

  @Get('next-step')
  @ApiOperation({ summary: 'Get periodic review next step' })
  getNextStep(@Req() req: any): Promise<any> {
    const customerId = this.ensureCustomer(req);
    return this.periodicReviewService.getNextStep(customerId);
  }

  @Post('cdd-responses/start')
  @ApiOperation({ summary: 'Start periodic review CDD response session.' })
  startCddResponses(@Req() req: any): Promise<any> {
    const customerId = this.ensureCustomer(req);
    return this.periodicReviewService.startCddResponses(customerId, customerId);
  }

  @Post('edd-responses/start')
  @ApiOperation({ summary: 'Start periodic review EDD response session.' })
  startEddResponses(@Req() req: any): Promise<any> {
    const customerId = this.ensureCustomer(req);
    return this.periodicReviewService.startEddResponses(customerId, customerId);
  }

  @Post('responses/:id/sessions')
  @ApiOperation({ summary: 'Create periodic review compliance response session and return QR payload.' })
  createResponseSession(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: CreateResponseSessionDto,
  ): Promise<any> {
    const customerId = this.ensureCustomer(req);
    return this.periodicReviewService.createResponseSession(customerId, customerId, id, body);
  }

  @Post('response-sessions/:sessionId/mock-complete')
  @ApiOperation({ summary: 'Mock callback: complete periodic review response session and advance cycle status.' })
  mockCompleteResponseSession(
    @Req() req: any,
    @Param('sessionId') sessionId: string,
    @Body(new ValidationPipe({ transform: true })) body: MockCompleteSessionDto,
  ): Promise<any> {
    const customerId = this.ensureCustomer(req);
    return this.periodicReviewService.mockCompleteSession(
      customerId,
      customerId,
      sessionId,
      body,
    );
  }
}

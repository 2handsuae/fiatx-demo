import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPasswordResetWorkflowService } from '../users/admin-password-reset-workflow.service';
import { MfaBindingWorkflowService } from '../users/mfa-binding-workflow.service';
import { PasswordResetMfaGuard } from './guards/password-reset-mfa.guard';
import {
  PasswordResetRequestDto,
  PasswordResetVerifyMfaDto,
  PasswordResetConsumeDto,
} from '../users/dto/password-reset.dto';

@ApiTags('password-reset')
@Controller('auth/password-reset')
export class PasswordResetController {
  constructor(
    private readonly passwordResetWorkflow: AdminPasswordResetWorkflowService,
    private readonly mfaBindingWorkflow: MfaBindingWorkflowService,
  ) {}

  @Post('request')
  @ApiOperation({ summary: 'Request self-service password reset (C5)' })
  async request(
    @Body(new ValidationPipe({ transform: true })) body: PasswordResetRequestDto,
  ) {
    return this.passwordResetWorkflow.requestSelfServiceReset(body.email);
  }

  @Post('verify-mfa')
  @UseGuards(PasswordResetMfaGuard)
  @ApiOperation({ summary: 'Verify MFA for self-service password reset (C5)' })
  async verifyMfa(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: PasswordResetVerifyMfaDto,
  ) {
    const { userId, userNo, email, traceId } = req.passwordResetMfaUser;
    await this.mfaBindingWorkflow.verifyMfaCode(userId, body.code);
    return this.passwordResetWorkflow.createResetTokenForSelf(userId, userNo, email, traceId);
  }

  @Post('consume')
  @ApiOperation({ summary: 'Consume reset token and set new password (C5)' })
  async consume(
    @Body(new ValidationPipe({ transform: true })) body: PasswordResetConsumeDto,
  ) {
    return this.passwordResetWorkflow.consumeResetToken(body.token, body.newPassword);
  }
}

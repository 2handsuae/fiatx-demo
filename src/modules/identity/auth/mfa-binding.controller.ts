import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MfaBindingGuard } from './guards/mfa-binding.guard';
import { MfaSessionGuard } from './guards/mfa-session.guard';
import { MfaBindingWorkflowService } from '../users/mfa-binding-workflow.service';
import { MfaVerifyDto } from './dto/first-login.dto';

@ApiTags('mfa-binding')
@Controller('auth')
export class MfaBindingController {
  constructor(private readonly mfaBindingWorkflowService: MfaBindingWorkflowService) {}

  @Get('mfa-binding/status')
  @UseGuards(MfaBindingGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current MFA binding step (for page refresh recovery)' })
  async getStatus(@Req() req: any) {
    return this.mfaBindingWorkflowService.getStatus(req.mfaBindingUser.userId);
  }

  @Get('mfa-binding/me')
  @UseGuards(MfaBindingGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get identity preview for step 1' })
  async getIdentityPreview(@Req() req: any) {
    return this.mfaBindingWorkflowService.getIdentityPreview(req.mfaBindingUser.userId);
  }

  @Post('mfa-binding/confirm-identity')
  @UseGuards(MfaBindingGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm identity (step 1 → MFA_BINDING)' })
  async confirmIdentity(@Req() req: any) {
    return this.mfaBindingWorkflowService.confirmIdentity(req.mfaBindingUser.userId);
  }

  @Post('mfa-binding/mfa/init')
  @UseGuards(MfaBindingGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initialize TOTP MFA binding (returns QR data URL)' })
  async initMfaBind(@Req() req: any) {
    return this.mfaBindingWorkflowService.initMfaBind(req.mfaBindingUser.userId);
  }

  @Post('mfa-binding/mfa/verify')
  @UseGuards(MfaBindingGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify TOTP code to complete MFA binding' })
  async verifyMfaBind(
    @Req() req: any,
    @Body(new ValidationPipe({ whitelist: true })) body: MfaVerifyDto,
  ) {
    return this.mfaBindingWorkflowService.verifyMfaBind(req.mfaBindingUser.userId, body.code);
  }

  @Post('mfa/verify')
  @UseGuards(MfaSessionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify TOTP code on normal login (returns full access token)' })
  async verifyMfaLogin(
    @Req() req: any,
    @Body(new ValidationPipe({ whitelist: true })) body: MfaVerifyDto,
  ) {
    const { userId, userNo, email, role, roleCodes, loginTraceId } = req.mfaSessionUser;
    return this.mfaBindingWorkflowService.verifyMfaLogin(userId, body.code, roleCodes, role, email, userNo, loginTraceId, {
      requestId: req.id,
      sourceIp: req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.ip,
    });
  }
}

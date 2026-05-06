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
import { FirstLoginGuard } from './guards/first-login.guard';
import { MfaSessionGuard } from './guards/mfa-session.guard';
import { FirstLoginWorkflowService } from '../users/first-login-workflow.service';
import { MfaVerifyDto } from './dto/first-login.dto';

@ApiTags('first-login')
@Controller('auth')
export class FirstLoginController {
  constructor(private readonly firstLoginWorkflowService: FirstLoginWorkflowService) {}

  @Get('first-login/status')
  @UseGuards(FirstLoginGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current first-login step (for page refresh recovery)' })
  async getStatus(@Req() req: any) {
    return this.firstLoginWorkflowService.getStatus(req.firstLoginUser.userId);
  }

  @Get('first-login/me')
  @UseGuards(FirstLoginGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get identity preview for step 1' })
  async getIdentityPreview(@Req() req: any) {
    return this.firstLoginWorkflowService.getIdentityPreview(req.firstLoginUser.userId);
  }

  @Post('first-login/confirm-identity')
  @UseGuards(FirstLoginGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm identity (step 1 → MFA_BINDING)' })
  async confirmIdentity(@Req() req: any) {
    return this.firstLoginWorkflowService.confirmIdentity(req.firstLoginUser.userId);
  }

  @Post('first-login/mfa/init')
  @UseGuards(FirstLoginGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initialize TOTP MFA binding (returns QR data URL)' })
  async initMfaBind(@Req() req: any) {
    return this.firstLoginWorkflowService.initMfaBind(req.firstLoginUser.userId);
  }

  @Post('first-login/mfa/verify')
  @UseGuards(FirstLoginGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify TOTP code to complete MFA binding' })
  async verifyMfaBind(
    @Req() req: any,
    @Body(new ValidationPipe({ whitelist: true })) body: MfaVerifyDto,
  ) {
    return this.firstLoginWorkflowService.verifyMfaBind(req.firstLoginUser.userId, body.code);
  }

  @Post('first-login/policy/acknowledge')
  @UseGuards(FirstLoginGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Acknowledge security policy (completes first login)' })
  async acknowledgePolicy(@Req() req: any) {
    return this.firstLoginWorkflowService.acknowledgePolicy(req.firstLoginUser.userId);
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
    return this.firstLoginWorkflowService.verifyMfaLogin(userId, body.code, roleCodes, role, email, userNo, loginTraceId);
  }
}

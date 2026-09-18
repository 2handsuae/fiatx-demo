import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  Param,
  ForbiddenException,
  UseGuards,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';
import { AdminPermissionGuard } from '../access-control/admin-permission.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { buildPermissionCode } from '../access-control/permission-code.util';
import { AcceptAdminInvitationDto } from './dto/admin-invitation.dto';

const LoginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(6),
});

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  private resolveRequestSourceIp(req: any): string | undefined {
    const xff = req.headers?.['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
      return xff.split(',')[0]?.trim();
    }
    return req.ip;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login for admin' })
  @ApiResponse({ status: 200, description: 'Return JWT token' })
  async login(@Req() req: any, @Body() body: any) {
    // Validate input
    const result = LoginSchema.safeParse(body);
    if (!result.success) {
      throw new UnauthorizedException('Invalid input format');
    }

    const user = await this.authService.validateUser(body.email, body.password, {
      requestId: req.id,
      sourceIp: this.resolveRequestSourceIp(req),
      sourcePlatform: 'ADMIN_AUTH_API',
    });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.authService.login(user);
  }

  @Get('admin-invitations/:token')
  @ApiOperation({ summary: 'Validate admin invitation token' })
  async previewInvitation(@Param('token') token: string) {
    return this.authService.getAdminInvitationPreview(token);
  }

  @Post('admin-invitations/accept')
  @ApiOperation({ summary: 'Accept admin invitation and activate account' })
  async acceptInvitation(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: AcceptAdminInvitationDto,
  ) {
    return this.authService.acceptAdminInvitation(body.token, body.password, {
      requestId: req.id,
      sourceIp: this.resolveRequestSourceIp(req),
      sourcePlatform: 'ADMIN_INVITATION_API',
    });
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
  @RequirePermissions(buildPermissionCode('GET', '/auth/me'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current admin session with RBAC snapshot' })
  async me(@Req() req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
    return this.authService.getAdminSession(req.user.userId);
  }
}

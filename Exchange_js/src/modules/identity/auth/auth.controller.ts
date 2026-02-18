import {
  Controller,
  Post,
  Body,
  Req,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';

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
}

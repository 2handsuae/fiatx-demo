import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class PasswordResetMfaGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers?.authorization as string | undefined;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing password-reset MFA token');
    }
    const token = authHeader.slice(7);
    let payload: any;
    try {
      payload = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET || 'secretKey',
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired password-reset MFA token');
    }
    if (payload?.scope !== 'password_reset_mfa') {
      throw new ForbiddenException('This endpoint requires a password-reset MFA token');
    }
    request.passwordResetMfaUser = {
      userId: payload.sub,
      userNo: payload.userNo,
      email: payload.username,
      traceId: payload.traceId,
    };
    return true;
  }
}

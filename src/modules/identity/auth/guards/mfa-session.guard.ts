import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class MfaSessionGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers?.authorization as string | undefined;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing MFA session token');
    }
    const token = authHeader.slice(7);
    let payload: any;
    try {
      payload = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET || 'secretKey',
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired MFA session token');
    }
    if (payload?.scope !== 'mfa_session') {
      throw new ForbiddenException('This endpoint requires an MFA session token');
    }
    request.mfaSessionUser = {
      userId: payload.sub,
      userNo: payload.userNo,
      email: payload.username,
      role: payload.role,
      roleCodes: payload.roleCodes,
      loginTraceId: payload.loginTraceId,
    };
    return true;
  }
}

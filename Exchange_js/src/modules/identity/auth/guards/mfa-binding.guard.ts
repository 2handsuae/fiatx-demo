import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class MfaBindingGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers?.authorization as string | undefined;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing mfa-binding token');
    }
    const token = authHeader.slice(7);
    let payload: any;
    try {
      payload = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET || 'secretKey',
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired mfa-binding token');
    }
    if (payload?.scope !== 'first_login') {
      throw new ForbiddenException('This endpoint requires a mfa-binding token');
    }
    request.mfaBindingUser = {
      userId: payload.sub,
      userNo: payload.userNo,
      email: payload.username,
      role: payload.role,
    };
    return true;
  }
}

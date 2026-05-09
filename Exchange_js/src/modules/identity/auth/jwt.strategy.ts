import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'secretKey',
    });
  }

  async validate(payload: any) {
    if (payload?.type !== 'ADMIN' && payload?.type !== 'CUSTOMER') {
      throw new UnauthorizedException('Invalid token type');
    }

    if (payload?.type === 'CUSTOMER') {
      const customer = await this.prisma.customerMain.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          complianceStatus: true,
        },
      });

      if (!customer) {
        throw new UnauthorizedException('Customer not found');
      }

      if (String(customer.complianceStatus || 'CLEAR').toUpperCase() === 'FROZEN') {
        throw new ForbiddenException({
          code: 'CUSTOMER_ACCOUNT_FROZEN',
          message: '账号已冻结，禁止访问。请联系 WhatsApp 客服处理。',
        });
      }
    }

    if (payload?.type === 'ADMIN') {
      const adminUser = await this.prisma.user.findFirst({
        where: { id: payload.sub, deletedAt: null },
        select: { id: true, status: true },
      });

      if (!adminUser) {
        throw new UnauthorizedException('Admin user not found');
      }

      if (adminUser.status === 'SUSPENDED') {
        throw new ForbiddenException({
          code: 'ADMIN_ACCOUNT_SUSPENDED',
          message: 'Account has been suspended. Contact your administrator.',
        });
      }
    }

    const roleCodes = Array.isArray(payload?.roleCodes)
      ? payload.roleCodes.map((item: unknown) =>
          String(item || '').trim().toUpperCase(),
        )
      : payload?.role
        ? [String(payload.role).trim().toUpperCase()]
        : [];

    return {
      userId: payload.sub,
      username: payload.username,
      userNo: payload.userNo,
      role: payload.role,
      roleCodes,
      type: payload.type,
      scope: payload.scope ?? null,
    };
  }
}

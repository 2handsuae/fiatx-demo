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
          lifecycle: true,
        },
      });

      if (!customer) {
        throw new UnauthorizedException('Customer not found');
      }

      // Task 5：会话层只认关系是否终止。合规摁住（含 SANCTION）在这里一律不现形——
      // 每请求 403 本身就是告知调查。REJECTED / WITHDRAWN 同样放行：他们要能重新申请。
      if (String(customer.lifecycle || '').toUpperCase() === 'OFFBOARDED') {
        throw new ForbiddenException({
          code: 'CUSTOMER_ACCOUNT_CLOSED',
          message: '账号已关闭，无法访问。',
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

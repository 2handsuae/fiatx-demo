import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
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

    return {
      userId: payload.sub,
      username: payload.username,
      role: payload.role,
      type: payload.type,
    };
  }
}

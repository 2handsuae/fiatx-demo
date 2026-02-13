import { Injectable, ForbiddenException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.usersService.findOne(email);
    if (!user) {
      return null;
    }

    if (
      user.status === 'LOCKED' &&
      user.lockedUntil &&
      user.lockedUntil > new Date()
    ) {
      throw new ForbiddenException('Account is locked. Try again later.');
    } else if (
      user.status === 'LOCKED' &&
      user.lockedUntil &&
      user.lockedUntil <= new Date()
    ) {
      // Unlock automatically
      await this.usersService.update({
        where: { email },
        data: { status: 'ACTIVE', failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    const isMatch = await bcrypt.compare(pass, user.password);
    if (isMatch) {
      await this.usersService.update({
        where: { email },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastLoginAt: new Date(),
        },
      });
      const { password: _, ...result } = user;
      return result;
    } else {
      // Increment failed attempts
      const attempts = user.failedLoginAttempts + 1;
      const updateData: any = { failedLoginAttempts: attempts };

      if (attempts >= 5) {
        updateData.status = 'LOCKED';
        updateData.lockedUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 min lock
      }

      await this.usersService.update({
        where: { email },
        data: updateData,
      });

      return null;
    }
  }

  async login(user: any) {
    const payload = { username: user.email, sub: user.id, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        email: user.email,
        role: user.role,
        lastLoginAt: user.lastLoginAt,
      },
    };
  }
}

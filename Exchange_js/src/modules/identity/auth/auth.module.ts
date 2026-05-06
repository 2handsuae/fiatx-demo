import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CustomerAuthService } from './customer-auth.service';
import { AuthController } from './auth.controller';
import { CustomerAuthController } from './customer-auth.controller';
import { FirstLoginController } from './first-login.controller';
import { FirstLoginGuard } from './guards/first-login.guard';
import { MfaSessionGuard } from './guards/mfa-session.guard';
import { PasswordResetMfaGuard } from './guards/password-reset-mfa.guard';
import { PasswordResetController } from './password-reset.controller';
import { FirstLoginWorkflowService } from '../users/first-login-workflow.service';
import { UsersModule } from '../users/users.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './jwt.strategy';
import { PrismaModule } from '../../../core/prisma/prisma.module';

@Module({
  imports: [
    UsersModule,
    AccessControlModule,
    PrismaModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'secretKey',
      signOptions: { expiresIn: '1d' },
    }),
  ],
  providers: [AuthService, CustomerAuthService, JwtStrategy, FirstLoginGuard, MfaSessionGuard, PasswordResetMfaGuard, FirstLoginWorkflowService],
  controllers: [CustomerAuthController, AuthController, FirstLoginController, PasswordResetController],
})
export class AuthModule {}

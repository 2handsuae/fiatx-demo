import {
  Controller,
  Post,
  Body,
  Req,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CustomerAuthService } from './customer-auth.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  customerType: z.enum(['INDIVIDUAL']).default('INDIVIDUAL'),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

const LoginSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(4).optional(),
  password: z.string().min(6),
}).refine((value) => !!value.email || !!value.phone, {
  message: 'email or phone is required',
});

@ApiTags('auth-customer')
@Controller('auth/customer')
export class CustomerAuthController {
  constructor(private customerAuthService: CustomerAuthService) {}

  private resolveRequestSourceIp(req: any): string | undefined {
    const xff = req.headers?.['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
      return xff.split(',')[0]?.trim();
    }
    return req.ip;
  }

  @Post('register')
  @ApiOperation({ summary: 'Register a new customer' })
  async register(@Req() req: any, @Body() body: any) {
    const result = RegisterSchema.safeParse(body);
    if (!result.success) {
      throw new UnauthorizedException('Invalid input format');
    }
    return this.customerAuthService.register(result.data, {
      requestId: req.id,
      sourceIp: this.resolveRequestSourceIp(req),
      sourcePlatform: 'CUSTOMER_AUTH_API',
    });
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login for customer' })
  @ApiResponse({ status: 200, description: 'Return JWT token' })
  async login(@Req() req: any, @Body() body: any) {
    const result = LoginSchema.safeParse(body);
    if (!result.success) {
      throw new UnauthorizedException('Invalid input format');
    }

    const identifier = body.email || body.phone;
    const customer = await this.customerAuthService.validateCustomer(
      identifier,
      body.password,
      {
        requestId: req.id,
        sourceIp: this.resolveRequestSourceIp(req),
        sourcePlatform: 'CUSTOMER_AUTH_API',
      },
    );
    if (!customer) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.customerAuthService.login(customer);
  }
}
